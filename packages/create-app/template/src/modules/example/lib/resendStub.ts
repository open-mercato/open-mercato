import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { ResendStubFixtureCreateInput } from '../data/validators'

/**
 * TEST-ONLY stand-in for the Resend API, used by the inbox_ops inbound-attachment integration
 * tests (spec `2026-10-25-inbox-ops-inbound-attachments.md`, Phase 1 step 7). The harness points
 * `RESEND_BASE_URL` at `RESEND_STUB_ROUTE_PREFIX`, so the unmodified Resend SDK talks to these
 * routes. Every route answers the framework's 404 unless `OM_ENABLE_RESEND_STUB=true` AND
 * `RESEND_API_KEY` carries the `re_stub_` prefix, which no real Resend key has; API routes then
 * also require that key as the bearer token, and download URLs carry an expiring HMAC token keyed
 * by a random per-fixture secret. State lives in this process only.
 */

export const RESEND_STUB_FLAG_ENV = 'OM_ENABLE_RESEND_STUB'
export const RESEND_STUB_API_KEY_PREFIX = 're_stub_'
export const RESEND_STUB_ROUTE_PREFIX = '/api/example/resend-stub'
export const RESEND_STUB_DOWNLOAD_TTL_MS = 60 * 60 * 1000

const MAX_FIXTURES = 200
const MAX_SENT_EMAILS = 200
const STORE_KEY = Symbol.for('@open-mercato/example:resend-stub-store')

const logger = createLogger('example').child({ component: 'resend-stub' })

export type ResendStubAttachment = {
  id: string
  filename: string | null
  contentType: string
  contentDisposition: 'attachment' | 'inline' | null
  contentId: string | null
  content: Buffer
}

export type ResendStubFixture = {
  id: string
  from: string
  to: string[]
  subject: string
  text: string | null
  html: string | null
  messageId: string
  headers: Record<string, string> | null
  createdAt: string
  attachments: ResendStubAttachment[]
  failDownloads: boolean
  tokenSecret: Buffer
}

export type ResendStubSentEmail = { id: string; from: string; to: string[]; subject: string; createdAt: string }

type ResendStubStore = {
  fixtures: Map<string, ResendStubFixture>
  sent: ResendStubSentEmail[]
  warned: boolean
}

function getStore(): ResendStubStore {
  const root = globalThis as typeof globalThis & { [STORE_KEY]?: ResendStubStore }
  if (!root[STORE_KEY]) root[STORE_KEY] = { fixtures: new Map(), sent: [], warned: false }
  return root[STORE_KEY]
}

export function resetResendStubStore(): void {
  const store = getStore()
  store.fixtures.clear()
  store.sent.length = 0
}

function configuredStubApiKey(env: NodeJS.ProcessEnv): string | null {
  const key = env.RESEND_API_KEY?.trim() ?? ''
  return key.startsWith(RESEND_STUB_API_KEY_PREFIX) && key.length > RESEND_STUB_API_KEY_PREFIX.length ? key : null
}

export function isResendStubEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseBooleanToken(env[RESEND_STUB_FLAG_ENV]) === true && configuredStubApiKey(env) !== null
}

function safeEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest()
  const rightDigest = createHash('sha256').update(right).digest()
  return timingSafeEqual(leftDigest, rightDigest)
}

/** The body shape Resend answers errors with; the SDK passes it through as `{ error }`. */
export function resendStubError(statusCode: number, name: string, message: string): Response {
  return Response.json({ statusCode, name, message }, { status: statusCode })
}

async function routeNotFound(): Promise<Response> {
  const { t } = await resolveTranslations()
  return Response.json({ error: t('api.errors.notFound', 'Not Found') }, { status: 404 })
}

/**
 * Returns the response that ends the request (the stub is disabled, or the API key is wrong),
 * or `null` when the handler may proceed.
 */
export async function guardResendStubRequest(
  request: Request,
  options: { requireApiKey: boolean },
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response | null> {
  if (!isResendStubEnabled(env)) return routeNotFound()
  const store = getStore()
  if (!store.warned) {
    store.warned = true
    logger.warn('Resend stub routes are enabled (OM_ENABLE_RESEND_STUB); this must only happen in test environments')
  }
  if (!options.requireApiKey) return null
  const expected = configuredStubApiKey(env)
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!match) return resendStubError(401, 'missing_api_key', 'Missing API key in the authorization header.')
  if (!expected || !safeEqual(match[1].trim(), expected)) {
    return resendStubError(403, 'invalid_api_key', 'API key is invalid.')
  }
  return null
}

export function readRouteParam(params: Record<string, string | string[]> | undefined, name: string): string | null {
  const value = params?.[name]
  const single = Array.isArray(value) ? value[0] : value
  return typeof single === 'string' && single.length > 0 ? single : null
}

export function registerResendStubFixture(input: ResendStubFixtureCreateInput): ResendStubFixture | null {
  const store = getStore()
  const id = input.id ?? randomUUID()
  if (store.fixtures.has(id)) return null
  const fixture: ResendStubFixture = {
    id,
    from: input.from,
    to: input.to,
    subject: input.subject,
    text: input.text ?? null,
    html: input.html ?? null,
    messageId: input.messageId,
    headers: input.headers ?? null,
    createdAt: new Date().toISOString(),
    attachments: input.attachments.map((attachment) => ({
      id: attachment.id ?? randomUUID(),
      filename: attachment.filename ?? null,
      contentType: attachment.contentType,
      contentDisposition: attachment.contentDisposition === undefined ? 'attachment' : attachment.contentDisposition,
      contentId: attachment.contentId ?? null,
      content: Buffer.from(attachment.contentBase64, 'base64'),
    })),
    failDownloads: input.failDownloads ?? false,
    tokenSecret: randomBytes(32),
  }
  store.fixtures.set(id, fixture)
  while (store.fixtures.size > MAX_FIXTURES) {
    const oldest = store.fixtures.keys().next().value
    if (oldest === undefined) break
    store.fixtures.delete(oldest)
  }
  return fixture
}

export function getResendStubFixture(id: string): ResendStubFixture | null {
  return getStore().fixtures.get(id) ?? null
}

export function setResendStubFixtureFailDownloads(id: string, failDownloads: boolean): ResendStubFixture | null {
  const fixture = getResendStubFixture(id)
  if (!fixture) return null
  fixture.failDownloads = failDownloads
  return fixture
}

export function deleteResendStubFixture(id: string): boolean {
  return getStore().fixtures.delete(id)
}

export function recordResendStubSentEmail(input: { from: string; to: string[]; subject: string }): ResendStubSentEmail {
  const store = getStore()
  const sent: ResendStubSentEmail = { id: randomUUID(), ...input, createdAt: new Date().toISOString() }
  store.sent.push(sent)
  if (store.sent.length > MAX_SENT_EMAILS) store.sent.splice(0, store.sent.length - MAX_SENT_EMAILS)
  return sent
}

function downloadSignature(fixture: ResendStubFixture, attachmentId: string, expiresAtMs: number): string {
  return createHmac('sha256', fixture.tokenSecret).update(`${attachmentId}:${expiresAtMs}`).digest('base64url')
}

export function verifyResendStubDownloadToken(
  fixture: ResendStubFixture,
  attachmentId: string,
  expiresRaw: string | null,
  token: string | null,
  now: number = Date.now(),
): boolean {
  if (!expiresRaw || !token || !/^\d+$/.test(expiresRaw)) return false
  const expiresAtMs = Number(expiresRaw)
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= now) return false
  return safeEqual(token, downloadSignature(fixture, attachmentId, expiresAtMs))
}

function stubBaseUrl(request: Request): string {
  return `${new URL(request.url).origin}${RESEND_STUB_ROUTE_PREFIX}`
}

export const resendStubInboundAttachmentSchema = z.object({
  id: z.string(),
  filename: z.string().nullable(),
  size: z.number().int(),
  content_type: z.string(),
  content_id: z.string().nullable(),
  content_disposition: z.string().nullable(),
})

export const resendStubAttachmentDataSchema = z.object({
  id: z.string(),
  filename: z.string().optional(),
  size: z.number().int(),
  content_type: z.string(),
  content_disposition: z.enum(['attachment', 'inline']),
  content_id: z.string().optional(),
  download_url: z.string(),
  expires_at: z.string(),
})

export const resendStubReceivedEmailSchema = z.object({
  object: z.literal('email'),
  id: z.string(),
  to: z.array(z.string()),
  from: z.string(),
  created_at: z.string(),
  subject: z.string(),
  bcc: z.array(z.string()).nullable(),
  cc: z.array(z.string()).nullable(),
  reply_to: z.array(z.string()).nullable(),
  received_for: z.array(z.string()),
  html: z.string().nullable(),
  text: z.string().nullable(),
  headers: z.record(z.string(), z.string()).nullable(),
  message_id: z.string(),
  raw: z.null(),
  attachments: z.array(resendStubInboundAttachmentSchema),
})

export const resendStubErrorSchema = z.object({ statusCode: z.number(), name: z.string(), message: z.string() })

export type ResendStubReceivedEmail = z.infer<typeof resendStubReceivedEmailSchema>
export type ResendStubAttachmentData = z.infer<typeof resendStubAttachmentDataSchema>

export function serializeReceivedEmail(fixture: ResendStubFixture): ResendStubReceivedEmail {
  return {
    object: 'email',
    id: fixture.id,
    to: fixture.to,
    from: fixture.from,
    created_at: fixture.createdAt,
    subject: fixture.subject,
    bcc: null,
    cc: null,
    reply_to: null,
    received_for: fixture.to,
    html: fixture.html,
    text: fixture.text,
    headers: fixture.headers,
    message_id: fixture.messageId,
    raw: null,
    attachments: fixture.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      size: attachment.content.byteLength,
      content_type: attachment.contentType,
      content_id: attachment.contentId,
      content_disposition: attachment.contentDisposition,
    })),
  }
}

export function serializeAttachmentData(
  request: Request,
  fixture: ResendStubFixture,
  attachment: ResendStubAttachment,
  now: number = Date.now(),
): ResendStubAttachmentData {
  const expiresAtMs = now + RESEND_STUB_DOWNLOAD_TTL_MS
  const query = new URLSearchParams({
    expires: String(expiresAtMs),
    token: downloadSignature(fixture, attachment.id, expiresAtMs),
  })
  const downloadUrl = `${stubBaseUrl(request)}/downloads/${encodeURIComponent(fixture.id)}/${encodeURIComponent(attachment.id)}?${query}`
  return {
    id: attachment.id,
    ...(attachment.filename !== null ? { filename: attachment.filename } : {}),
    size: attachment.content.byteLength,
    content_type: attachment.contentType,
    content_disposition: attachment.contentDisposition === 'inline' ? 'inline' : 'attachment',
    ...(attachment.contentId !== null ? { content_id: attachment.contentId } : {}),
    download_url: downloadUrl,
    expires_at: new Date(expiresAtMs).toISOString(),
  }
}

export function emailNotFound(): Response {
  return resendStubError(404, 'not_found', 'Email not found')
}

export function attachmentNotFound(): Response {
  return resendStubError(404, 'not_found', 'Attachment not found')
}
