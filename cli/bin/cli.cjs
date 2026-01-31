#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

// Get the path to the CLI source
const cliPath = path.join(__dirname, '..', 'src', 'index.ts');
const cliDir = path.join(__dirname, '..');

// Use tsx from node_modules
const tsxPath = path.join(__dirname, '..', 'node_modules', '.bin', 'tsx');

// Run tsx with the CLI entry point
const args = [cliPath, ...process.argv.slice(2)];
const child = spawn(process.platform === 'win32' ? `${tsxPath}.cmd` : tsxPath, args, {
  stdio: 'inherit',
  cwd: process.cwd(), // Use the directory where user ran the command
  shell: false
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
