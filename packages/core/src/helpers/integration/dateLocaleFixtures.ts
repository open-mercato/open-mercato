import { test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from './api';

const SETTINGS_PATH = '/api/configs/date-locale';
const PROFILE_PATH = '/api/auth/profile';

type DateLocaleSnapshot = {
  settings: Record<string, unknown>;
  timezone: string | null;
};

async function readSnapshot(request: APIRequestContext, token: string): Promise<DateLocaleSnapshot> {
  const settings = (await (await apiRequest(request, 'GET', SETTINGS_PATH, { token })).json()) as {
    settings: Record<string, unknown>;
  };
  const profile = (await (await apiRequest(request, 'GET', PROFILE_PATH, { token })).json()) as {
    timezone?: string | null;
  };
  return { settings: settings.settings, timezone: profile.timezone ?? null };
}

/**
 * Snapshots the tenant date & time settings and the admin's personal time zone before each test
 * in the calling describe block and writes them back after it.
 *
 * These settings are tenant-wide, so a test that leaves them changed reformats every later test.
 * A `finally` inside the test is not enough: when a test times out, Playwright tears down its
 * `request` fixture before the `finally` restore can run. An `afterEach` hook still gets a live
 * `request` and its own time budget.
 */
export function restoreDateLocaleSettingsAfterEach(): void {
  let snapshot: DateLocaleSnapshot | null = null;

  test.beforeEach(async ({ request }) => {
    snapshot = await readSnapshot(request, await getAuthToken(request, 'admin'));
  });

  test.afterEach(async ({ request }) => {
    if (!snapshot) return;
    const saved = snapshot;
    snapshot = null;
    const token = await getAuthToken(request, 'admin');
    await apiRequest(request, 'PUT', SETTINGS_PATH, { token, data: saved.settings });
    await apiRequest(request, 'PUT', PROFILE_PATH, { token, data: { timezone: saved.timezone } });
  });
}
