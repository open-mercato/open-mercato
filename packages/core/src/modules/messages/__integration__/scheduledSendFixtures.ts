import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { createQueue } from '@open-mercato/queue'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

const RELEASE_QUEUE = 'messages-scheduled-release'

function resolveQueueBaseDir(): string {
  const appRoot = process.env.OM_TEST_APP_ROOT?.trim()
    ? path.resolve(process.env.OM_TEST_APP_ROOT as string)
    : path.resolve(process.cwd(), 'apps/mercato')
  return process.env.QUEUE_BASE_DIR?.trim() || path.resolve(appRoot, '.mercato/queue')
}

export function scheduledAtInMinutes(minutes: number): string {
  const date = new Date(Date.now() + minutes * 60_000)
  date.setUTCSeconds(0, 0)
  return date.toISOString()
}

export async function isSchedulingAvailable(request: APIRequestContext, token: string): Promise<boolean> {
  const response = await apiRequest(request, 'GET', '/api/messages/compose-capabilities', { token })
  expect(response.ok(), 'compose capabilities are readable').toBeTruthy()
  const body = await readJsonSafe<{ schedulingAvailable?: boolean }>(response)
  return body?.schedulingAvailable === true
}

/** Moves a scheduled message's time into the past so the next release tick picks it up, instead of waiting for it. */
export async function makeScheduledMessageDue(messageId: string): Promise<void> {
  await withClient((client) => client.query(
    `update messages set scheduled_at = now() - interval '1 minute' where id = $1 and status = 'scheduled'`,
    [messageId],
  ))
}

/** Runs one release tick for the token's organization the way the scheduler does: a job on the release queue, then drained. */
export async function runScheduledRelease(token: string): Promise<void> {
  const scope = getTokenScope(token)
  const queue = createQueue<{ scope: { tenantId: string; organizationId: string } }>(RELEASE_QUEUE, 'local', { baseDir: resolveQueueBaseDir() })
  try {
    await queue.enqueue({ scope: { tenantId: scope.tenantId, organizationId: scope.organizationId } })
  } finally {
    await queue.close()
  }
  await drainIntegrationQueue(RELEASE_QUEUE)
  await drainIntegrationQueue('events')
}

export type MessageScheduleRow = {
  status: string
  is_draft: boolean
  scheduled_at: Date | null
  sent_at: Date | null
  sender_channel_id: string | null
}

export async function readMessageScheduleRow(messageId: string): Promise<MessageScheduleRow | null> {
  return withClient(async (client) => {
    const result = await client.query<MessageScheduleRow>(
      'select status, is_draft, scheduled_at, sent_at, sender_channel_id from messages where id = $1',
      [messageId],
    )
    return result.rows[0] ?? null
  })
}

export async function listMessageIds(
  request: APIRequestContext,
  token: string,
  query: Record<string, string>,
): Promise<string[]> {
  const params = new URLSearchParams({ pageSize: '100', ...query })
  const response = await apiRequest(request, 'GET', `/api/messages?${params.toString()}`, { token })
  expect(response.ok(), `GET /api/messages?${params.toString()} succeeds`).toBeTruthy()
  const body = await readJsonSafe<{ items?: Array<{ id: string }> }>(response)
  return (body?.items ?? []).map((item) => item.id)
}

export async function readUnreadCount(request: APIRequestContext, token: string): Promise<number> {
  const response = await apiRequest(request, 'GET', '/api/messages/unread-count', { token })
  expect(response.ok()).toBeTruthy()
  const body = await readJsonSafe<{ unreadCount?: number }>(response)
  return Number(body?.unreadCount ?? 0)
}

/**
 * The external email budget caps a new tenant at 20 DISTINCT recipients per UTC day, so every
 * integration spec sends only to this fixed set and isolates its captures by unique subject.
 */
export const QA_RECIPIENTS = ['qa-recipient-1@example.com', 'qa-recipient-2@example.com', 'qa-recipient-3@example.com'] as const
export const QA_COPY_RECIPIENT = 'qa-copy@example.com'
export const QA_BLIND_RECIPIENT = 'qa-blind@example.com'
export const QA_REJECT_RECIPIENT = 'qa-recipient+reject@example.com'
export const QA_RATELIMIT_RECIPIENT = 'qa-recipient+ratelimit@example.com'

const DAILY_LIMIT_NAME = 'externalEmailDailyRecipientLimit'

/**
 * Registers hooks (call inside a describe) that lift the admin tenant's daily external-recipient limit for each test and
 * restore the previous module_configs row afterwards. Earlier specs spend the new-tenant limit of 20 distinct recipients.
 * Config reads are cached for 60 s (also "not found"), so the tenant cache is purged after every change.
 */
export function useRaisedExternalEmailBudget(limit = 1000): void {
  let restore: (() => Promise<void>) | null = null
  const purgeCache = async (request: APIRequestContext, token: string) => {
    const response = await apiRequest(request, 'POST', '/api/configs/cache', { token, data: { action: 'purgeAll' } })
    expect(response.ok(), 'module config cache purge').toBeTruthy()
  }

  test.beforeEach(async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenScope(token)
    const previous = await withClient(async (client) => {
      const existing = await client.query<{ value_json: unknown }>(
        'select value_json from module_configs where tenant_id = $1 and module_id = $2 and name = $3',
        [tenantId, 'messages', DAILY_LIMIT_NAME],
      )
      const value = JSON.stringify(limit)
      if (existing.rows.length > 0) {
        await client.query(
          'update module_configs set value_json = $4::jsonb where tenant_id = $1 and module_id = $2 and name = $3',
          [tenantId, 'messages', DAILY_LIMIT_NAME, value],
        )
        return { exists: true as const, value: existing.rows[0].value_json }
      }
      await client.query(
        'insert into module_configs (id, module_id, name, value_json, tenant_id, organization_id, created_at, updated_at) values ($1, $2, $3, $4::jsonb, $5, null, now(), now())',
        [randomUUID(), 'messages', DAILY_LIMIT_NAME, value, tenantId],
      )
      return { exists: false as const }
    })
    restore = async () => {
      await withClient(async (client) => {
        if (previous.exists) {
          await client.query(
            'update module_configs set value_json = $4::jsonb where tenant_id = $1 and module_id = $2 and name = $3',
            [tenantId, 'messages', DAILY_LIMIT_NAME, JSON.stringify(previous.value)],
          )
        } else {
          await client.query(
            'delete from module_configs where tenant_id = $1 and module_id = $2 and name = $3',
            [tenantId, 'messages', DAILY_LIMIT_NAME],
          )
        }
      })
      await purgeCache(request, token)
    }
    await purgeCache(request, token)
  })

  test.afterEach(async () => {
    const run = restore
    restore = null
    if (run) await run()
  })
}
