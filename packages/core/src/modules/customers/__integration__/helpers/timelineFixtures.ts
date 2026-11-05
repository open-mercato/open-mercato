import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityByBody,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures';

export const TIMELINE_PAGE = '/backend/customers/deals/timeline';

export type TimelineFixtureScope = {
  stamp: number;
  pipelineId: string;
  pipelineName: string;
  stageIds: string[];
  companyId: string;
  companyName: string;
  personId: string;
  personName: string;
  dealIds: string[];
};

export async function createTimelineScope(
  request: APIRequestContext,
  token: string,
  prefix: string,
  stageCount = 2,
): Promise<TimelineFixtureScope> {
  const stamp = Date.now();
  const pipelineName = `${prefix} Pipeline ${stamp}`;
  const pipelineId = await createPipelineFixture(request, token, { name: pipelineName });
  const stageIds: string[] = [];
  for (let order = 0; order < stageCount; order += 1) {
    stageIds.push(
      await createPipelineStageFixture(request, token, {
        pipelineId,
        label: `${prefix} Stage ${order} ${stamp}`,
        order,
      }),
    );
  }
  const companyName = `${prefix} Company ${stamp}`;
  const companyId = await createCompanyFixture(request, token, companyName);
  const personName = `${prefix} Person ${stamp}`;
  const personId = await createPersonFixture(request, token, {
    firstName: `${prefix} Person`,
    lastName: String(stamp),
    displayName: personName,
  });
  return {
    stamp,
    pipelineId,
    pipelineName,
    stageIds,
    companyId,
    companyName,
    personId,
    personName,
    dealIds: [],
  };
}

export async function addTimelineDeal(
  request: APIRequestContext,
  token: string,
  scope: TimelineFixtureScope,
  input: {
    title: string;
    date?: string;
    ownerUserId?: string;
    stageId?: string;
    status?: string;
    valueAmount?: number;
    withLinks?: boolean;
  },
): Promise<string> {
  const id = await createDealFixture(request, token, {
    title: input.title,
    pipelineId: scope.pipelineId,
    pipelineStageId: input.stageId ?? scope.stageIds[0],
    status: input.status ?? 'open',
    expectedCloseAt: input.date ? `${input.date}T00:00:00.000Z` : undefined,
    ownerUserId: input.ownerUserId,
    valueAmount: input.valueAmount ?? 1200,
    valueCurrency: 'USD',
    companyIds: input.withLinks === false ? undefined : [scope.companyId],
    personIds: input.withLinks === false ? undefined : [scope.personId],
  });
  scope.dealIds.push(id);
  return id;
}

export async function cleanupTimelineScope(
  request: APIRequestContext,
  token: string | null,
  scope: TimelineFixtureScope | null,
): Promise<void> {
  if (!scope || !token) return;
  for (const id of scope.dealIds) {
    await deleteEntityIfExists(request, token, '/api/customers/deals', id);
  }
  await deleteEntityIfExists(request, token, '/api/customers/people', scope.personId);
  await deleteEntityIfExists(request, token, '/api/customers/companies', scope.companyId);
  for (const id of scope.stageIds) {
    await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', id);
  }
  await deleteEntityByBody(request, token, '/api/customers/pipelines', scope.pipelineId);
}

export async function readDeal(
  request: APIRequestContext,
  token: string,
  dealId: string,
): Promise<Record<string, unknown> | null> {
  const response = await apiRequest(request, 'GET', `/api/customers/deals?ids=${dealId}`, { token });
  expect(response.status()).toBe(200);
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response);
  return body?.items?.[0] ?? null;
}

export function readDateKey(record: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length >= 10) return value.slice(0, 10);
  }
  return null;
}

export async function loginWithCredentials(page: Page, email: string, password: string): Promise<void> {
  const form = new URLSearchParams();
  form.set('email', email);
  form.set('password', password);
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  });
  expect(response.ok(), `login for ${email} should succeed`).toBeTruthy();
  const body = (await response.json().catch(() => null)) as { token?: string } | null;
  const token = body?.token ?? '';
  const payload = token.split('.')[1] ?? '';
  const claims = payload
    ? (JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as {
        tenantId?: string;
        orgId?: string;
      })
    : {};
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const cookies = [];
  if (claims.tenantId) cookies.push({ name: 'om_selected_tenant', value: claims.tenantId, url: baseUrl, sameSite: 'Lax' as const });
  if (claims.orgId) cookies.push({ name: 'om_selected_org', value: claims.orgId, url: baseUrl, sameSite: 'Lax' as const });
  if (cookies.length) await page.context().addCookies(cookies);
}

export function timelineCard(page: Page, dealId: string): Locator {
  return page.locator(`[data-timeline-card][data-deal-id="${dealId}"]`);
}

export function timelineCell(page: Page, laneKey: string, column: number): Locator {
  return page.locator(`[data-timeline-cell][data-lane-key="${laneKey}"][data-column="${column}"]`);
}

export async function installDevNoticeHandler(page: Page): Promise<void> {
  await page.addLocatorHandler(page.getByRole('status').filter({ hasText: /Runtime degraded/i }), async (notice) => {
    await notice.getByRole('button', { name: 'Dismiss' }).click({ force: true }).catch(() => undefined);
  });
}

export async function dismissDevRuntimeNotice(page: Page): Promise<void> {
  const notice = page.getByRole('status').filter({ hasText: /Runtime degraded/i });
  await notice.waitFor({ state: 'visible', timeout: 1_500 }).catch(() => undefined);
  if (await notice.isVisible().catch(() => false)) {
    await notice.getByRole('button', { name: 'Dismiss' }).click({ force: true }).catch(() => undefined);
  }
}

export async function openTimeline(page: Page, query: string, options: { expectGrid?: boolean } = {}): Promise<void> {
  await page.goto(`${TIMELINE_PAGE}?${query}`, { waitUntil: 'domcontentloaded' });
  if (options.expectGrid === false) {
    await expect(page.getByRole('heading', { name: 'Deals Timeline' })).toBeVisible({ timeout: 30_000 });
  } else {
    await expect(page.getByRole('grid')).toBeVisible({ timeout: 30_000 });
  }
  await dismissDevRuntimeNotice(page);
}
