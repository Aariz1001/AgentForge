import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

/**
 * Ensures ADB is in the system PATH. 
 * If not found, attempts to locate it in common Android SDK locations on Windows.
 */
export async function ensureAdb(): Promise<void> {
  try {
    await execAsync('adb version', { timeout: 2000 });
  } catch (e) {
    // ADB not in path, try common locations
    const commonLocations = [
      path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Android', 'android-sdk', 'platform-tools', 'adb.exe'),
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Android', 'android-sdk', 'platform-tools', 'adb.exe'),
      'C:\\adb\\adb.exe'
    ];

    for (const loc of commonLocations) {
      if (fs.existsSync(loc)) {
        const dir = path.dirname(loc);
        if (!process.env.PATH?.includes(dir)) {
          process.env.PATH = `${dir}${path.delimiter}${process.env.PATH}`;
        }
        return;
      }
    }
  }
}
