import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { DEFAULT_CREDENTIALS, login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFilePath);
const repoRoot = path.resolve(currentDirectory, '../../../../../../..');
const previewBaseUrl = 'http://127.0.0.1:5000';
const previewLoginUrl = `${previewBaseUrl}/login`;
const previewBackendUrl = `${previewBaseUrl}/backend`;
const previewCompaniesUrl = `${previewBaseUrl}/backend/customers/companies`;
const previewStackStartTimeoutMs = 12 * 60 * 1000;
const previewStackStopTimeoutMs = 2 * 60 * 1000;
const previewApiPollTimeoutMs = 30_000;
const uiSearchSettledDelayMs = 1_200;
const maxLogCharacters = 16_000;

type RunningCommand = {
  child: ChildProcessWithoutNullStreams;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
};

type CompanyListResponse = {
  items?: Array<{
    display_name?: unknown;
    displayName?: unknown;
  }>;
};

function yarnBinary(): string {
  return process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
}

function buildRepoCommandEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    FORCE_COLOR: '0',
    NEXT_TELEMETRY_DISABLED: '1',
    CI: 'true',
    BROWSER: 'none',
    OM_CLI_QUIET: '1',
  };
}

function appendLog(existing: string, chunk: string): string {
  const combined = `${existing}${chunk}`;
  return combined.length > maxLogCharacters ? combined.slice(-maxLogCharacters) : combined;
}

function formatCommandFailure(message: string, running: RunningCommand): Error {
  const stdout = running.stdout.trim();
  const stderr = running.stderr.trim();
  const details = [
    message,
    stdout ? `stdout:\n${stdout}` : null,
    stderr ? `stderr:\n${stderr}` : null,
  ].filter((value): value is string => Boolean(value));
  return new Error(details.join('\n\n'));
}

function runRepoCommand(args: string[]): string {
  const result = spawnSync(yarnBinary(), args, {
    cwd: repoRoot,
    env: buildRepoCommandEnv(),
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const details = [
      `Command failed: ${yarnBinary()} ${args.join(' ')}`,
      result.stdout?.trim() ? `stdout:\n${result.stdout.trim()}` : null,
      result.stderr?.trim() ? `stderr:\n${result.stderr.trim()}` : null,
    ].filter((value): value is string => Boolean(value));
    throw new Error(details.join('\n\n'));
  }

  return result.stdout ?? '';
}

function startPreviewStack(): RunningCommand {
  const child = spawn(yarnBinary(), ['docker:ephemeral'], {
    cwd: repoRoot,
    env: buildRepoCommandEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const running: RunningCommand = {
    child,
    stdout: '',
    stderr: '',
    exitCode: null,
    signal: null,
  };

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  child.stdout.on('data', (chunk: string) => {
    running.stdout = appendLog(running.stdout, chunk);
  });
  child.stderr.on('data', (chunk: string) => {
    running.stderr = appendLog(running.stderr, chunk);
  });
  child.on('exit', (code, signal) => {
    running.exitCode = code;
    running.signal = signal;
  });
  child.on('error', (error) => {
    running.stderr = appendLog(running.stderr, `${error.message}\n`);
  });

  return running;
}

async function waitForChildExit(running: RunningCommand, timeoutMs: number): Promise<void> {
  if (running.exitCode !== null || running.signal !== null) {
    return;
  }

  let timer: NodeJS.Timeout | null = null;
  try {
    await Promise.race([
      once(running.child, 'exit'),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(formatCommandFailure('Timed out waiting for preview stack command to exit.', running));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function waitForEndpoint(url: string, running: RunningCommand | null, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (running && (running.exitCode !== null || running.signal !== null)) {
      throw formatCommandFailure(`Preview stack exited before ${url} became reachable.`, running);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        const response = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
        });
        if (response.ok) {
          return;
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch {
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  if (running) {
    throw formatCommandFailure(`Timed out waiting for ${url} to become reachable.`, running);
  }

  throw new Error(`Timed out waiting for ${url} to become reachable.`);
}

async function waitForPreviewUnavailable(timeoutMs = previewStackStopTimeoutMs): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2_000);
      try {
        await fetch(previewLoginUrl, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Timed out waiting for ${previewBaseUrl} to stop responding.`);
}

async function stopPreviewStack(running: RunningCommand | null): Promise<void> {
  runRepoCommand(['docker:ephemeral:down']);

  if (running) {
    await waitForChildExit(running, previewStackStopTimeoutMs);
  }

  await waitForPreviewUnavailable();
}

async function createPreviewPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  process.env.BASE_URL = previewBaseUrl;
  const context = await browser.newContext({ baseURL: previewBaseUrl });
  const page = await context.newPage();
  return { context, page };
}

async function expectLoginPage(page: Page): Promise<void> {
  await page.goto(previewBackendUrl, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/login(?:\?|$)/i);
  await expect(page.getByLabel('Email')).toBeVisible({ timeout: 20_000 });
}

async function createCompanyViaUi(page: Page, companyName: string): Promise<string> {
  await page.goto('/backend/customers/companies/create', { waitUntil: 'domcontentloaded' });
  await page.locator('form').getByRole('textbox').first().fill(companyName);
  await page.getByPlaceholder('https://example.com').fill('https://example.com');
  await page.locator('form').getByRole('button', { name: /Create Company/i }).click();

  await expect(page).toHaveURL(/\/backend\/customers\/companies-v2\/([0-9a-f-]{36})$/i);
  await expect(page.getByText(companyName, { exact: true }).first()).toBeVisible();

  const idMatch = page.url().match(/\/backend\/customers\/companies-v2\/([0-9a-f-]{36})$/i);
  const companyId = idMatch?.[1] ?? null;
  expect(companyId, 'Expected created company id in detail URL').toBeTruthy();
  return companyId as string;
}

async function openCompaniesList(page: Page): Promise<void> {
  await page.goto(previewCompaniesUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Refresh' }).waitFor();
  const contactDialog = page.getByRole('dialog', { name: /Talk to Open Mercato team/i });
  if (await contactDialog.count()) {
    await contactDialog.getByRole('button', { name: 'Close' }).click().catch(() => {});
  }
}

async function countVisibleCompanies(page: Page, companyName: string): Promise<number> {
  const searchInput = page.getByPlaceholder(/Search by name/i);
  await searchInput.fill(companyName);
  await page.waitForTimeout(uiSearchSettledDelayMs);
  await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
  return page.getByRole('link', { name: companyName, exact: true }).count();
}

async function getPreviewAuthToken(request: APIRequestContext): Promise<string> {
  const credentials = DEFAULT_CREDENTIALS.admin;
  const form = new URLSearchParams();
  form.set('email', credentials.email);
  form.set('password', credentials.password);

  const response = await request.post(`${previewBaseUrl}/api/auth/login`, {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    data: form.toString(),
  });

  expect(response.ok(), 'Expected preview stack login API to succeed').toBeTruthy();
  const body = await response.json() as { token?: unknown };
  expect(typeof body.token, 'Expected preview stack login response to include a token').toBe('string');
  return body.token as string;
}

async function countCompaniesByExactName(
  request: APIRequestContext,
  token: string,
  companyName: string,
): Promise<number> {
  const response = await request.get(
    `${previewBaseUrl}/api/customers/companies?search=${encodeURIComponent(companyName)}&pageSize=20`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  expect(response.ok(), 'Expected preview stack companies API to succeed').toBeTruthy();
  const body = await response.json() as CompanyListResponse;
  const items = Array.isArray(body.items) ? body.items : [];
  return items.filter((item) => item.display_name === companyName || item.displayName === companyName).length;
}

/**
 * TC-DOCKER-008: Ephemeral Stack Startup and Data Reset
 * Source: .ai/qa/scenarios/TC-DOCKER-008-ephemeral-stack.md
 */
test.describe('TC-DOCKER-008: Ephemeral Stack Startup and Data Reset', () => {
  test('should reset preview stack data after docker:ephemeral is torn down and started again', async ({ browser, request }) => {
    test.skip(
      process.env.OM_RUN_DOCKER_INTEGRATION !== 'true',
      'Set OM_RUN_DOCKER_INTEGRATION=true to run real Docker preview lifecycle coverage.',
    );

    const companyName = `QA TC-DOCKER-008 ${Date.now()}`;
    const previousBaseUrl = process.env.BASE_URL;
    let firstRun: RunningCommand | null = null;
    let secondRun: RunningCommand | null = null;
    let firstContext: BrowserContext | null = null;
    let secondContext: BrowserContext | null = null;

    try {
      runRepoCommand(['docker:ephemeral:down']);
      await waitForPreviewUnavailable();

      firstRun = startPreviewStack();
      await waitForEndpoint(previewLoginUrl, firstRun, previewStackStartTimeoutMs);

      const firstPreview = await createPreviewPage(browser);
      firstContext = firstPreview.context;
      const firstPage = firstPreview.page;

      await expectLoginPage(firstPage);
      await login(firstPage, 'admin');
      await createCompanyViaUi(firstPage, companyName);
      await openCompaniesList(firstPage);
      await expect
        .poll(async () => countVisibleCompanies(firstPage, companyName), { timeout: 20_000 })
        .toBeGreaterThan(0);

      const firstToken = await getPreviewAuthToken(request);
      await expect
        .poll(async () => countCompaniesByExactName(request, firstToken, companyName), { timeout: previewApiPollTimeoutMs })
        .toBeGreaterThan(0);

      await firstContext.close();
      firstContext = null;

      await stopPreviewStack(firstRun);
      firstRun = null;

      secondRun = startPreviewStack();
      await waitForEndpoint(previewLoginUrl, secondRun, previewStackStartTimeoutMs);

      const secondPreview = await createPreviewPage(browser);
      secondContext = secondPreview.context;
      const secondPage = secondPreview.page;

      await expectLoginPage(secondPage);
      await login(secondPage, 'admin');
      await openCompaniesList(secondPage);
      await expect
        .poll(async () => countVisibleCompanies(secondPage, companyName), { timeout: 20_000 })
        .toBe(0);

      const secondToken = await getPreviewAuthToken(request);
      await expect
        .poll(async () => countCompaniesByExactName(request, secondToken, companyName), { timeout: previewApiPollTimeoutMs })
        .toBe(0);
    } finally {
      if (firstContext) {
        await firstContext.close().catch(() => {});
      }
      if (secondContext) {
        await secondContext.close().catch(() => {});
      }
      try {
        await stopPreviewStack(secondRun);
      } catch {
      }
      try {
        await stopPreviewStack(firstRun);
      } catch {
      }
      process.env.BASE_URL = previousBaseUrl;
    }
  });
});
