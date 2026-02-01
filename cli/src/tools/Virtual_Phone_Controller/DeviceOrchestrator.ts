import { ToolResult } from '../index';
import chalk from 'chalk';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ensureAdb } from './utils';

const execAsync = promisify(exec);

interface DeviceOrchestratorArgs {
  action: 'boot' | 'boot_emulator' | 'wait_for_boot' | 'install_apk' | 'check_device' | 'kill_emulator' | 'screenshot' | 'list_devices' | 'list_avds' | 'setup_env';
  deviceId?: string;
  emulatorName?: string;
  apkPath?: string;
  timeout?: number;
  snapshot?: string;
  screenshotPath?: string;
}

/**
 * Manage device lifecycle, ensuring the emulator or physical device is booted and ready,
 * and handle application installations.
 * 
 * @param args - Configuration object containing action and parameters
 * @param options - Additional execution options
 * @returns ToolResult indicating success/failure with relevant data
 */
export async function DeviceOrchestrator(args: any, options: any = {}): Promise<ToolResult> {
  const tempFiles: string[] = [];
  
  try {
    // Attempt to ensure ADB is in PATH or find it
    await ensureAdb();

    const typedArgs = args as DeviceOrchestratorArgs;
    const { 
      action, 
      deviceId, 
      emulatorName, 
      apkPath, 
      timeout = 120000,
      snapshot,
      screenshotPath
    } = typedArgs;

    if (!action) {
      return new ToolResult(false, 'action is required');
    }

    switch (action) {
      case 'setup_env':
        return await setupEnv();

      case 'boot':
      case 'boot_emulator':
        return await bootEmulator(emulatorName, snapshot, timeout, tempFiles);
      
      case 'wait_for_boot':
        if (!deviceId) return new ToolResult(false, 'deviceId is required for wait_for_boot');
        return await waitForDeviceBoot(deviceId, timeout);
      
      case 'install_apk':
        if (!deviceId) return new ToolResult(false, 'deviceId is required for install_apk');
        if (!apkPath) return new ToolResult(false, 'apkPath is required for install_apk');
        return await installApk(deviceId, apkPath);
      
      case 'check_device':
        if (!deviceId) return new ToolResult(false, 'deviceId is required for check_device');
        return await checkDevice(deviceId);
      
      case 'kill_emulator':
        if (!deviceId) return new ToolResult(false, 'deviceId is required for kill_emulator');
        return await killEmulator(deviceId);
      
      case 'screenshot':
        if (!deviceId) return new ToolResult(false, 'deviceId is required for screenshot');
        const tmpPath = screenshotPath || path.join(os.tmpdir(), `screenshot_${deviceId}_${Date.now()}.png`);
        tempFiles.push(tmpPath);
        return await takeScreenshot(deviceId, tmpPath);
      
      case 'list_devices':
        return await listDevices();

      case 'list_avds':
        return await listAvds();
      
      default:
        return new ToolResult(false, `Unknown action: ${action}`);
    }

  } catch (error: any) {
    cleanupTempFiles(tempFiles);
    return new ToolResult(false, `DeviceOrchestrator failed: ${error.message}`);
  } finally {
    cleanupTempFiles(tempFiles);
  }
}

async function setupEnv(): Promise<ToolResult> {
  const status: any = {
    adbFound: false,
    emulatorFound: false,
    environmentVariables: {}
  };

  try {
    await ensureAdb();
    const { stdout } = await execAsync('adb version');
    status.adbFound = true;
    status.adbVersion = stdout.trim();
  } catch (e) {
    status.adbFound = false;
  }

  try {
    const { stdout } = await execAsync('emulator -version');
    status.emulatorFound = true;
    status.emulatorVersion = stdout.trim();
  } catch (e) {
    status.emulatorFound = false;
  }

  status.environmentVariables = {
    ANDROID_HOME: process.env.ANDROID_HOME || 'not set',
    ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT || 'not set',
    PATH: process.env.PATH?.split(path.delimiter).slice(0, 5).join('...') // Truncated
  };

  if (status.adbFound && status.emulatorFound) {
    return new ToolResult(true, 'Android environment is correctly configured', status);
  } else {
    let advice = '';
    if (!status.adbFound) advice += 'ADB not found. Install Android SDK Platform-Tools. ';
    if (!status.emulatorFound) advice += 'Emulator not found. Install Android SDK Emulator. ';
    return new ToolResult(false, `Environment issue: ${advice.trim()}`, status);
  }
}

async function listDevices(): Promise<ToolResult> {
  try {
    const { stdout } = await execAsync('adb devices');
    const lines = stdout.trim().split('\n').slice(1);
    const devices = lines
      .filter(line => line.trim())
      .map(line => {
        const [id, state] = line.split('\t');
        return { id, state };
      });
    
    return new ToolResult(true, `Found ${devices.length} devices`, { devices });
  } catch (error: any) {
    return new ToolResult(false, `Failed to list devices: ${error.message}`);
  }
}

async function listAvds(): Promise<ToolResult> {
  try {
    const { stdout } = await execAsync('emulator -list-avds');
    const avds = stdout.trim().split('\n').filter(line => line.trim());
    return new ToolResult(true, `Found ${avds.length} AVDs`, { avds });
  } catch (error: any) {
    return new ToolResult(false, `Failed to list AVDs: ${error.message}`);
  }
}

async function bootEmulator(emulatorName: string | undefined, snapshot: string | undefined, timeout: number, tempFiles: string[]): Promise<ToolResult> {
  if (!emulatorName) {
    return new ToolResult(false, 'emulatorName is required to boot emulator');
  }

  try {
    const { stdout: avdList } = await execAsync('emulator -list-avds');
    if (!avdList.includes(emulatorName)) {
      return new ToolResult(false, `Emulator '${emulatorName}' not found. Available AVDs: ${avdList.trim() || 'none'}`);
    }

    const emulatorArgs = ['-avd', emulatorName, '-no-boot-anim', '-no-snapshot-save'];
    if (snapshot) {
      emulatorArgs.push('-snapshot', snapshot);
    }

    const emulatorProcess = spawn('emulator', emulatorArgs, {
      detached: true,
      stdio: 'ignore'
    });
    
    emulatorProcess.unref();

    console.log(chalk.blue(`Emulator ${emulatorName} starting...`));
    
    // Poll for the emulator to appear in 'adb devices'
    const findIdTimeout = 30000;
    const startFind = Date.now();
    let emulatorLine: string | undefined;

    while (Date.now() - startFind < findIdTimeout) {
      const { stdout: devices } = await execAsync('adb devices', { timeout: 5000 });
      emulatorLine = devices.split('\n').find(line => line.includes('emulator') && (line.includes('\tdevice') || line.includes('\toffline')));
      if (emulatorLine) break;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    if (!emulatorLine) {
      return new ToolResult(false, 'Emulator process started but device ID not found in adb devices after 30s. Check if emulator is booting.');
    }
    
    const deviceId = emulatorLine.split('\t')[0];
    console.log(chalk.blue(`Emulator identified with ID: ${deviceId}. Waiting for system boot...`));
    
    return await waitForDeviceBoot(deviceId, timeout, true);

  } catch (error: any) {
    if (error.message.includes('command not found') || error.code === 'ENOENT') {
      return new ToolResult(false, 'Android SDK emulator not found in PATH. Ensure Android SDK is installed and configured.');
    }
    return new ToolResult(false, `Failed to boot emulator: ${error.message}`);
  }
}

async function waitForDeviceBoot(deviceId: string, timeout: number, isNewBoot: boolean = false): Promise<ToolResult> {
  const startTime = Date.now();
  const pollInterval = 2000;
  
  console.log(chalk.blue(`Waiting for device ${deviceId} to complete boot (timeout: ${timeout}ms)...`));

  while (Date.now() - startTime < timeout) {
    try {
      const { stdout: devices } = await execAsync('adb devices', { timeout: 5000 });
      if (!devices.includes(deviceId)) {
        if (Date.now() - startTime > 15000) {
          return new ToolResult(false, `Device ${deviceId} disconnected during boot`);
        }
      } else {
        const { stdout } = await execAsync(`adb -s ${deviceId} shell getprop sys.boot_completed`, { timeout: 5000 });
        
        if (stdout.trim() === '1') {
          try {
            await execAsync(`adb -s ${deviceId} shell pm list packages`, { timeout: 10000 });
            return new ToolResult(true, `Device ${deviceId} is booted and ready`, { 
              deviceId, 
              bootTime: Date.now() - startTime,
              bootCompleted: true
            });
          } catch (pmError) {
            // Package manager not ready yet, continue polling
          }
        }
      }
    } catch (error) {
      // Polling errors are expected during early boot stages
    }
    
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  return new ToolResult(false, `Timeout waiting for device ${deviceId} to boot after ${timeout}ms`, {
    deviceId,
    bootCompleted: false,
    elapsedTime: Date.now() - startTime
  });
}

async function installApk(deviceId: string, apkPath: string): Promise<ToolResult> {
  if (!fs.existsSync(apkPath)) {
    return new ToolResult(false, `APK not found at path: ${apkPath}`);
  }

  if (!fs.statSync(apkPath).isFile() || !apkPath.endsWith('.apk')) {
    return new ToolResult(false, 'Specified path is not a valid APK file');
  }

  try {
    const { stdout: devices } = await execAsync('adb devices');
    if (!devices.includes(deviceId)) {
      return new ToolResult(false, `Device ${deviceId} not found in adb devices. Ensure device is connected.`);
    }

    const bootCheck = await execAsync(`adb -s ${deviceId} shell getprop sys.boot_completed`, { timeout: 5000 });
    if (bootCheck.stdout.trim() !== '1') {
      return new ToolResult(false, `Device ${deviceId} is not fully booted. Use 'wait_for_boot' action first.`);
    }

    console.log(chalk.blue(`Installing ${path.basename(apkPath)} on ${deviceId}...`));
    
    const { stdout, stderr } = await execAsync(
      `adb -s ${deviceId} install -r -d "${apkPath}"`, 
      { timeout: 120000 }
    );
    
    const output = stdout + stderr;
    
    if (output.includes('Success')) {
      return new ToolResult(true, `Successfully installed ${path.basename(apkPath)}`, { 
        deviceId, 
        apkPath,
        packageName: extractPackageName(output)
      });
    } else if (output.includes('INSTALL_FAILED')) {
      return new ToolResult(false, `Installation failed: ${output.match(/INSTALL_FAILED[_A-Z]+/)?.[0] || output}`);
    } else {
      return new ToolResult(false, `Installation failed: ${output}`);
    }
    
  } catch (error: any) {
    if (error.message.includes('device offline') || error.message.includes('device not found')) {
      return new ToolResult(false, `Device ${deviceId} is offline or not found`);
    }
    return new ToolResult(false, `APK installation failed: ${error.message}`);
  }
}

async function checkDevice(deviceId: string): Promise<ToolResult> {
  try {
    const { stdout: devices } = await execAsync('adb devices -l');
    const deviceLine = devices.split('\n').find(line => line.startsWith(deviceId));
    
    if (!deviceLine) {
      return new ToolResult(false, `Device ${deviceId} not found in adb devices`, { 
        connected: false,
        deviceId 
      });
    }
    
    const isAuthorized = deviceLine.includes('device');
    
    if (!isAuthorized) {
      return new ToolResult(false, `Device ${deviceId} found but status is unauthorized or offline`, {
        connected: true,
        authorized: false,
        status: deviceLine.split('\t')[1] || 'unknown'
      });
    }
    
    const [model, androidVersion, bootCompleted, sdkVersion] = await Promise.all([
      execAsync(`adb -s ${deviceId} shell getprop ro.product.model`).catch(() => ({ stdout: 'unknown' })),
      execAsync(`adb -s ${deviceId} shell getprop ro.build.version.release`).catch(() => ({ stdout: 'unknown' })),
      execAsync(`adb -s ${deviceId} shell getprop sys.boot_completed`).catch(() => ({ stdout: '0' })),
      execAsync(`adb -s ${deviceId} shell getprop ro.build.version.sdk`).catch(() => ({ stdout: 'unknown' }))
    ]);
    
    return new ToolResult(true, `Device ${deviceId} status retrieved`, {
      connected: true,
      authorized: true,
      deviceId,
      model: model.stdout.trim(),
      androidVersion: androidVersion.stdout.trim(),
      sdkVersion: sdkVersion.stdout.trim(),
      bootCompleted: bootCompleted.stdout.trim() === '1',
      isEmulator: deviceId.startsWith('emulator')
    });
    
  } catch (error: any) {
    return new ToolResult(false, `Failed to check device: ${error.message}`);
  }
}

async function killEmulator(deviceId: string): Promise<ToolResult> {
  try {
    if (!deviceId.startsWith('emulator')) {
      return new ToolResult(false, `Cannot kill physical device ${deviceId}. Use 'adb reboot' for physical devices.`, { deviceId });
    }
    
    await execAsync(`adb -s ${deviceId} emu kill`, { timeout: 10000 });
    return new ToolResult(true, `Emulator ${deviceId} terminated successfully`, { deviceId });
  } catch (error: any) {
    return new ToolResult(false, `Failed to kill emulator: ${error.message}`);
  }
}

async function takeScreenshot(deviceId: string, screenshotPath: string): Promise<ToolResult> {
  try {
    // exec already uses a shell by default, which is needed for redirection (>)
    await execAsync(`adb -s ${deviceId} exec-out screencap -p > "${screenshotPath}"`, { 
      timeout: 30000
    });
    
    if (!fs.existsSync(screenshotPath) || fs.statSync(screenshotPath).size === 0) {
      return new ToolResult(false, 'Screenshot file was not created or is empty');
    }
    
    return new ToolResult(true, `Screenshot captured`, { 
      deviceId, 
      screenshotPath,
      size: fs.statSync(screenshotPath).size
    });
  } catch (error: any) {
    return new ToolResult(false, `Screenshot failed: ${error.message}`);
  }
}

function cleanupTempFiles(files: string[]) {
  files.forEach(file => {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (e) {
      // Ignore cleanup errors to ensure primary operation completes
    }
  });
}

function extractPackageName(installOutput: string): string | undefined {
  const match = installOutput.match(/pkg:\/data\/local\/tmp\/.*\.apk=(.+)/);
  return match ? match[1] : undefined;
}

// Metadata
(DeviceOrchestrator as any).description = "Manage device lifecycle, ensuring the emulator or physical device is booted and ready, and handle application installations. Supports polling for boot completion, APK validation, and device state management.";
(DeviceOrchestrator as any).parameters = {
  action: {
    type: "string",
    description: "Action to perform: 'setup_env' (diagnostic check and ADB path config), 'boot' (alias for boot_emulator), 'boot_emulator' (start AVD), 'wait_for_boot' (poll until ready), 'install_apk' (install app), 'check_device' (get status), 'kill_emulator' (stop emulator), 'screenshot' (capture screen), 'list_devices' (list connected devices), or 'list_avds' (list available virtual devices)",
    required: true,
    enum: ["setup_env", "boot", "boot_emulator", "wait_for_boot", "install_apk", "check_device", "kill_emulator", "screenshot", "list_devices", "list_avds"]
  },
  deviceId: {
    type: "string",
    description: "Device identifier from 'adb devices' (e.g., 'emulator-5554' for virtual or 'ABC123DEF' for physical)",
    required: false
  },
  emulatorName: {
    type: "string",
    description: "AVD name for booting emulator (use 'emulator -list-avds' to see available)",
    required: false
  },
  apkPath: {
    type: "string",
    description: "Absolute path to APK file on host for installation. File existence is validated before transfer.",
    required: false
  },
  timeout: {
    type: "number",
    description: "Timeout in milliseconds for boot operations (default: 120000ms)",
    required: false
  },
  snapshot: {
    type: "string",
    description: "Snapshot name to load when booting emulator (optional)",
    required: false
  },
  screenshotPath: {
    type: "string",
    description: "Custom path for screenshot (defaults to temp directory with auto-cleanup)",
    required: false
  }
};

export default DeviceOrchestrator;