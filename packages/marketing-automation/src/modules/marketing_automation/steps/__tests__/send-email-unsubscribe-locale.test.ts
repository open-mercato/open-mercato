const sendEmail = jest.fn()
const findOneWithDecryption = jest.fn()
const loadContentBlocks = jest.fn()
const loadRenderValues = jest.fn()
const loadContactPreference = jest.fn()
const loadDictionary = jest.fn()

jest.mock('@open-mercato/shared/lib/email/send', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...a: unknown[]) => findOneWithDecryption(...a),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/i18n/server')
  return { ...actual, loadDictionary: (...a: unknown[]) => loadDictionary(...a) }
})
jest.mock('../../lib/content-blocks.js', () => {
  const actual = jest.requireActual('../../lib/content-blocks')
  return { ...actual, loadContentBlocks: (...a: unknown[]) => loadContentBlocks(...a) }
})
jest.mock('../../lib/render-values.js', () => {
  const actual = jest.requireActual('../../lib/render-values')
  return { ...actual, loadRenderValues: (...a: unknown[]) => loadRenderValues(...a) }
})
jest.mock('../../lib/preferences.js', () => {
  const actual = jest.requireActual('../../lib/preferences')
  return { ...actual, loadContactPreference: (...a: unknown[]) => loadContactPreference(...a) }
})

import { sendEmailStep } from '../send-email'
import type { AutomationContext } from '../../lib/engine/types'

/**
 * A customer's stored locale preference carries a region (`de-AT`, picked during onboarding).
 * `isSupportedLocale` only registers the base language, so the footer used to read as
 * unsubscribe-unsupported and silently revert to English for every one of those customers —
 * even though German is fully supported.
 */
const ctx = (over: Partial<AutomationContext> = {}): AutomationContext => ({
  tenantId: 't1', organizationId: 'o1', eventId: 'e', occurredAt: '2026-10-02T00:00:00.000Z',
  dispatchDepth: 1, subjectEntityId: 'cust-1', campaignId: 'camp-1', runId: 'run-1', actionId: 'step-1',
  trigger: {}, ...over,
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

const originalEnv = { ...process.env }

beforeAll(() => {
  process.env.OM_MARKETING_TRACKING_SECRET = 'test-tracking-secret'
  process.env.APP_URL = 'https://shop.example'
  process.env.OM_MARKETING_PUBLIC_ROUTES_READY = 'true'
})

afterAll(() => { process.env = originalEnv })

beforeEach(() => {
  for (const fn of [sendEmail, findOneWithDecryption, loadContentBlocks, loadRenderValues, loadContactPreference, loadDictionary]) fn.mockReset()
  findOneWithDecryption.mockResolvedValue({ id: 'cust-1', primaryEmail: 'ada@example.com', displayName: 'Ada' })
  loadRenderValues.mockResolvedValue({})
  sendEmail.mockResolvedValue(undefined)
  loadDictionary.mockImplementation(async (locale: string) => (
    locale === 'de' ? { 'marketing_automation.email.unsubscribe': 'Abmelden' } : {}
  ))
})

function footerLabel(): string {
  const html = sendEmail.mock.calls[0][0].html as string
  const match = html.match(/>([^<]*)<\/a>\s*$/m) ?? html.match(/(Unsubscribe|Abmelden)/)
  return match?.[1] ?? html
}

describe('send_email unsubscribe footer locale', () => {
  it('folds a regional preference to its base language', async () => {
    loadContactPreference.mockResolvedValue({ locale: 'de-AT' })
    await sendEmailStep.execute(ctx(), params, deps)
    expect(footerLabel()).toContain('Abmelden')
  })

  it('still falls back to English for a language the platform does not carry', async () => {
    loadContactPreference.mockResolvedValue({ locale: 'xx-YY' })
    await sendEmailStep.execute(ctx(), params, deps)
    expect(footerLabel()).toContain('Unsubscribe')
  })

  it('uses the exact locale directly when it carries no region', async () => {
    loadContactPreference.mockResolvedValue({ locale: 'de' })
    await sendEmailStep.execute(ctx(), params, deps)
    expect(footerLabel()).toContain('Abmelden')
  })
})
