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
  deviceId?: string;
  action: 'tap' | 'swipe' | 'text' | 'keyevent' | 'screenshot' | 'dump_hierarchy' | 'get_resolution' | 'tap_by_text' | 'wait_for_element' | 'snapshot' | 'context_snapshot' | 'click' | 'type_text' | 'press' | 'hierarchy';
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
  textMatchMode?: 'exact' | 'contains' | 'regex';
  occurrenceIndex?: number;
  ignoreCase?: boolean;
  returnMatches?: boolean;
  includeHierarchy?: boolean;
  includeResolution?: boolean;
}

interface HierarchyMatch {
  center: Coordinates;
  bounds: string;
  text?: string;
  contentDesc?: string;
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

async function resolveDeviceId(preferredDeviceId?: string, timeout: number = 10000): Promise<{ deviceId?: string; error?: string; available?: string[] }> {
  if (preferredDeviceId) {
    return { deviceId: preferredDeviceId };
  }

  const { stdout } = await execAsync('adb devices', { timeout });
  const lines = stdout
    .split('\n')
    .slice(1)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.split('\t'))
    .filter(parts => parts.length >= 2 && parts[1] === 'device')
    .map(parts => parts[0]);

  if (lines.length === 1) {
    return { deviceId: lines[0] };
  }

  if (lines.length === 0) {
    return { error: 'No authorized device detected. Connect a device or start an emulator.', available: [] };
  }

  return {
    error: `deviceId is required because ${lines.length} devices are connected: ${lines.join(', ')}`,
    available: lines,
  };
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeAction(action: VisualInterfaceArgs['action']): 'tap' | 'swipe' | 'text' | 'keyevent' | 'screenshot' | 'dump_hierarchy' | 'get_resolution' | 'tap_by_text' | 'wait_for_element' | 'context_snapshot' {
  if (action === 'click') return 'tap';
  if (action === 'type_text') return 'text';
  if (action === 'press') return 'keyevent';
  if (action === 'hierarchy') return 'dump_hierarchy';
  if (action === 'snapshot') return 'context_snapshot';
  return action;
}

async function findHierarchyMatches(
  xml: string,
  targetText: string,
  mode: 'exact' | 'contains' | 'regex',
  ignoreCase: boolean
): Promise<HierarchyMatch[]> {
  const matches: HierarchyMatch[] = [];
  const nodeRegex = /<node\b[^>]*>/g;
  const pattern = mode === 'regex'
    ? new RegExp(targetText, ignoreCase ? 'i' : '')
    : new RegExp(mode === 'exact' ? `^${escapeRegex(targetText)}$` : escapeRegex(targetText), ignoreCase ? 'i' : '');

  let nodeMatch: RegExpExecArray | null;
  while ((nodeMatch = nodeRegex.exec(xml)) !== null) {
    const node = nodeMatch[0];
    const boundsMatch = node.match(/bounds="([^"]+)"/i);
    if (!boundsMatch) continue;

    const textMatch = node.match(/text="([^"]*)"/i);
    const descMatch = node.match(/content-desc="([^"]*)"/i);
    const nodeText = textMatch?.[1] || '';
    const nodeDesc = descMatch?.[1] || '';

    const isMatch = pattern.test(nodeText) || pattern.test(nodeDesc);
    if (!isMatch) continue;

    const center = await parseBounds(boundsMatch[1]);
    matches.push({
      center,
      bounds: boundsMatch[1],
      text: nodeText,
      contentDesc: nodeDesc,
    });
  }

  return matches;
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
    deviceId: requestedDeviceId,
    action: requestedAction,
    coordinates,
    startCoords,
    endCoords,
    text,
    targetText,
    keyCode,
    duration = 300,
    captureScreenshot = false,
    resolution,
    timeout = 30000,
    textMatchMode = 'exact',
    occurrenceIndex = 0,
    ignoreCase = true,
    returnMatches = false,
    includeHierarchy = true,
    includeResolution = true,
  } = args;

  const action = normalizeAction(requestedAction);
  
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

    const resolvedDevice = await resolveDeviceId(requestedDeviceId, Math.min(timeout, 15000));
    if (!resolvedDevice.deviceId) {
      return new ToolResult(false, resolvedDevice.error || 'Unable to resolve deviceId', {
        availableDevices: resolvedDevice.available || []
      });
    }
    const deviceId = resolvedDevice.deviceId;

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

    let resultData: any = {
      action,
      deviceId,
      requestedAction,
      matchedBy: action === 'tap_by_text' || action === 'wait_for_element'
        ? { mode: textMatchMode, ignoreCase, occurrenceIndex }
        : undefined,
      capabilities: {
        aliases: ['click→tap', 'type_text→text', 'press→keyevent', 'snapshot→context_snapshot'],
        autoDeviceResolution: true,
        textMatching: ['exact', 'contains', 'regex']
      }
    };
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
        resultData.hierarchyLength = xml.length;
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
        const matches = await findHierarchyMatches(xml, targetText, textMatchMode, ignoreCase);

        if (matches.length === 0) {
          return new ToolResult(false, `Could not find element with text/description matching "${targetText}"`, {
            targetText,
            mode: textMatchMode,
            ignoreCase,
          });
        }

        const selectedIndex = Math.max(0, Math.min(occurrenceIndex, matches.length - 1));
        const chosen = matches[selectedIndex];
        const center = chosen.center;

        await executeAdbCommand(deviceId, ['shell', 'input', 'tap', center.x.toString(), center.y.toString()], timeout);
        actionMessage = `Found and tapped "${targetText}" at (${center.x}, ${center.y}) [match ${selectedIndex + 1}/${matches.length}]`;
        resultData.coordinates = center;
        resultData.matchCount = matches.length;
        resultData.selectedMatch = {
          index: selectedIndex,
          ...chosen,
        };
        if (returnMatches) {
          resultData.matches = matches;
        }
        break;
      }

      case 'wait_for_element': {
        if (!targetText) {
          return new ToolResult(false, 'targetText required for wait_for_element action');
        }
        const maxWait = timeout || 30000;
        const start = Date.now();
        let found = false;
        let foundMatches: HierarchyMatch[] = [];
        
        actionMessage = `Waiting for element "${targetText}"...`;
        
        while (Date.now() - start < maxWait) {
          const xml = await captureHierarchy(deviceId, 5000);
          const matches = await findHierarchyMatches(xml, targetText, textMatchMode, ignoreCase);
          if (matches.length > 0) {
            found = true;
            foundMatches = matches;
            break;
          }
          await new Promise(r => setTimeout(r, 2000));
        }
        
        if (!found) {
          return new ToolResult(false, `Timed out waiting for element: "${targetText}"`, {
            elapsedMs: Date.now() - start,
            timeoutMs: maxWait,
            mode: textMatchMode,
            ignoreCase,
          });
        }
        actionMessage = `Element "${targetText}" appeared on screen (${foundMatches.length} match(es))`;
        resultData.elapsedMs = Date.now() - start;
        resultData.matchCount = foundMatches.length;
        if (returnMatches) {
          resultData.matches = foundMatches;
        }
        break;
      }

      case 'context_snapshot': {
        if (includeResolution) {
          const { stdout } = await executeAdbCommand(deviceId, ['shell', 'wm', 'size'], timeout);
          const match = stdout.match(/Physical size: (\d+)x(\d+)/);
          if (match) {
            resultData.width = parseInt(match[1], 10);
            resultData.height = parseInt(match[2], 10);
          }
        }

        if (includeHierarchy) {
          const xml = await captureHierarchy(deviceId, timeout);
          resultData.hierarchy = xml;
          resultData.hierarchyLength = xml.length;
        }

        actionMessage = 'Device context snapshot captured';
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

    resultData.completedAt = new Date().toISOString();

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
    description: "ADB device serial identifier. Optional if exactly one authorized device is connected.",
    required: false
  },
  action: {
    type: "string",
    description: "UI automation action: tap/swipe/text/keyevent/screenshot/dump_hierarchy/get_resolution/tap_by_text/wait_for_element/context_snapshot with aliases click/type_text/press/hierarchy/snapshot",
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
  textMatchMode: {
    type: "string",
    description: "Text matching mode for tap_by_text/wait_for_element: exact, contains, or regex (default: exact)",
    required: false
  },
  occurrenceIndex: {
    type: "number",
    description: "Select which matching element to target (0-based index, default: 0)",
    required: false
  },
  ignoreCase: {
    type: "boolean",
    description: "Case-insensitive text matching (default: true)",
    required: false
  },
  returnMatches: {
    type: "boolean",
    description: "Return all matched hierarchy candidates for debugging/planning",
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
  },
  includeHierarchy: {
    type: "boolean",
    description: "For context_snapshot: include UI hierarchy XML (default: true)",
    required: false
  },
  includeResolution: {
    type: "boolean",
    description: "For context_snapshot: include screen resolution (default: true)",
    required: false
  }
};

export default VisualInterface;