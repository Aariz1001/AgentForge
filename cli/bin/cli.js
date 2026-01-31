#!/usr/bin/env node

/**
 * AgentForge CLI Wrapper
 * Loads the TypeScript CLI using tsx
 */

const { execSync } = require('child_process');
const path = require('path');

const cliPath = path.join(__dirname, '..', 'src', 'index.ts');

try {
  execSync(`npx tsx ${cliPath} ${process.argv.slice(2).join(' ')}`, {
    stdio: 'inherit',
    cwd: process.cwd() // Use the directory where user ran the command
  });
} catch (error) {
  process.exit(error.status || 1);
}
