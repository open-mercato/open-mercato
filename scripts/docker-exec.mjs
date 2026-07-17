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
 *   DOCKER_COMPOSE_FILE  – path to a specific compose file to use; bypasses
 *                          auto-discovery entirely
 *
 * Auto-discovery order (when DOCKER_COMPOSE_FILE is not set):
 *   1. Any compose.*dev*.local.yml in starters/docker/ or legacy
 *      docker-compose.*dev*.local.yml in the repo root (sorted, gitignored
 *      personal overrides — place your custom stack here)
 *   2. starters/docker/compose.fullapp.dev.yml  (standard dev stack)
 *   3. starters/docker/compose.fullapp.yml       (production-like stack)
 *
 * Every compose invocation passes --project-directory <repo root> so .env
 * interpolation, relative paths, and the compose project name stay anchored
 * at the repo root regardless of where the compose file lives.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

// Ordered fallback list used when no *.local.yml override is discovered and
// DOCKER_COMPOSE_FILE is not set.
const COMPOSE_FILES_FALLBACK = [
  join('starters', 'docker', 'compose.fullapp.dev.yml'),
  join('starters', 'docker', 'compose.fullapp.yml'),
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

// Returns a prioritised list of compose file candidates to probe.
// Local override files (compose.*dev*.local.yml in starters/docker/, plus the
// legacy docker-compose.*dev*.local.yml convention at the repo root) are
// discovered dynamically so contributors do not need to export
// DOCKER_COMPOSE_FILE manually.
function discoverComposeFiles() {
  const localOverrides = [];
  try {
    for (const file of readdirSync(join(repoRoot, 'starters', 'docker')).sort()) {
      if (/^compose.*dev.*\.local\.yml$/.test(file)) {
        localOverrides.push(join('starters', 'docker', file));
      }
    }
  } catch {
    // Ignore — readdirSync can fail in restricted environments.
  }
  try {
    for (const file of readdirSync(repoRoot).sort()) {
      if (/^docker-compose.*dev.*\.local\.yml$/.test(file)) {
        localOverrides.push(file);
      }
    }
  } catch {
    // Ignore — readdirSync can fail in restricted environments.
  }
  return [...localOverrides, ...COMPOSE_FILES_FALLBACK];
}

function toComposePath(composeFile) {
  return isAbsolute(composeFile) ? composeFile : join(repoRoot, composeFile);
}

function isContainerRunning(composeFile) {
  const result = spawnSync(
    'docker',
    ['compose', '--project-directory', repoRoot, '-f', toComposePath(composeFile), 'ps', '--status', 'running', '-q', 'app'],
    { encoding: 'utf-8' },
  );
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim();
    if (stderr.length > 0) {
      // Non-zero exit with stderr typically means a compose-file parse or
      // configuration error rather than simply "no container running".
      // Warn explicitly instead of silently falling through to the next candidate
      // (which could be the production profile, blocking dev tooling).
      console.warn(`[docker-exec] Warning: skipping "${composeFile}" — compose probe failed.`);
      console.warn(`[docker-exec]   ${stderr.split('\n')[0]}`);
      console.warn(`[docker-exec]   Fix the compose file or force it with: DOCKER_COMPOSE_FILE=${composeFile}`);
    }
    return false;
  }
  return result.stdout.trim().length > 0;
}

function findActiveComposeFile() {
  const override = process.env.DOCKER_COMPOSE_FILE;
  if (override) {
    if (existsSync(override)) return override;
    const rootRelative = join(repoRoot, override);
    if (existsSync(rootRelative)) return rootRelative;
    console.error(`Error: DOCKER_COMPOSE_FILE="${override}" does not exist.`);
    console.error('Note: the compose files moved to starters/docker/ (e.g. starters/docker/compose.fullapp.dev.yml).');
    process.exit(1);
  }

  for (const file of discoverComposeFiles()) {
    if (existsSync(join(repoRoot, file)) && isContainerRunning(file)) {
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
  console.error('    docker compose --project-directory . -f starters/docker/compose.fullapp.dev.yml up --build');
  console.error('');
  console.error('  Full-app mode:');
  console.error('    docker compose --project-directory . -f starters/docker/compose.fullapp.yml up --build');
  console.error('');
  console.error('Using a custom compose file? Either:');
  console.error('  (a) Name it starters/docker/compose.*dev*.local.yml for auto-discovery, or');
  console.error('  (b) Set DOCKER_COMPOSE_FILE before running:');
  console.error('        DOCKER_COMPOSE_FILE=starters/docker/compose.fullapp.dev.local.yml yarn docker:typecheck');
  process.exit(1);
}

const [script, ...scriptArgs] = args;
const skipRebuiltFlag = '--skip-rebuilt';
const skipRebuiltMarker = '/tmp/docker-exec-skip-rebuilt.skip';
const forwardedScriptArgs = scriptArgs.filter((arg) => arg !== skipRebuiltFlag);

function runDockerCommand(commandArgs) {
  return spawnSync('docker', commandArgs, { stdio: 'inherit' });
}

// A compose file is production-only (fullapp) when its basename contains
// 'fullapp' but not 'dev' — e.g. docker-compose.fullapp.yml.
// Everything else, including *.local.yml dev overrides, is dev-capable.
const composeBasename = basename(composeFile);
const isFullappCompose = composeBasename.includes('fullapp') && !composeBasename.includes('dev');
const isDevCompose = !isFullappCompose;

function printUnsupportedFullappCommand(scriptName) {
  console.error(`[docker-exec] "${scriptName}" is unsupported in the production-like Docker profile.`);
  console.error('[docker-exec] The fullapp stack is runtime-only and does not expose monorepo dev tooling.');
  console.error('[docker-exec] Use the dev stack for this command instead:');
  console.error('[docker-exec]   yarn docker:dev:up');
  console.error(`[docker-exec]   DOCKER_COMPOSE_FILE=starters/docker/compose.fullapp.dev.yml yarn docker:${scriptName}`);
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
      '--project-directory',
      repoRoot,
      '-f',
      toComposePath(composeFile),
      'exec',
      'app',
      'touch',
      skipRebuiltMarker,
    ]);

    if ((skipRebuiltResult.status ?? 1) !== 0) {
      process.exit(skipRebuiltResult.status ?? 1);
    }
  }

  const restartResult = runDockerCommand(['compose', '--project-directory', repoRoot, '-f', toComposePath(composeFile), 'restart', 'app']);
  if ((restartResult.status ?? 1) !== 0) {
    process.exit(restartResult.status ?? 1);
  }

  const logsResult = runDockerCommand(['compose', '--project-directory', repoRoot, '-f', toComposePath(composeFile), 'logs', '-f', 'app']);
  process.exit(logsResult.status ?? 0);
}

if (isFullappCompose && UNSUPPORTED_FULLAPP_SCRIPTS.has(script)) {
  printUnsupportedFullappCommand(script);
  process.exit(1);
}

const execArgs = ['compose', '--project-directory', repoRoot, '-f', toComposePath(composeFile), 'exec', 'app', 'yarn', script, ...forwardedScriptArgs];

console.log(`[docker-exec] Running in container (${composeFile}):`);
console.log(`[docker-exec]   yarn ${[script, ...forwardedScriptArgs].join(' ')}`);
console.log('');

const result = spawnSync('docker', execArgs, { stdio: 'inherit' });
process.exit(result.status ?? 1);
