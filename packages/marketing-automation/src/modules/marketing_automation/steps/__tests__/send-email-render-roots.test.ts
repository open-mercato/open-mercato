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
 * A placeholder can live inside a stored content block rather than in the body the author typed —
 * the raw body only shows `{{block:footer}}`. Deciding which render roots to load from the RAW body
 * misses that, `loadRenderValues` never populates the root the block needs, and the placeholder
 * reaches the recipient unresolved.
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

beforeAll(() => {
  process.env.OM_MARKETING_TRACKING_SECRET = 'test-tracking-secret'
  process.env.APP_URL = 'https://shop.example'
  process.env.OM_MARKETING_PUBLIC_ROUTES_READY = 'true'
})

afterAll(() => { process.env = { ...originalEnv } })

beforeEach(() => {
  for (const fn of [sendEmail, findOneWithDecryption, loadContentBlocks, loadRenderValues, reportError]) fn.mockReset()
  findOneWithDecryption.mockResolvedValue({ id: 'cust-1', primaryEmail: 'ada@example.com', displayName: 'Ada' })
  loadRenderValues.mockResolvedValue({})
  sendEmail.mockResolvedValue(undefined)
})

describe('which render roots a send-time personalization loads', () => {
  it('loads a root a placeholder only reaches through an expanded content block', async () => {
    loadContentBlocks.mockResolvedValue({ footer: '<p>Hi {{customer.displayName}}</p>' })
    await sendEmailStep.execute(ctx(), { subject: 'Hello', bodyHtml: '<p>Welcome</p>{{block:footer}}', track: false }, deps)

    const needed = loadRenderValues.mock.calls[0][4] as Set<string>
    expect(needed.has('customer')).toBe(true)
  })

  it('does not load a root nothing — raw or blocked — ever mentions', async () => {
    loadContentBlocks.mockResolvedValue({ footer: '<p>Thanks for shopping</p>' })
    await sendEmailStep.execute(ctx(), { subject: 'Hello', bodyHtml: '<p>Welcome</p>{{block:footer}}', track: false }, deps)

    const needed = loadRenderValues.mock.calls[0][4] as Set<string>
    expect(needed.size).toBe(0)
  })
})
