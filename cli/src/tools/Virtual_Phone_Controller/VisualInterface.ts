import { ToolResult } from '../index';
import chalk from 'chalk';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ensureAdb } from './utils';

const execAsync = promisify(exec);

interface Coordinates {
  x: number;
  y: number;
}

interface VisualInterfaceArgs {
  deviceId: string;
  action: 'tap' | 'swipe' | 'text' | 'keyevent' | 'screenshot' | 'dump_hierarchy' | 'get_resolution' | 'tap_by_text' | 'wait_for_element';
  coordinates?: Coordinates;
  startCoords?: Coordinates;
  endCoords?: Coordinates;
  text?: string;
  targetText?: string;
  keyCode?: string;
  duration?: number;
  captureScreenshot?: boolean;
  resolution?: {
    width: number;
    height: number;
  };
  timeout?: number;
}

async function parseBounds(boundsStr: string): Promise<Coordinates> {
  // Bounds format: [x1,y1][x2,y2]
  const match = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) throw new Error(`Invalid bounds format: ${boundsStr}`);
  const x1 = parseInt(match[1], 10);
  const y1 = parseInt(match[2], 10);
  const x2 = parseInt(match[3], 10);
  const y2 = parseInt(match[4], 10);
  // Return center
  return {
    x: Math.floor((x1 + x2) / 2),
    y: Math.floor((y1 + y2) / 2)
  };
}

async function captureHierarchy(deviceId: string, timeout: number): Promise<string> {
  const remotePath = '/data/local/tmp/hierarchy.xml';
  try {
    await executeAdbCommand(deviceId, ['shell', 'uiautomator', 'dump', remotePath], timeout);
    const { stdout } = await executeAdbCommand(deviceId, ['shell', 'cat', remotePath], timeout);
    return stdout;
  } finally {
    try {
      await executeAdbCommand(deviceId, ['shell', 'rm', remotePath], 5000);
    } catch {}
  }
}

async function executeAdbCommand(
  deviceId: string, 
  command: string[], 
  timeout: number = 30000
): Promise<{ stdout: string; stderr: string }> {
  const args = ['-s', deviceId, ...command];
  return new Promise((resolve, reject) => {
    const childProcess = spawn('adb', args, { timeout });
    let stdout = '';
    let stderr = '';
    
    childProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    childProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    childProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ADB command failed with code ${code}: ${stderr || stdout}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
    
    childProcess.on('error', (err) => {
      reject(new Error(`Failed to execute ADB: ${err.message}`));
    });
  });
}

async function checkDeviceState(deviceId: string, timeout: number): Promise<'offline' | 'unauthorized' | 'booting' | 'ready'> {
  try {
    const { stdout } = await execAsync('adb devices', { timeout });
    const deviceLine = stdout.split('\n').find(line => line.startsWith(deviceId));
    
    if (!deviceLine) {
      throw new Error(`Device ${deviceId} not found in ADB devices list`);
    }
    
    if (deviceLine.includes('offline')) return 'offline';
    if (deviceLine.includes('unauthorized')) return 'unauthorized';
    
    try {
      const { stdout: bootOut } = await execAsync(`adb -s ${deviceId} shell getprop sys.boot_completed`, { timeout });
      if (bootOut.trim() === '1') return 'ready';
      return 'booting';
    } catch (e) {
      return 'offline';
    }
  } catch (error) {
    throw new Error(`Failed to check device state: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

function validateCoordinates(
  coords: Coordinates, 
  resolution?: { width: number; height: number }
): void {
  if (resolution) {
    if (coords.x < 0 || coords.x > resolution.width || coords.y < 0 || coords.y > resolution.height) {
      throw new Error(
        `Coordinates (${coords.x}, ${coords.y}) out of bounds for resolution ${resolution.width}x${resolution.height}`
      );
    }
  }
  if (coords.x < 0 || coords.y < 0) {
    throw new Error('Coordinates must be non-negative');
  }
}

async function captureScreenshotToBase64(deviceId: string, timeout: number): Promise<string> {
  const tempFile = path.join(os.tmpdir(), `adb_screenshot_${Date.now()}_${Math.random().toString(36).substring(2, 11)}.png`);
  
  try {
    await new Promise<void>((resolve, reject) => {
      const writeStream = fs.createWriteStream(tempFile);
      const process = spawn('adb', ['-s', deviceId, 'exec-out', 'screencap', '-p'], { timeout });
      
      process.stdout.pipe(writeStream);
      
      let errorOutput = '';
      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      process.on('close', (code) => {
        if (code !== 0) {
          writeStream.destroy();
          reject(new Error(`Screenshot capture failed: ${errorOutput || 'Unknown error'}`));
        } else {
          writeStream.end(() => resolve());
        }
      });
      
      process.on('error', (err) => {
        writeStream.destroy();
        reject(err);
      });
      
      writeStream.on('error', (err) => {
        process.kill();
        reject(err);
      });
    });
    
    const imageBuffer = await fsp.readFile(tempFile);
    return imageBuffer.toString('base64');
  } finally {
    try {
      await fsp.unlink(tempFile);
    } catch (e) {
      console.error(chalk.yellow(`Warning: Failed to cleanup temp screenshot file: ${tempFile}`));
    }
  }
}

export async function VisualInterface(args: VisualInterfaceArgs): Promise<ToolResult> {
  const {
    deviceId,
    action,
    coordinates,
    startCoords,
    endCoords,
    text,
    targetText,
    keyCode,
    duration = 300,
    captureScreenshot = false,
    resolution,
    timeout = 30000
  } = args;

  if (!deviceId) {
    return new ToolResult(false, 'Device ID is required');
  }
  
  if (!action) {
    return new ToolResult(false, 'Action is required');
  }

  try {
    await ensureAdb();
    
    try {
      await execAsync('adb version', { timeout: 5000 });
    } catch {
      return new ToolResult(false, 'ADB not found. Please install Android SDK and ensure adb is in PATH');
    }

    const state = await checkDeviceState(deviceId, timeout);
    if (state === 'offline') {
      return new ToolResult(false, `Device ${deviceId} is offline or not connected`);
    }
    if (state === 'unauthorized') {
      return new ToolResult(false, `Device ${deviceId} is unauthorized. Please authorize USB debugging on the device`);
    }
    if (state === 'booting') {
      return new ToolResult(false, `Device ${deviceId} is still booting. Please wait for boot completion`);
    }

    let resultData: any = {};
    let actionMessage = '';

    switch (action) {
      case 'tap': {
        if (!coordinates) {
          return new ToolResult(false, 'Coordinates required for tap action');
        }
        validateCoordinates(coordinates, resolution);
        
        await executeAdbCommand(deviceId, ['shell', 'input', 'tap', coordinates.x.toString(), coordinates.y.toString()], timeout);
        actionMessage = `Tapped at coordinates (${coordinates.x}, ${coordinates.y})`;
        break;
      }
      
      case 'swipe': {
        if (!startCoords || !endCoords) {
          return new ToolResult(false, 'Start and end coordinates required for swipe action');
        }
        validateCoordinates(startCoords, resolution);
        validateCoordinates(endCoords, resolution);
        
        await executeAdbCommand(deviceId, [
          'shell', 'input', 'swipe',
          startCoords.x.toString(), startCoords.y.toString(),
          endCoords.x.toString(), endCoords.y.toString(),
          duration.toString()
        ], timeout);
        actionMessage = `Swiped from (${startCoords.x}, ${startCoords.y}) to (${endCoords.x}, ${endCoords.y})`;
        break;
      }
      
      case 'text': {
        if (!text) {
          return new ToolResult(false, 'Text required for text input action');
        }
        const escapedText = text.replace(/ /g, '%s').replace(/'/g, "\\'").replace(/"/g, '\\"');
        await executeAdbCommand(deviceId, ['shell', 'input', 'text', escapedText], timeout);
        actionMessage = `Input text: ${text}`;
        break;
      }
      
      case 'keyevent': {
        if (!keyCode) {
          return new ToolResult(false, 'KeyCode required for keyevent action');
        }
        await executeAdbCommand(deviceId, ['shell', 'input', 'keyevent', keyCode], timeout);
        actionMessage = `Sent keyevent: ${keyCode}`;
        break;
      }
      
      case 'screenshot': {
        break;
      }

      case 'dump_hierarchy': {
        const xml = await captureHierarchy(deviceId, timeout);
        resultData.hierarchy = xml;
        actionMessage = 'UI hierarchy dumped successfully';
        break;
      }

      case 'get_resolution': {
        const { stdout } = await executeAdbCommand(deviceId, ['shell', 'wm', 'size'], timeout);
        const match = stdout.match(/Physical size: (\d+)x(\d+)/);
        if (match) {
          resultData.width = parseInt(match[1], 10);
          resultData.height = parseInt(match[2], 10);
          actionMessage = `Device resolution: ${match[1]}x${match[2]}`;
        } else {
          return new ToolResult(false, `Failed to parse resolution from: ${stdout}`);
        }
        break;
      }

      case 'tap_by_text': {
        if (!targetText) {
          return new ToolResult(false, 'targetText required for tap_by_text action');
        }
        const xml = await captureHierarchy(deviceId, timeout);
        // Look for text="..." or content-desc="..."
        const textPattern = new RegExp(`text="${targetText}"[^>]*bounds="([^"]+)"`, 'i');
        const descPattern = new RegExp(`content-desc="${targetText}"[^>]*bounds="([^"]+)"`, 'i');
        
        const match = xml.match(textPattern) || xml.match(descPattern);
        if (!match) {
          return new ToolResult(false, `Could not find element with text or description: "${targetText}"`);
        }
        
        const center = await parseBounds(match[1]);
        await executeAdbCommand(deviceId, ['shell', 'input', 'tap', center.x.toString(), center.y.toString()], timeout);
        actionMessage = `Found and tapped "${targetText}" at (${center.x}, ${center.y})`;
        resultData.coordinates = center;
        break;
      }

      case 'wait_for_element': {
        if (!targetText) {
          return new ToolResult(false, 'targetText required for wait_for_element action');
        }
        const maxWait = timeout || 30000;
        const start = Date.now();
        let found = false;
        
        actionMessage = `Waiting for element "${targetText}"...`;
        
        while (Date.now() - start < maxWait) {
          const xml = await captureHierarchy(deviceId, 5000);
          if (xml.toLowerCase().includes(targetText.toLowerCase())) {
            found = true;
            break;
          }
          await new Promise(r => setTimeout(r, 2000));
        }
        
        if (!found) {
          return new ToolResult(false, `Timed out waiting for element: "${targetText}"`);
        }
        actionMessage = `Element "${targetText}" appeared on screen`;
        break;
      }
      
      default:
        return new ToolResult(false, `Unknown action: ${action}`);
    }

    if (captureScreenshot || action === 'screenshot') {
      try {
        const base64Image = await captureScreenshotToBase64(deviceId, timeout);
        resultData.screenshot = base64Image;
        resultData.screenshotFormat = 'png/base64';
        actionMessage += captureScreenshot ? ' with screenshot capture' : 'Screenshot captured';
      } catch (screenshotError: any) {
        if (action === 'screenshot') {
          return new ToolResult(false, `Screenshot failed: ${screenshotError.message}`);
        }
        actionMessage += ` (Warning: screenshot failed: ${screenshotError.message})`;
      }
    }

    return new ToolResult(true, actionMessage, resultData);
    
  } catch (error: any) {
    // We explicitly avoid console.error here to prevent terminal cluttering 
    // since the error is returned to the agent as a ToolResult failure.
    return new ToolResult(false, `Tool failed: ${error.message}`);
  }
}

(VisualInterface as any).description = "Perform surgical UI automation (tap, swipe, text input) and capture screenshots for state verification, managing temporary file cleanup automatically.";
(VisualInterface as any).parameters = {
  deviceId: {
    type: "string",
    description: "ADB device serial identifier (e.g., 'emulator-5554' or physical device serial)",
    required: true
  },
  action: {
    type: "string",
    description: "UI automation action: 'tap', 'swipe', 'text', 'keyevent', 'screenshot', 'dump_hierarchy', 'get_resolution', 'tap_by_text', or 'wait_for_element'",
    required: true
  },
  coordinates: {
    type: "object",
    description: "Coordinates for tap action {x: number, y: number}",
    required: false
  },
  startCoords: {
    type: "object",
    description: "Starting coordinates for swipe {x: number, y: number}",
    required: false
  },
  endCoords: {
    type: "object",
    description: "Ending coordinates for swipe {x: number, y: number}",
    required: false
  },
  text: {
    type: "string",
    description: "Text to input (for 'text' action). Spaces will be encoded automatically.",
    required: false
  },
  targetText: {
    type: "string",
    description: "String to search for in 'tap_by_text' or 'wait_for_element' actions.",
    required: false
  },
  keyCode: {
    type: "string",
    description: "Android keyevent code (e.g., 'KEYCODE_ENTER', 'KEYCODE_BACK', 'KEYCODE_HOME')",
    required: false
  },
  duration: {
    type: "number",
    description: "Swipe duration in milliseconds (default: 300)",
    required: false
  },
  captureScreenshot: {
    type: "boolean",
    description: "Capture screenshot after action (temp file auto-deleted after encoding)",
    required: false
  },
  resolution: {
    type: "object",
    description: "Screen resolution for bounds validation {width: number, height: number}",
    required: false
  },
  timeout: {
    type: "number",
    description: "Command timeout in milliseconds (default: 30000)",
    required: false
  }
};

export default VisualInterface;