import { expect, test, type APIRequestContext } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  combinedOutput: string;
};

type ComposeServiceRecord = Record<string, unknown>;

const DEV_COMPOSE_FILE = 'docker-compose.fullapp.dev.yml';
const REQUIRED_SERVICE_NAMES = ['app', 'postgres', 'redis', 'meilisearch'] as const;
const OPTIONAL_RUNNING_SERVICE_NAMES = ['keycloak', 'opencode'] as const;
const ROOT = findProjectRoot();
const dockerAvailability = resolveDockerAvailability();

function findProjectRoot(): string {
  let currentDirectory = process.cwd();

  for (let index = 0; index < 12; index += 1) {
    if (existsSync(path.join(currentDirectory, 'turbo.json'))) {
      return currentDirectory;
    }
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      break;
    }
    currentDirectory = parentDirectory;
  }

  return process.cwd();
}

function isTruthy(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function yarnBinary(): string {
  return process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
}

function runCommand(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NODE_NO_WARNINGS: '1',
    },
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';

  return {
    status: result.status,
    stdout,
    stderr,
    combinedOutput: `${stdout}${stderr}`,
  };
}

function runDockerCompose(args: string[]): CommandResult {
  return runCommand('docker', ['compose', '-f', DEV_COMPOSE_FILE, ...args]);
}

function resolveDockerAvailability(): { enabled: boolean; reason: string } {
  if (!isTruthy(process.env.OM_ENABLE_DOCKER_PARITY_TESTS)) {
    return {
      enabled: false,
      reason: 'Set OM_ENABLE_DOCKER_PARITY_TESTS=1 to opt into Docker lifecycle integration coverage.',
    };
  }

  const versionProbe = runCommand('docker', ['--version']);
  if (versionProbe.status !== 0) {
    return {
      enabled: false,
      reason: 'Docker CLI is unavailable in this runtime.',
    };
  }

  const infoProbe = runCommand('docker', ['info']);
  if (infoProbe.status !== 0) {
    return {
      enabled: false,
      reason: 'Docker daemon is unavailable in this runtime.',
    };
  }

  return { enabled: true, reason: '' };
}

function parseComposePsOutput(output: string): ComposeServiceRecord[] {
  const trimmed = output.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is ComposeServiceRecord => !!entry && typeof entry === 'object');
    }
    if (parsed && typeof parsed === 'object') {
      return [parsed as ComposeServiceRecord];
    }
  } catch {
    return [];
  }

  return [];
}

function resolveServiceName(service: ComposeServiceRecord): string {
  if (typeof service.Service === 'string' && service.Service.length > 0) {
    return service.Service;
  }
  if (typeof service.service === 'string' && service.service.length > 0) {
    return service.service;
  }
  if (typeof service.Name === 'string' && service.Name.length > 0) {
    return service.Name;
  }
  if (typeof service.name === 'string' && service.name.length > 0) {
    return service.name;
  }
  return '';
}

function resolveServiceState(service: ComposeServiceRecord): string {
  const stateParts = [
    typeof service.State === 'string' ? service.State : '',
    typeof service.Health === 'string' ? service.Health : '',
    typeof service.Status === 'string' ? service.Status : '',
    typeof service.status === 'string' ? service.status : '',
  ]
    .filter((value) => value.length > 0)
    .join(' ')
    .trim()
    .toLowerCase();

  return stateParts;
}

function isRunningOrHealthy(service: ComposeServiceRecord): boolean {
  const state = resolveServiceState(service);
  return state.includes('running') || state.includes('healthy');
}

function readLoginMarkupExpectation(body: string): void {
  expect(body).toMatch(/data-auth-ready=/i);
  expect(body).toMatch(/>Email</i);
  expect(body).toMatch(/Sign in/i);
}

async function assertLoginPageReachable(request: APIRequestContext): Promise<void> {
  const backendResponse = await request.get('http://127.0.0.1:3000/backend', {
    failOnStatusCode: false,
    maxRedirects: 0,
  });

  if (backendResponse.status() === 200) {
    readLoginMarkupExpectation(await backendResponse.text());
  } else {
    expect([301, 302, 303, 307, 308]).toContain(backendResponse.status());
    expect(backendResponse.headers().location ?? '').toContain('/login');
  }

  const loginResponse = await request.get('http://127.0.0.1:3000/login', {
    failOnStatusCode: false,
  });
  expect(loginResponse.status()).toBe(200);
  readLoginMarkupExpectation(await loginResponse.text());
}

/**
 * TC-DOCKER-001: Dev stack startup and shutdown
 * Source: .ai/qa/scenarios/TC-DOCKER-001-dev-stack-startup-shutdown.md
 */
test.describe('TC-DOCKER-001: Dev stack startup and shutdown', () => {
  test.skip(!dockerAvailability.enabled, dockerAvailability.reason);

  test('starts the detached dev stack, serves the login page, and tears the stack down cleanly', async ({ request }) => {
    let stackStarted = false;

    try {
      const initialDown = runDockerCompose(['down']);
      expect(initialDown.status, initialDown.combinedOutput).toBe(0);

      const upCommand = runCommand(yarnBinary(), ['docker:dev:up']);
      expect(upCommand.status, upCommand.combinedOutput).toBe(0);
      stackStarted = true;

      const psCommand = runDockerCompose(['ps', '--format', 'json']);
      expect(psCommand.status, psCommand.combinedOutput).toBe(0);
      const services = parseComposePsOutput(psCommand.stdout);

      expect(services.length, psCommand.combinedOutput).toBeGreaterThan(0);

      const servicesByName = new Map(services.map((service) => [resolveServiceName(service), service]));

      for (const serviceName of REQUIRED_SERVICE_NAMES) {
        const service = servicesByName.get(serviceName);
        expect(service, `Expected ${serviceName} service in docker compose ps output`).toBeTruthy();
        expect(isRunningOrHealthy(service ?? {}), `Expected ${serviceName} to be running or healthy`).toBe(true);
      }

      for (const serviceName of OPTIONAL_RUNNING_SERVICE_NAMES) {
        const service = servicesByName.get(serviceName);
        if (!service) {
          continue;
        }
        expect(isRunningOrHealthy(service), `Expected ${serviceName} to be running when present`).toBe(true);
      }

      const appLogs = runDockerCompose(['logs', 'app', '--tail=20']);
      expect(appLogs.status, appLogs.combinedOutput).toBe(0);
      expect(appLogs.combinedOutput.length).toBeGreaterThan(0);

      const appProcess = runDockerCompose(['exec', '-T', 'app', 'sh', '-lc', 'ps -o args= -p 1']);
      expect(appProcess.status, appProcess.combinedOutput).toBe(0);
      expect(appProcess.combinedOutput).toMatch(/yarn dev|scripts\/dev\.mjs/i);

      await assertLoginPageReachable(request);

      const downCommand = runCommand(yarnBinary(), ['docker:dev:down']);
      expect(downCommand.status, downCommand.combinedOutput).toBe(0);
      stackStarted = false;

      const postDownPs = runDockerCompose(['ps', '--format', 'json']);
      expect(postDownPs.status, postDownPs.combinedOutput).toBe(0);
      const postDownServices = parseComposePsOutput(postDownPs.stdout);
      expect(postDownServices).toHaveLength(0);
    } finally {
      if (stackStarted) {
        runDockerCompose(['down']);
      }
    }
  });
});
