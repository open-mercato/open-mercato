import { type APIResponse } from '@playwright/test'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

export type JsonRecord = Record<string, unknown>

export const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

export async function readJson(response: APIResponse): Promise<JsonRecord> {
  return ((await readJsonSafe<JsonRecord>(response)) ?? {}) as JsonRecord
}

/**
 * Builds a per-run-unique integration id so each spec's seeded runs/schedules are
 * isolated from any other rows in the shared tenant — list/filter assertions can
 * then be exact, and cleanup can hard-delete by integration id.
 */
export function uniqueIntegrationId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * `POST/PUT /api/data_sync/schedules` returns 422 when the optional `scheduler`
 * module is not registered (the schedule service throws before persisting a job).
 * Schedule write tests treat that as an environment skip rather than a failure.
 */
export function isSchedulerUnavailable(body: JsonRecord): boolean {
  const message = String(body.error ?? body.message ?? '')
  return /scheduler module is not available/i.test(message)
}
