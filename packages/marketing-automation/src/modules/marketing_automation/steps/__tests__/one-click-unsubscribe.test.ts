const sendEmail = jest.fn()
const findOneWithDecryption = jest.fn()
const loadContentBlocks = jest.fn()
const loadRenderValues = jest.fn()
const reportError = jest.fn()

jest.mock('@open-mercato/shared/lib/email/send', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...a: unknown[]) => findOneWithDecryption(...a),
}))
jest.mock('../../lib/content-blocks.js', () => {
  const actual = jest.requireActual('../../lib/content-blocks')
  return { ...actual, loadContentBlocks: (...a: unknown[]) => loadContentBlocks(...a) }
})
jest.mock('../../lib/render-values.js', () => {
  const actual = jest.requireActual('../../lib/render-values')
  return { ...actual, loadRenderValues: (...a: unknown[]) => loadRenderValues(...a) }
})
jest.mock('@open-mercato/telemetry', () => ({ reportError: (...a: unknown[]) => reportError(...a) }))

import { sendEmailStep } from '../send-email'
import type { AutomationContext } from '../../lib/engine/types'

/**
 * The headers RFC 8058 one-click actually needs.
 *
 * `api/unsubscribe/route.ts` has answered POST from the start, documented as the one-click path — and nothing
 * ever told a mail client it was there. Gmail's and Yahoo's bulk-sender rules require both headers from
 * anybody sending at volume, so their absence capped deliverability to the two largest mailboxes whatever
 * else the module did right.
 */
const originalEnv = { ...process.env }

const ctx = (over: Partial<AutomationContext> = {}): AutomationContext => ({
  tenantId: 't1',
  organizationId: 'o1',
  eventId: 'e',
  occurredAt: '2026-10-02T00:00:00.000Z',
  dispatchDepth: 1,
  subjectEntityId: 'cust-1',
  campaignId: 'camp-1',
  runId: 'run-1',
  actionId: 'step-1',
  trigger: {},
  ...over,
} as AutomationContext)

const deps = {
  em: {} as never,
  container: { resolve: () => ({}) } as never,
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as never,
  scope: { tenantId: 't1', organizationId: 'o1' },
  now: new Date('2026-10-02T12:00:00.000Z'),
  commandContext: { systemActor: true } as never,
} as never

const params = { subject: 'Hello', bodyHtml: '<p>Hello</p>', track: false }

beforeAll(() => {
  process.env.OM_MARKETING_TRACKING_SECRET = 'test-tracking-secret'
  process.env.APP_URL = 'https://shop.example'
})

afterAll(() => { process.env = { ...originalEnv } })

beforeEach(() => {
  for (const fn of [sendEmail, findOneWithDecryption, loadContentBlocks, loadRenderValues, reportError]) fn.mockReset()
  findOneWithDecryption.mockResolvedValue({ id: 'cust-1', primaryEmail: 'ada@example.com', displayName: 'Ada' })
  loadContentBlocks.mockResolvedValue({})
  loadRenderValues.mockResolvedValue({})
  sendEmail.mockResolvedValue(undefined)
})

function headersOf(): Record<string, string> | undefined {
  return (sendEmail.mock.calls[0]?.[0] as { headers?: Record<string, string> } | undefined)?.headers
}

describe('a real marketing send', () => {
  it('carries both one-click headers', async () => {
    const outcome = await sendEmailStep.execute(ctx(), params, deps)
    expect(outcome.status).toBe('done')
    const headers = headersOf()
    // Either alone is worse than neither: `-Post` on its own means nothing, and `List-Unsubscribe` on its
    // own invites a one-click button that performs a GET — which this module refuses to let change anything,
    // so the recipient would press it and stay subscribed.
    expect(headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    expect(headers?.['List-Unsubscribe']).toMatch(/^<https:\/\/shop\.example\/api\/marketing_automation\/unsubscribe\?/)
  })

  it('angle-brackets the URL, as the RFC requires', async () => {
    await sendEmailStep.execute(ctx(), params, deps)
    const value = headersOf()?.['List-Unsubscribe'] ?? ''
    expect(value.startsWith('<') && value.endsWith('>')).toBe(true)
  })

  it('points at the same URL the footer does, so the two cannot disagree', async () => {
    await sendEmailStep.execute(ctx(), params, deps)
    const sent = sendEmail.mock.calls[0][0] as { html: string; headers?: Record<string, string> }
    const bracketed = sent.headers?.['List-Unsubscribe'] ?? ''
    const url = bracketed.slice(1, -1).replace(/&amp;/g, '&')
    expect(sent.html.replace(/&amp;/g, '&')).toContain(url)
  })

  it('sends nothing at all when no unsubscribe URL can be built', async () => {
    // The guard that owns this is the same one the headers depend on, so they cannot drift apart.
    delete process.env.OM_MARKETING_TRACKING_SECRET
    try {
      const outcome = await sendEmailStep.execute(ctx(), params, deps)
      expect(outcome.status).toBe('skipped')
      expect(sendEmail).not.toHaveBeenCalled()
    } finally {
      process.env.OM_MARKETING_TRACKING_SECRET = 'test-tracking-secret'
    }
  })
})
