import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * TC-DOCKER-003: Exec initialize with --reinstall
 * Source: .ai/qa/scenarios/TC-DOCKER-003-exec-initialize-reinstall.md
 */

function findProjectRoot(): string {
  let currentDirectory = process.cwd();

  for (let index = 0; index < 10; index += 1) {
    if (fs.existsSync(path.join(currentDirectory, 'turbo.json'))) {
      return currentDirectory;
    }

    currentDirectory = path.dirname(currentDirectory);
  }

  return process.cwd();
}

const PROJECT_ROOT = findProjectRoot();
const PACKAGE_JSON_PATH = path.join(PROJECT_ROOT, 'package.json');
const PATH_SEPARATOR = process.platform === 'win32' ? ';' : ':';

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function yarnBinary(): string {
  return process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
}

function runYarnCommand(args: string[], env: NodeJS.ProcessEnv): CommandResult {
  const result = spawnSync(yarnBinary(), args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env,
  });

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function writeFakeDockerExecutable(binDirectory: string, logFilePath: string): void {
  const scriptSource = `#!/usr/bin/env node
const fs = require('node:fs');

const args = process.argv.slice(2);
const logFilePath = ${JSON.stringify(logFilePath)};

fs.appendFileSync(logFilePath, JSON.stringify(args) + '\\n');

function matches(expected) {
  return expected.length === args.length && expected.every((value, index) => args[index] === value);
}

const runningAppArgs = ['compose', '-f', 'docker-compose.fullapp.dev.yml', 'ps', '--status', 'running', '-q', 'app'];
const initializeArgsVariants = [
  ['compose', '-f', 'docker-compose.fullapp.dev.yml', 'exec', 'app', 'yarn', 'initialize', '--reinstall'],
  ['compose', '-f', 'docker-compose.fullapp.dev.yml', 'exec', 'app', 'yarn', 'initialize', '--', '--reinstall'],
];

if (matches(runningAppArgs)) {
  process.stdout.write('app-container-id\\n');
  process.exit(0);
}

if (initializeArgsVariants.some((expected) => matches(expected))) {
  process.stdout.write('Applying database migrations\\n');
  process.stdout.write('Seeding default records\\n');
  process.stdout.write('Reinstalling CLI dependencies\\n');
  process.exit(0);
}

process.stderr.write('Unexpected docker invocation: ' + args.join(' ') + '\\n');
process.exit(1);
`;

  const unixExecutablePath = path.join(binDirectory, 'docker');
  fs.writeFileSync(unixExecutablePath, scriptSource, 'utf8');
  fs.chmodSync(unixExecutablePath, 0o755);

  if (process.platform === 'win32') {
    const windowsExecutablePath = path.join(binDirectory, 'docker.cmd');
    const commandSource = [
      '@echo off',
      `node "${unixExecutablePath.replace(/\//g, '\\')}" %*`,
      '',
    ].join('\r\n');
    fs.writeFileSync(windowsExecutablePath, commandSource, 'utf8');
  }
}

function readDockerInvocations(logFilePath: string): string[][] {
  if (!fs.existsSync(logFilePath)) {
    return [];
  }

  return fs
    .readFileSync(logFilePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as string[]);
}

function isSupportedInitializeInvocation(args: string[]): boolean {
  return [
    ['compose', '-f', 'docker-compose.fullapp.dev.yml', 'exec', 'app', 'yarn', 'initialize', '--reinstall'],
    ['compose', '-f', 'docker-compose.fullapp.dev.yml', 'exec', 'app', 'yarn', 'initialize', '--', '--reinstall'],
  ].some((expected) => expected.length === args.length && expected.every((value, index) => args[index] === value));
}

test.describe('TC-DOCKER-003: Exec initialize with --reinstall', () => {
  test('should forward --reinstall through yarn docker:initialize and stream initialization output', () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-docker-003-'));
    const dockerInvocationLogPath = path.join(tempDirectory, 'docker-invocations.log');

    try {
      writeFakeDockerExecutable(tempDirectory, dockerInvocationLogPath);

      const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8')) as {
        scripts?: Record<string, string>;
      };
      expect(packageJson.scripts?.['docker:initialize']).toMatch(/^node\s+\.?\/?scripts\/docker-exec\.mjs initialize$/);

      const currentPath = process.env.PATH ?? process.env.Path ?? '';
      const effectivePath = `${tempDirectory}${PATH_SEPARATOR}${currentPath}`;
      const result = runYarnCommand(['docker:initialize', '--', '--reinstall'], {
        ...process.env,
        FORCE_COLOR: '0',
        NODE_NO_WARNINGS: '1',
        PATH: effectivePath,
        Path: effectivePath,
      });

      const combinedOutput = `${result.stdout}\n${result.stderr}`;
      const dockerInvocations = readDockerInvocations(dockerInvocationLogPath);

      expect(result.exitCode).toBe(0);
      expect(combinedOutput).toContain('[docker-exec] Running in container (docker-compose.fullapp.dev.yml):');
      expect(combinedOutput).toMatch(/\[docker-exec\]\s+yarn initialize(?: --)? --reinstall/);
      expect(combinedOutput).toContain('Applying database migrations');
      expect(combinedOutput).toContain('Seeding default records');
      expect(combinedOutput).toContain('Reinstalling CLI dependencies');
      expect(dockerInvocations).toHaveLength(2);
      expect(dockerInvocations[0]).toEqual([
        'compose',
        '-f',
        'docker-compose.fullapp.dev.yml',
        'ps',
        '--status',
        'running',
        '-q',
        'app',
      ]);
      expect(isSupportedInitializeInvocation(dockerInvocations[1] ?? [])).toBe(true);
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});
