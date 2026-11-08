/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ t: (_key: string, fallback: string) => fallback })),
}))

import { Resend } from 'resend'
import {
  acquireInboundPartBytes,
  listInboundAttachmentDescriptors,
} from '@open-mercato/core/modules/inbox_ops/lib/resendInboundAttachments'
import { POST as registerFixture } from '../../api/resend-stub/fixtures/route'
import { DELETE as deleteFixture, PATCH as updateFixture } from '../../api/resend-stub/fixtures/[fixtureId]/route'
import { POST as sendEmail } from '../../api/resend-stub/emails/route'
import { GET as getReceivedEmail } from '../../api/resend-stub/emails/receiving/[emailId]/route'
import { GET as listAttachments } from '../../api/resend-stub/emails/receiving/[emailId]/attachments/route'
import { GET as getAttachment } from '../../api/resend-stub/emails/receiving/[emailId]/attachments/[attachmentId]/route'
import { GET as download } from '../../api/resend-stub/downloads/[fixtureId]/[attachmentId]/route'
import { RESEND_STUB_ROUTE_PREFIX, isResendStubEnabled, resetResendStubStore } from '../resendStub'

const ORIGIN = 'http://stub.test'
const STUB_KEY = 're_stub_unit_test_key'
const FIXTURE_ID = '6f1b5e7a-2c39-4e7b-9a51-2f0d8a9c1b11'

type Params = Record<string, string>
type Handler = (request: Request, context: { params: Params }) => Promise<Response>
type RouteEntry = { method: string; pattern: RegExp; names: string[]; handler: Handler }

const routes: RouteEntry[] = [
  { method: 'POST', pattern: /^\/fixtures$/, names: [], handler: registerFixture },
  { method: 'PATCH', pattern: /^\/fixtures\/([^/]+)$/, names: ['fixtureId'], handler: updateFixture },
  { method: 'DELETE', pattern: /^\/fixtures\/([^/]+)$/, names: ['fixtureId'], handler: deleteFixture },
  { method: 'POST', pattern: /^\/emails$/, names: [], handler: sendEmail },
  { method: 'GET', pattern: /^\/emails\/receiving\/([^/]+)$/, names: ['emailId'], handler: getReceivedEmail },
  { method: 'GET', pattern: /^\/emails\/receiving\/([^/]+)\/attachments$/, names: ['emailId'], handler: listAttachments },
  {
    method: 'GET',
    pattern: /^\/emails\/receiving\/([^/]+)\/attachments\/([^/]+)$/,
    names: ['emailId', 'attachmentId'],
    handler: getAttachment,
  },
  { method: 'GET', pattern: /^\/downloads\/([^/]+)\/([^/]+)$/, names: ['fixtureId', 'attachmentId'], handler: download },
]

async function dispatch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : new Request(String(input), init)
  const url = new URL(request.url)
  if (url.origin !== ORIGIN || !url.pathname.startsWith(RESEND_STUB_ROUTE_PREFIX)) {
    throw new Error(`[internal] unexpected request ${request.method} ${url}`)
  }
  const path = url.pathname.slice(RESEND_STUB_ROUTE_PREFIX.length)
  for (const route of routes) {
    const match = route.method === request.method ? route.pattern.exec(path) : null
    if (!match) continue
    const params = Object.fromEntries(route.names.map((name, index) => [name, decodeURIComponent(match[index + 1])]))
    return route.handler(request, { params })
  }
  return Response.json({ error: 'Not Found' }, { status: 404 })
}

function stubRequest(method: string, path: string, options: { body?: unknown; key?: string | null } = {}): Request {
  const headers = new Headers({ 'content-type': 'application/json' })
  const key = options.key === undefined ? STUB_KEY : options.key
  if (key) headers.set('authorization', `Bearer ${key}`)
  return new Request(`${ORIGIN}${RESEND_STUB_ROUTE_PREFIX}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

function fixturePayload(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE_ID,
    from: 'Supplier <supplier@example.test>',
    to: ['ops@inbox.example.test'],
    subject: 'Offer',
    text: '',
    messageId: '<offer-1@example.test>',
    attachments: [
      { id: 'att_one', filename: 'offer.txt', contentType: 'text/plain', contentBase64: Buffer.from('first').toString('base64') },
      { id: 'att_two', filename: null, contentType: 'text/csv', contentBase64: Buffer.from('a,b').toString('base64') },
      {
        id: 'att_logo',
        filename: 'logo.png',
        contentType: 'image/png',
        contentBase64: Buffer.from('png').toString('base64'),
        contentDisposition: 'inline',
        contentId: 'logo@cid',
      },
    ],
    ...overrides,
  }
}

const savedEnv = { ...process.env }

beforeEach(() => {
  resetResendStubStore()
  process.env.OM_ENABLE_RESEND_STUB = 'true'
  process.env.RESEND_API_KEY = STUB_KEY
  process.env.RESEND_BASE_URL = `${ORIGIN}${RESEND_STUB_ROUTE_PREFIX}`
  jest.spyOn(global, 'fetch').mockImplementation(dispatch)
})

afterEach(() => {
  jest.restoreAllMocks()
  process.env = { ...savedEnv }
})

describe('Resend stub gating', () => {
  it.each([
    ['the flag is off', { OM_ENABLE_RESEND_STUB: 'false', RESEND_API_KEY: STUB_KEY }],
    ['the flag is unset', { OM_ENABLE_RESEND_STUB: undefined, RESEND_API_KEY: STUB_KEY }],
    ['the key is a real-looking Resend key', { OM_ENABLE_RESEND_STUB: 'true', RESEND_API_KEY: 're_live_123' }],
    ['the key is only the prefix', { OM_ENABLE_RESEND_STUB: 'true', RESEND_API_KEY: 're_stub_' }],
    ['the key is missing', { OM_ENABLE_RESEND_STUB: 'true', RESEND_API_KEY: undefined }],
  ])('answers the framework 404 on every route when %s', async (_label, env) => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    expect(isResendStubEnabled()).toBe(false)
    const responses = await Promise.all([
      registerFixture(stubRequest('POST', '/fixtures', { body: fixturePayload() })),
      getReceivedEmail(stubRequest('GET', `/emails/receiving/${FIXTURE_ID}`), { params: { emailId: FIXTURE_ID } }),
      sendEmail(stubRequest('POST', '/emails', { body: { from: 'a@x.test', to: 'b@x.test', subject: 's' } })),
      download(stubRequest('GET', `/downloads/${FIXTURE_ID}/att_one`, { key: null }), {
        params: { fixtureId: FIXTURE_ID, attachmentId: 'att_one' },
      }),
    ])
    for (const response of responses) {
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'Not Found' })
    }
  })

  it('requires the stub API key on API routes', async () => {
    const missing = await registerFixture(stubRequest('POST', '/fixtures', { body: fixturePayload(), key: null }))
    expect(missing.status).toBe(401)
    expect(await missing.json()).toMatchObject({ name: 'missing_api_key' })
    const wrong = await registerFixture(stubRequest('POST', '/fixtures', { body: fixturePayload(), key: 're_stub_other' }))
    expect(wrong.status).toBe(403)
    expect(await wrong.json()).toMatchObject({ name: 'invalid_api_key' })
  })
})

describe('Resend stub through the Resend SDK', () => {
  async function register(overrides: Record<string, unknown> = {}) {
    const response = await registerFixture(stubRequest('POST', '/fixtures', { body: fixturePayload(overrides) }))
    expect(response.status).toBe(201)
    return response.json() as Promise<{ id: string; attachments: Array<{ id: string; size: number }> }>
  }

  it('serves receiving.get with the inbound attachment metadata', async () => {
    await register()
    const { data, error } = await new Resend(STUB_KEY).emails.receiving.get(FIXTURE_ID)
    expect(error).toBeNull()
    expect(data).toMatchObject({
      object: 'email',
      id: FIXTURE_ID,
      to: ['ops@inbox.example.test'],
      message_id: '<offer-1@example.test>',
      text: '',
      html: null,
    })
    expect(data?.attachments).toEqual([
      { id: 'att_one', filename: 'offer.txt', size: 5, content_type: 'text/plain', content_id: null, content_disposition: 'attachment' },
      { id: 'att_two', filename: null, size: 3, content_type: 'text/csv', content_id: null, content_disposition: 'attachment' },
      { id: 'att_logo', filename: 'logo.png', size: 3, content_type: 'image/png', content_id: 'logo@cid', content_disposition: 'inline' },
    ])
  })

  it('answers a Resend 404 for an unknown email, so the SDK reports statusCode 404', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { data, error } = await new Resend(STUB_KEY).emails.receiving.get('missing-email')
    expect(data).toBeNull()
    expect(error).toMatchObject({ statusCode: 404, name: 'not_found' })
  })

  it('pages attachments.list with the after cursor and has_more', async () => {
    await register()
    const api = new Resend(STUB_KEY).emails.receiving.attachments
    const first = await api.list({ emailId: FIXTURE_ID, limit: 2 })
    expect(first.error).toBeNull()
    expect(first.data?.has_more).toBe(true)
    expect(first.data?.data.map((item) => item.id)).toEqual(['att_one', 'att_two'])
    const second = await api.list({ emailId: FIXTURE_ID, limit: 2, after: 'att_two' })
    expect(second.data?.has_more).toBe(false)
    expect(second.data?.data.map((item) => item.id)).toEqual(['att_logo'])
    expect(second.data?.data[0]).toMatchObject({ content_disposition: 'inline', content_id: 'logo@cid' })
    expect(Date.parse(second.data?.data[0].expires_at ?? '')).toBeGreaterThan(Date.now())
  })

  it('feeds the inbox_ops ingest helpers: list, download and the failure switch', async () => {
    await register()
    const api = new Resend(STUB_KEY).emails.receiving.attachments
    const listed = await listInboundAttachmentDescriptors(api, FIXTURE_ID, 5_000)
    expect(listed).toMatchObject({ emailNotFound: false, failed: false })
    expect([...listed.byId.keys()]).toEqual(['att_one', 'att_two', 'att_logo'])

    const acquired = await acquireInboundPartBytes({
      api,
      providerEmailId: FIXTURE_ID,
      providerAttachmentId: 'att_one',
      listed: listed.byId.get('att_one'),
      timeoutMs: 5_000,
      maxBytes: 1024,
    })
    expect(acquired.kind).toBe('downloaded')
    expect(acquired.kind === 'downloaded' ? acquired.buffer.toString('utf8') : null).toBe('first')

    const switched = await updateFixture(stubRequest('PATCH', `/fixtures/${FIXTURE_ID}`, { body: { failDownloads: true } }), {
      params: { fixtureId: FIXTURE_ID },
    })
    expect(await switched.json()).toEqual({ id: FIXTURE_ID, failDownloads: true })
    const failing = await acquireInboundPartBytes({
      api,
      providerEmailId: FIXTURE_ID,
      providerAttachmentId: 'att_two',
      timeoutMs: 5_000,
      maxBytes: 1024,
    })
    expect(failing).toEqual({ kind: 'transient', code: 'download_http_503' })

    await updateFixture(stubRequest('PATCH', `/fixtures/${FIXTURE_ID}`, { body: { failDownloads: false } }), {
      params: { fixtureId: FIXTURE_ID },
    })
    const recovered = await acquireInboundPartBytes({
      api,
      providerEmailId: FIXTURE_ID,
      providerAttachmentId: 'att_two',
      timeoutMs: 5_000,
      maxBytes: 1024,
    })
    expect(recovered.kind === 'downloaded' ? recovered.buffer.toString('utf8') : null).toBe('a,b')
  })

  it('starts registered with downloads failing when asked to', async () => {
    await register({ failDownloads: true })
    const { data } = await new Resend(STUB_KEY).emails.receiving.attachments.get({ emailId: FIXTURE_ID, id: 'att_one' })
    const response = await fetch(data?.download_url ?? '')
    expect(response.status).toBe(503)
  })

  it('refuses tampered, expired and foreign download tokens', async () => {
    await register()
    await register({ id: '0d5c7c1e-8f2b-4b6a-9d3e-7a1c2b3d4e5f', messageId: '<other@example.test>' })
    const api = new Resend(STUB_KEY).emails.receiving.attachments
    const { data } = await api.get({ emailId: FIXTURE_ID, id: 'att_one' })
    const valid = new URL(data?.download_url ?? '')
    expect((await fetch(valid)).status).toBe(200)

    const tampered = new URL(valid)
    tampered.searchParams.set('token', `${valid.searchParams.get('token')}x`)
    expect((await fetch(tampered)).status).toBe(403)

    const expired = new URL(valid)
    expired.searchParams.set('expires', String(Date.now() - 1_000))
    expect((await fetch(expired)).status).toBe(403)

    const foreign = new URL(valid)
    foreign.pathname = foreign.pathname.replace(FIXTURE_ID, '0d5c7c1e-8f2b-4b6a-9d3e-7a1c2b3d4e5f')
    expect((await fetch(foreign)).status).toBe(403)

    const otherPart = new URL(valid)
    otherPart.pathname = otherPart.pathname.replace('att_one', 'att_two')
    expect((await fetch(otherPart)).status).toBe(403)

    await deleteFixture(stubRequest('DELETE', `/fixtures/${FIXTURE_ID}`), { params: { fixtureId: FIXTURE_ID } })
    expect((await fetch(valid)).status).toBe(403)
  })

  it('records POST /emails and returns a message id', async () => {
    const { data, error } = await new Resend(STUB_KEY).emails.send({
      from: 'ops@example.test',
      to: 'buyer@example.test',
      subject: 'Re: Offer',
      text: 'Thanks',
    })
    expect(error).toBeNull()
    expect(data?.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('rejects a duplicate fixture id and an invalid payload', async () => {
    await register()
    const duplicate = await registerFixture(stubRequest('POST', '/fixtures', { body: fixturePayload() }))
    expect(duplicate.status).toBe(409)
    const invalid = await registerFixture(stubRequest('POST', '/fixtures', { body: { from: 'x' } }))
    expect(invalid.status).toBe(422)
  })
})
