#!/usr/bin/env node
/**
 * Cross-platform Docker command bridge for Open Mercato.
 *
 * Detects the active Docker Compose profile (dev or fullapp), then executes
 * the requested yarn script inside the running app container.
 *
 * Usage:
 *   node scripts/docker-exec.mjs <yarn-script> [args...]
 *   node scripts/docker-exec.mjs dev --skip-rebuilt
 *
 * Environment overrides:
 *   DOCKER_COMPOSE_FILE  – path to a specific compose file to use
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const COMPOSE_FILES = [
  'docker-compose.fullapp.dev.yml',
  'docker-compose.fullapp.yml',
];

const UNSUPPORTED_FULLAPP_SCRIPTS = new Set([
  'dev',
  'build:packages',
  'generate',
  'initialize',
  'reinstall',
  'db:generate',
  'lint',
  'typecheck',
  'test',
  'install-skills',
]);

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: node scripts/docker-exec.mjs <yarn-script> [args...]');
  console.error('');
  console.error('Examples:');
  console.error('  node scripts/docker-exec.mjs generate');
  console.error('  node scripts/docker-exec.mjs initialize -- --reinstall');
  console.error('  node scripts/docker-exec.mjs install-skills');
  process.exit(1);
}

function isContainerRunning(composeFile) {
  const result = spawnSync(
    'docker',
    ['compose', '-f', composeFile, 'ps', '--status', 'running', '-q', 'app'],
    { encoding: 'utf-8' },
  );
  return result.status === 0 && result.stdout.trim().length > 0;
}

function findActiveComposeFile() {
  const override = process.env.DOCKER_COMPOSE_FILE;
  if (override) {
    if (!existsSync(override)) {
      console.error(`Error: DOCKER_COMPOSE_FILE="${override}" does not exist.`);
      process.exit(1);
    }
    return override;
  }

  for (const file of COMPOSE_FILES) {
    if (existsSync(file) && isContainerRunning(file)) {
      return file;
    }
  }
  return null;
}

const composeFile = findActiveComposeFile();

if (!composeFile) {
  console.error('Error: No running Open Mercato app container found.');
  console.error('');
  console.error('Start the stack first, then re-run this command:');
  console.error('');
  console.error('  Dev mode (recommended for development):');
  console.error('    docker compose -f docker-compose.fullapp.dev.yml up --build');
  console.error('');
  console.error('  Full-app mode:');
  console.error('    docker compose -f docker-compose.fullapp.yml up --build');
  console.error('');
  console.error('To target a specific compose file regardless of running state:');
  console.error('  DOCKER_COMPOSE_FILE=docker-compose.fullapp.dev.yml yarn docker:generate');
  process.exit(1);
}

const [script, ...scriptArgs] = args;
const skipRebuiltFlag = '--skip-rebuilt';
const skipRebuiltMarker = '/tmp/docker-exec-skip-rebuilt.skip';
const forwardedScriptArgs = scriptArgs.filter((arg) => arg !== skipRebuiltFlag);

function runDockerCommand(commandArgs) {
  return spawnSync('docker', commandArgs, { stdio: 'inherit' });
}

const isDevCompose = composeFile.endsWith('docker-compose.fullapp.dev.yml');
const isFullappCompose = composeFile.endsWith('docker-compose.fullapp.yml');

function printUnsupportedFullappCommand(scriptName) {
  console.error(`[docker-exec] "${scriptName}" is unsupported in the production-like Docker profile.`);
  console.error('[docker-exec] The fullapp stack is runtime-only and does not expose monorepo dev tooling.');
  console.error('[docker-exec] Use the dev stack for this command instead:');
  console.error('[docker-exec]   yarn docker:dev:up');
  console.error(`[docker-exec]   DOCKER_COMPOSE_FILE=docker-compose.fullapp.dev.yml yarn docker:${scriptName}`);
}

if (script === 'dev' && isDevCompose) {
  const shouldSkipRebuilt = scriptArgs.includes(skipRebuiltFlag);

  console.log(`[docker-exec] Reloading app service (${composeFile}) on main process...`);
  if (shouldSkipRebuilt) {
    console.log(`[docker-exec]   ${skipRebuiltFlag} enabled (skip install/build/generate on restart)`);
  }
  console.log('[docker-exec]   docker compose restart app');
  console.log('[docker-exec]   docker compose logs -f app');
  console.log('');

  if (shouldSkipRebuilt) {
    const skipRebuiltResult = runDockerCommand([
      'compose',
      '-f',
      composeFile,
      'exec',
      'app',
      'touch',
      skipRebuiltMarker,
    ]);

    if ((skipRebuiltResult.status ?? 1) !== 0) {
      process.exit(skipRebuiltResult.status ?? 1);
    }
  }

  const restartResult = runDockerCommand(['compose', '-f', composeFile, 'restart', 'app']);
  if ((restartResult.status ?? 1) !== 0) {
    process.exit(restartResult.status ?? 1);
  }

  const logsResult = runDockerCommand(['compose', '-f', composeFile, 'logs', '-f', 'app']);
  process.exit(logsResult.status ?? 0);
}

if (isFullappCompose && UNSUPPORTED_FULLAPP_SCRIPTS.has(script)) {
  printUnsupportedFullappCommand(script);
  process.exit(1);
}

const execArgs = ['compose', '-f', composeFile, 'exec', 'app', 'yarn', script, ...forwardedScriptArgs];

console.log(`[docker-exec] Running in container (${composeFile}):`);
console.log(`[docker-exec]   yarn ${[script, ...forwardedScriptArgs].join(' ')}`);
console.log('');

const result = spawnSync('docker', execArgs, { stdio: 'inherit' });
process.exit(result.status ?? 1);
