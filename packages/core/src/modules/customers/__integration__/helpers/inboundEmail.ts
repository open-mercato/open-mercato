import { expect, type APIRequestContext } from '@playwright/test'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { expectId, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

/**
 * Shared helpers for the inbound auto-link integration tests
 * (TC-CRM-EMAIL-002..005). The hub `communication_channels.message.received`
 * event is dispatched by the env-gated test-seed fixture and delivered to the
 * persistent `customers:link-channel-message-received` subscriber through the
 * `events` queue, which these helpers drain.
 */

export const INBOUND_APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT as string)
  : path.resolve(process.cwd(), 'apps/mercato')

if (!process.env.OM_TEST_APP_ROOT?.trim()) {
  loadEnv({ path: path.resolve(INBOUND_APP_ROOT, '.env') })
  process.env.QUEUE_BASE_DIR = path.resolve(INBOUND_APP_ROOT, '.mercato/queue')
}

const EVENTS_QUEUE = 'events'

/** Drain the `events` queue so the persistent link subscriber runs. */
export async function drainEventsQueue(): Promise<void> {
  await drainIntegrationQueue(EVENTS_QUEUE, { appRoot: INBOUND_APP_ROOT })
}

/**
 * Create a Person with a known `primaryEmail` so inbound address-matching can
 * resolve them. Uses the people CRUD route directly (the shared person fixture
 * does not set an email).
 */
export async function createPersonWithEmail(
  request: APIRequestContext,
  token: string,
  input: { firstName: string; lastName: string; displayName: string; primaryEmail: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/customers/people', {
    token,
    data: input,
  })
  expect(response.ok(), `POST /api/customers/people should succeed (got ${response.status()})`).toBeTruthy()
  const body = await readJsonSafe<{ id?: string; entityId?: string; personId?: string }>(response)
  return expectId(
    body?.id ?? body?.entityId ?? body?.personId,
    'person creation response should include id',
  )
}

export type EmailInteraction = {
  id: string
  visibility: string | null
  authorUserId: string | null
  externalMessageId: string | null
  title: string | null
  interactionType: string
}

/**
 * Drain the events queue, then fetch a Person's email interactions, retrying
 * until `expectedMin` rows are present (or the timeout elapses). The link
 * subscriber is persistent, so the first drain usually suffices; the retry loop
 * covers queue-runner scheduling jitter.
 */
export async function drainAndListEmailInteractions(
  request: APIRequestContext,
  token: string,
  personId: string,
  options: { expectedMin?: number; timeoutMs?: number } = {},
): Promise<EmailInteraction[]> {
  const expectedMin = options.expectedMin ?? 1
  const deadline = Date.now() + (options.timeoutMs ?? 20_000)
  let last: EmailInteraction[] = []
  while (Date.now() < deadline) {
    await drainEventsQueue()
    const resp = await apiRequest(
      request,
      'GET',
      `/api/customers/interactions?entityId=${encodeURIComponent(personId)}&interactionType=email`,
      { token },
    )
    if (resp.ok()) {
      const body = await readJsonSafe<{ items?: EmailInteraction[] }>(resp)
      last = Array.isArray(body?.items) ? body!.items : []
      if (last.length >= expectedMin) return last
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return last
}

/**
 * Negative assertion helper: drain the events queue a few times, then confirm
 * the Person has exactly zero email interactions. Used by the no-match case.
 */
export async function drainAndExpectNoEmailInteractions(
  request: APIRequestContext,
  token: string,
  personId: string,
): Promise<EmailInteraction[]> {
  // Drain twice with a small gap so a (hypothetical) delayed link would surface.
  await drainEventsQueue()
  await new Promise((resolve) => setTimeout(resolve, 300))
  await drainEventsQueue()
  const resp = await apiRequest(
    request,
    'GET',
    `/api/customers/interactions?entityId=${encodeURIComponent(personId)}&interactionType=email`,
    { token },
  )
  expect(resp.ok(), `GET interactions should succeed (got ${resp.status()})`).toBeTruthy()
  const body = await readJsonSafe<{ items?: EmailInteraction[] }>(resp)
  return Array.isArray(body?.items) ? body!.items : []
}
