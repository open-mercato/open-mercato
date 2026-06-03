import { expect, type APIRequestContext, type Page } from '@playwright/test'
import {
  OPTIMISTIC_LOCK_HEADER_NAME,
  OPTIMISTIC_LOCK_CONFLICT_CODE,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * Shared helpers for the browser-driven optimistic-lock specs
 * (`TC-LOCK-OSS-014..046`). They make the conflict deterministic without two
 * real tabs or sleeps: the spec loads an edit page in the browser (the form
 * captures the record's `updated_at`), then advances `updated_at` out-of-band
 * via a header-less API PUT (additive path, always succeeds), and finally edits
 * + saves in the browser so the now-stale header triggers the 409 → conflict bar.
 *
 * See `packages/core/src/modules/sales/__integration__/__concurrent_edit_pattern.md`
 * and the conflict bar component
 * `packages/ui/src/backend/conflicts/RecordConflictBanner.tsx`
 * (`data-testid="record-conflict-banner"`).
 */

const BASE_URL = process.env.BASE_URL?.trim() || ''

export function resolveApiUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

export const CONFLICT_BANNER_TESTID = 'record-conflict-banner'

function authHeaders(token: string, lockValue?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  if (lockValue !== undefined) headers[OPTIMISTIC_LOCK_HEADER_NAME] = lockValue
  return headers
}

/**
 * Read a record's current `updated_at` from a list-shaped CRUD GET
 * (`GET <basePath>?id=<id>` → `items[0].updated_at`), normalized to ISO.
 * Works for the `makeCrudRoute` list responses (snake or camel case).
 */
export async function readUpdatedAt(
  request: APIRequestContext,
  token: string,
  basePath: string,
  id: string,
  idParam = 'id',
): Promise<string> {
  const response = await request.fetch(
    resolveApiUrl(`${basePath}?${idParam}=${encodeURIComponent(id)}`),
    { method: 'GET', headers: authHeaders(token) },
  )
  expect(response.status(), `GET ${basePath}?${idParam}=... should be 200`).toBe(200)
  const body = (await response.json()) as
    | { items?: Array<Record<string, unknown>> }
    | Record<string, unknown>
  const item = Array.isArray((body as { items?: unknown[] }).items)
    ? (body as { items: Array<Record<string, unknown>> }).items[0]
    : (body as Record<string, unknown>)
  expect(item, `response should include the record for id=${id}`).toBeTruthy()
  const raw = (item?.updated_at ?? item?.updatedAt) as string | undefined
  expect(typeof raw, `record should expose updated_at, got ${String(raw)}`).toBe('string')
  const ms = Date.parse(raw as string)
  expect(Number.isFinite(ms), `updated_at should parse, got ${String(raw)}`).toBe(true)
  return new Date(ms).toISOString()
}

/**
 * Advance a record's `updated_at` out-of-band so the browser's loaded form now
 * holds a stale token. Uses a **header-less** PUT (the strictly-additive path
 * always succeeds and bumps `updated_at`). Returns the new ISO `updated_at`.
 */
export async function bumpRecordViaApi(
  request: APIRequestContext,
  token: string,
  basePath: string,
  putBody: Record<string, unknown>,
  opts: { idParam?: string; method?: 'PUT' | 'PATCH' } = {},
): Promise<string | null> {
  const response = await request.fetch(resolveApiUrl(basePath), {
    method: opts.method ?? 'PUT',
    headers: authHeaders(token),
    data: putBody,
  })
  expect(
    response.status(),
    `out-of-band ${opts.method ?? 'PUT'} ${basePath} should succeed (additive path), got ${response.status()}`,
  ).toBeLessThan(300)
  const id = putBody[opts.idParam ?? 'id']
  if (typeof id === 'string') {
    try {
      return await readUpdatedAt(request, token, basePath, id, opts.idParam)
    } catch {
      return null
    }
  }
  return null
}

/** Direct API helpers to assert the 409 contract body (used by the negative/UX specs). */
export async function putWithLock(
  request: APIRequestContext,
  token: string,
  basePath: string,
  body: Record<string, unknown>,
  lockValue: string,
) {
  return request.fetch(resolveApiUrl(basePath), {
    method: 'PUT',
    headers: authHeaders(token, lockValue),
    data: body,
  })
}

export async function expectConflictBody(response: { status(): number; json(): Promise<unknown> }) {
  expect(response.status(), 'stale write should be 409').toBe(409)
  const body = (await response.json()) as { code?: string; currentUpdatedAt?: string; expectedUpdatedAt?: string }
  expect(body.code, 'body.code should be the optimistic-lock conflict code').toBe(OPTIMISTIC_LOCK_CONFLICT_CODE)
  return body
}

/** Assert the unified conflict bar is visible (a stale save was refused). */
export async function expectConflictBanner(page: Page): Promise<void> {
  await expect(
    page.getByTestId(CONFLICT_BANNER_TESTID),
    'the "Record changed" conflict bar should be visible after a stale save',
  ).toBeVisible({ timeout: 10_000 })
}

/** Assert the conflict bar is NOT present (a clean single-tab save must not 409). */
export async function expectNoConflictBanner(page: Page): Promise<void> {
  await expect(
    page.getByTestId(CONFLICT_BANNER_TESTID),
    'a clean save must not surface a false-positive conflict bar',
  ).toHaveCount(0)
}

/** Click the conflict bar's Refresh button. */
export async function clickConflictRefresh(page: Page): Promise<void> {
  await page.getByTestId(CONFLICT_BANNER_TESTID).getByRole('button', { name: /refresh/i }).click()
}

/** Dismiss the conflict bar via its close (X) button. */
export async function dismissConflictBanner(page: Page): Promise<void> {
  await page.getByTestId(CONFLICT_BANNER_TESTID).getByRole('button', { name: /dismiss/i }).click()
}
