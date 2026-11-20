import path from 'node:path'
import { expect, type APIRequestContext } from '@playwright/test'
import { createQueue } from '@open-mercato/queue'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
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
