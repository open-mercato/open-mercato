import { createHmac, randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page, type Response } from '@playwright/test'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { apiRequest, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

/**
 * Drives inbound Resend mail with attachments for the TC-INBOX-ATT specs: fixtures go to the
 * test-only Resend stub of the `example` module (`OM_ENABLE_RESEND_STUB`), envelopes are signed
 * like Svix signs them, and the `webhook:resend` admission limit (10/min) is waited out.
 */

export const RESEND_STUB_PATH = '/api/example/resend-stub'
export const INGEST_QUEUE = 'inbox-ops-attachment-ingest'
export const WEBHOOK_SPEC_TIMEOUT_MS = 120_000
export const INBOUND_EMAIL_ENTITY_ID = 'inbox_ops:inbox_email'

const RATE_LIMIT_BUDGET_MS = 70_000
const COMPLETION_TIMEOUT_MS = 60_000

export type InboundAttachmentInput = {
  id?: string
  filename?: string | null
  contentType: string
  content: Buffer | string
  contentDisposition?: 'attachment' | 'inline' | null
  contentId?: string | null
}

export type RegisteredFixture = {
  providerEmailId: string
  messageId: string
  attachments: Array<{ id: string; filename: string | null; size: number; contentType: string }>
}

export type ReceivedInboundEmail = RegisteredFixture & { emailId: string; to: string }

export type InboxEmailDetail = {
  id: string
  attachmentIds: string[] | null
  attachmentsStatus: string | null
} & Record<string, unknown>

export type AttachmentLedgerItem = {
  id: string
  partKey: string
  fileName: string | null
  mimeType: string | null
  sizeBytes: number | null
  disposition: string
  status: string
  reason: string | null
  attachmentId: string | null
  url: string | null
}

function baseUrl(): string {
  return process.env.BASE_URL?.trim() || 'http://localhost:3000'
}

/** Prefix of the stub's API keys; a key without it may be a real Resend key and is never sent. */
const RESEND_STUB_KEY_PREFIX = 're_stub_'

function requiredEnv(key: 'RESEND_API_KEY' | 'RESEND_WEBHOOK_SIGNING_SECRET'): string {
  const value = process.env[key]?.trim()
  if (!value) throw new Error(`[internal] ${key} must be set in the Playwright process for the Resend stub specs`)
  return value
}

function stubApiKey(): string {
  const key = requiredEnv('RESEND_API_KEY')
  if (!key.startsWith(RESEND_STUB_KEY_PREFIX)) {
    throw new Error(`[internal] RESEND_API_KEY must start with ${RESEND_STUB_KEY_PREFIX}; a real Resend key is never sent to BASE_URL`)
  }
  return key
}

export function uniqueRunId(prefix: string): string {
  return `${prefix.toLowerCase()}-${randomUUID()}`
}

async function stubRequest<T>(method: string, path: string, data?: unknown): Promise<{ status: number; body: T | null }> {
  return withCredentialIsolatedRequest(async (isolated) => {
    const response = await isolated.fetch(`${baseUrl()}${RESEND_STUB_PATH}${path}`, {
      method,
      headers: { Authorization: `Bearer ${stubApiKey()}`, 'Content-Type': 'application/json' },
      ...(data === undefined ? {} : { data }),
    })
    return { status: response.status(), body: await readJsonSafe<T>(response) }
  })
}

/**
 * Skips the spec when the app under test does not serve the Resend stub. A 404 while this
 * Playwright process runs with `OM_ENABLE_RESEND_STUB=true` throws instead, so a broken stub
 * cannot silently turn the suite into skips. Before any request it skips unless `RESEND_API_KEY`
 * is a stub key (`re_stub_…`), so a real key is never sent to `BASE_URL`.
 */
export async function skipUnlessResendStubAvailable(): Promise<void> {
  const stubFlag = parseBooleanWithDefault(process.env.OM_ENABLE_RESEND_STUB, false)
  if (!process.env.RESEND_API_KEY?.trim() || !process.env.RESEND_WEBHOOK_SIGNING_SECRET?.trim()) {
    if (stubFlag) throw new Error('[internal] OM_ENABLE_RESEND_STUB is on but RESEND_API_KEY or RESEND_WEBHOOK_SIGNING_SECRET is missing')
    test.skip(true, 'Resend stub is not configured (OM_ENABLE_RESEND_STUB, RESEND_API_KEY, RESEND_WEBHOOK_SIGNING_SECRET)')
    return
  }
  if (!process.env.RESEND_API_KEY.trim().startsWith(RESEND_STUB_KEY_PREFIX)) {
    test.skip(true, `RESEND_API_KEY is not a Resend stub key (${RESEND_STUB_KEY_PREFIX}…); the stub specs never send a real key`)
    return
  }
  const probe = await stubRequest<{ ok?: boolean }>('DELETE', `/fixtures/${randomUUID()}`)
  if (probe.status === 200 && probe.body?.ok === true) return
  if (stubFlag) {
    throw new Error(`[internal] Resend stub probe answered ${probe.status} although OM_ENABLE_RESEND_STUB is on in this process`)
  }
  test.skip(true, `Resend stub routes are not served by the app under test (probe answered ${probe.status})`)
}

export async function registerInboundFixture(input: {
  to: string
  from: string
  subject: string
  text?: string | null
  html?: string | null
  messageId?: string
  attachments: InboundAttachmentInput[]
  /** Downloads answer 503 until `setInboundFixtureFailDownloads(id, false)`. */
  failDownloads?: boolean
}): Promise<RegisteredFixture> {
  const messageId = input.messageId ?? `<${randomUUID()}@tc-inbox-att.example.test>`
  const response = await stubRequest<{ id: string; attachments: RegisteredFixture['attachments'] }>(
    'POST',
    '/fixtures',
    {
      from: input.from,
      to: [input.to],
      subject: input.subject,
      text: input.text ?? '',
      html: input.html ?? null,
      messageId,
      ...(input.failDownloads ? { failDownloads: true } : {}),
      attachments: input.attachments.map((attachment) => ({
        ...(attachment.id ? { id: attachment.id } : {}),
        filename: attachment.filename ?? null,
        contentType: attachment.contentType,
        contentBase64: Buffer.from(attachment.content).toString('base64'),
        contentDisposition: attachment.contentDisposition === undefined ? 'attachment' : attachment.contentDisposition,
        contentId: attachment.contentId ?? null,
      })),
    },
  )
  expect(response.status, 'Resend stub fixture registration should return 201').toBe(201)
  const body = response.body
  if (!body?.id) throw new Error('[internal] Resend stub fixture registration returned no id')
  return { providerEmailId: body.id, messageId, attachments: body.attachments }
}

export async function setInboundFixtureFailDownloads(providerEmailId: string, failDownloads: boolean): Promise<void> {
  const response = await stubRequest<{ failDownloads?: boolean }>('PATCH', `/fixtures/${encodeURIComponent(providerEmailId)}`, { failDownloads })
  expect(response.status, 'Resend stub fixture update should return 200').toBe(200)
  expect(response.body?.failDownloads).toBe(failDownloads)
}

export async function deleteInboundFixture(providerEmailId: string): Promise<void> {
  await stubRequest('DELETE', `/fixtures/${encodeURIComponent(providerEmailId)}`).catch(() => undefined)
}

function svixSignature(secret: string, messageId: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  return `v1,${createHmac('sha256', key).update(`${messageId}.${timestamp}.${body}`).digest('base64')}`
}

/**
 * Posts a Svix-signed `email.received` envelope. On 429 it waits for `Retry-After` and retries
 * within a total wait of 70 seconds per call; when the bucket needs longer (its hourly cap on a
 * reused environment), the spec is skipped with the reason. Each wait also extends the running
 * test's timeout by its length, so a spec posting several webhooks skips or proceeds instead of
 * timing out while the bucket refills. Specs that post webhooks raise their timeout to
 * `WEBHOOK_SPEC_TIMEOUT_MS`, because the harness default is 20 seconds.
 */
export async function postResendEmailReceived(input: { providerEmailId: string; to: string; from: string }): Promise<number> {
  const secret = requiredEnv('RESEND_WEBHOOK_SIGNING_SECRET')
  const deadline = Date.now() + RATE_LIMIT_BUDGET_MS
  for (;;) {
    const body = JSON.stringify({
      type: 'email.received',
      created_at: new Date().toISOString(),
      data: { email_id: input.providerEmailId, from: input.from, to: [input.to] },
    })
    const svixId = `msg_${randomUUID()}`
    const timestamp = String(Math.floor(Date.now() / 1000))
    const { status, retryAfter } = await withCredentialIsolatedRequest(async (isolated) => {
      const response = await isolated.fetch(`${baseUrl()}/api/inbox_ops/webhook/inbound`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'svix-id': svixId,
          'svix-timestamp': timestamp,
          'svix-signature': svixSignature(secret, svixId, timestamp, body),
        },
        data: body,
      })
      return { status: response.status(), retryAfter: response.headers()['retry-after'] }
    })
    if (status !== 429) return status
    const waitMs = Math.max(1, Number.parseInt(retryAfter ?? '', 10) || 60) * 1000
    if (Date.now() + waitMs > deadline) {
      test.skip(true, `The inbox_ops webhook rate limit asks to wait ${Math.ceil(waitMs / 1000)}s, beyond the ${RATE_LIMIT_BUDGET_MS / 1000}s budget (hourly cap reached on a reused environment)`)
    }
    const testInfo = test.info()
    if (testInfo.timeout > 0) testInfo.setTimeout(testInfo.timeout + waitMs)
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }
}

/**
 * Resolves with the log page's `POST /api/auth/feature-check` for `inbox_ops.proposals.manage`.
 * The Delete action stays hidden until it answers, so a check that Delete is absent must wait for
 * it. Create the promise before the navigation that triggers the request.
 */
export function waitForDeleteFeatureCheck(page: Page): Promise<Response> {
  return page.waitForResponse((response) => response.request().method() === 'POST'
    && response.url().includes('/api/auth/feature-check')
    && (response.request().postData() ?? '').includes('inbox_ops.proposals.manage'))
}

/**
 * Resolves with the response of `GET /api/inbox_ops/emails/{emailId}/attachments`. The attachment
 * list renders nothing while it loads, so a check that the list is absent must wait for it. Create
 * the promise before the navigation that triggers the request.
 */
export function waitForEmailAttachmentList(page: Page, emailId: string): Promise<Response> {
  return page.waitForResponse((response) => response.request().method() === 'GET'
    && response.url().includes(`/api/inbox_ops/emails/${emailId}/attachments`))
}

export async function resolveInboxAddress(request: APIRequestContext, adminToken: string): Promise<string> {
  const response = await apiRequest(request, 'GET', '/api/inbox_ops/settings', { token: adminToken })
  expect(response.status(), 'GET /api/inbox_ops/settings should return 200').toBe(200)
  const body = await readJsonSafe<{ settings?: { inboxAddress?: string; isActive?: boolean } }>(response)
  const address = body?.settings?.inboxAddress
  if (!address) throw new Error('[internal] inbox settings returned no inbox address')
  expect(body?.settings?.isActive, 'The inbox under test must be active').not.toBe(false)
  return address
}

export async function findInboundEmailIds(adminToken: string, providerEmailId: string): Promise<string[]> {
  const scope = getTokenContext(adminToken)
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `select id from inbox_emails
        where tenant_id = $1 and organization_id = $2
          and metadata -> 'attachmentIngest' ->> 'providerEmailId' = $3
        order by created_at asc`,
      [scope.tenantId, scope.organizationId, providerEmailId],
    )
    return result.rows.map((row) => row.id)
  })
}

export async function fetchInboxEmail(request: APIRequestContext, token: string, emailId: string): Promise<{ status: number; email: InboxEmailDetail | null }> {
  const response = await apiRequest(request, 'GET', `/api/inbox_ops/emails/${emailId}`, { token })
  const body = await readJsonSafe<{ email?: InboxEmailDetail }>(response)
  return { status: response.status(), email: body?.email ?? null }
}

export async function listEmailAttachmentParts(request: APIRequestContext, token: string, emailId: string): Promise<AttachmentLedgerItem[]> {
  const response = await apiRequest(request, 'GET', `/api/inbox_ops/emails/${emailId}/attachments`, { token })
  expect(response.status(), 'GET /api/inbox_ops/emails/[id]/attachments should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: AttachmentLedgerItem[] }>(response)
  return body?.items ?? []
}

/** Runs the ingest queue (drained in standalone runs, awaited when the harness spawns workers) and waits for `completed`. */
export async function waitForAttachmentsCompleted(request: APIRequestContext, token: string, emailId: string): Promise<InboxEmailDetail> {
  let latest: InboxEmailDetail | null = null
  await expect.poll(async () => {
    await drainIntegrationQueue(INGEST_QUEUE)
    latest = (await fetchInboxEmail(request, token, emailId)).email
    return latest?.attachmentsStatus ?? null
  }, { timeout: COMPLETION_TIMEOUT_MS, intervals: [500, 1_000, 2_000], message: `attachments of ${emailId} should complete` }).toBe('completed')
  if (!latest) throw new Error('[internal] inbox email disappeared while waiting for its attachments')
  return latest
}

const TERMINAL_EMAIL_STATUSES = ['failed', 'needs_review', 'processed']

/**
 * Waits until extraction has finished with the email (CI has no LLM key, so usually `failed`).
 * UI specs wait for it because extraction changes the email's `updated_at` after ingestion.
 */
export async function waitForTerminalEmailStatus(request: APIRequestContext, token: string, emailId: string): Promise<InboxEmailDetail> {
  let latest: InboxEmailDetail | null = null
  await expect.poll(async () => {
    latest = (await fetchInboxEmail(request, token, emailId)).email
    return TERMINAL_EMAIL_STATUSES.includes(String(latest?.status ?? ''))
  }, { timeout: COMPLETION_TIMEOUT_MS, intervals: [500, 1_000, 2_000], message: `extraction of ${emailId} should finish` }).toBe(true)
  if (!latest) throw new Error('[internal] inbox email disappeared while waiting for extraction')
  return latest
}

/**
 * Registers a fixture, posts its webhook and waits until the attachments are processed. Every
 * email and fixture is recorded in `tracker` for `cleanupInboundEmails`.
 */
export async function receiveInboundEmail(
  request: APIRequestContext,
  adminToken: string,
  tracker: InboundTracker,
  input: { to: string; from?: string; subject: string; text?: string | null; attachments: InboundAttachmentInput[]; messageId?: string },
): Promise<ReceivedInboundEmail & { email: InboxEmailDetail }> {
  const from = input.from ?? `Supplier ${randomUUID().slice(0, 8)} <supplier@tc-inbox-att.example.test>`
  const fixture = await registerInboundFixture({ ...input, from })
  tracker.fixtures.push(fixture.providerEmailId)
  const status = await postResendEmailReceived({ providerEmailId: fixture.providerEmailId, to: input.to, from })
  expect(status, 'The Resend webhook should accept the email').toBe(200)
  const emailIds = await findInboundEmailIds(adminToken, fixture.providerEmailId)
  // Track before asserting, so a duplicate persisted by a regression is still cleaned up.
  tracker.emails.push(...emailIds)
  expect(emailIds, 'The webhook should persist exactly one email').toHaveLength(1)
  const email = await waitForAttachmentsCompleted(request, adminToken, emailIds[0])
  return { ...fixture, emailId: emailIds[0], to: input.to, email }
}

export type InboundTracker = { emails: string[]; fixtures: string[] }

export function createInboundTracker(): InboundTracker {
  return { emails: [], fixtures: [] }
}

export async function cleanupInboundEmails(request: APIRequestContext, adminToken: string | null, tracker: InboundTracker): Promise<void> {
  if (adminToken) {
    for (const emailId of tracker.emails) {
      await apiRequest(request, 'DELETE', `/api/inbox_ops/emails/${emailId}`, { token: adminToken }).catch(() => undefined)
    }
  }
  for (const providerEmailId of tracker.fixtures) await deleteInboundFixture(providerEmailId)
}

export async function readEmailAttachmentRows(emailId: string): Promise<Array<{ id: string; entity_id: string; record_id: string; partition_code: string; content: string | null; organization_id: string | null; tenant_id: string | null }>> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string; entity_id: string; record_id: string; partition_code: string; content: string | null; organization_id: string | null; tenant_id: string | null }>(
      `select id, entity_id, record_id, partition_code, content, organization_id, tenant_id
         from attachments where record_id = $1 order by created_at asc`,
      [emailId],
    )
    return result.rows
  })
}

export function textPart(name: string, content: string): InboundAttachmentInput {
  return { filename: name, contentType: 'text/plain', content }
}
