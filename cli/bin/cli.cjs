#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Get the path to the CLI source
const cliPath = path.join(__dirname, '..', 'src', 'index.ts');
const cliDir = path.join(__dirname, '..');

// Use tsx from node_modules
const candidateTsxPaths = [
  path.join(__dirname, '..', 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx'),
  path.join(__dirname, '..', '..', 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx')
];

const tsxPath = candidateTsxPaths.find(p => fs.existsSync(p));

// Run tsx with the CLI entry point
const args = [cliPath, ...process.argv.slice(2)];
const cmd = tsxPath || 'npx';
const cmdArgs = tsxPath ? args : ['tsx', ...args];

const child = spawn(cmd, cmdArgs, {
  stdio: 'inherit',
  cwd: process.cwd(), // Use the directory where user ran the command
  shell: false
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
