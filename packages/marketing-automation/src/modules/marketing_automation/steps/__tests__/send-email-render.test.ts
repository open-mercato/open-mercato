import { renderEmail } from '../send-email'
import type { AutomationContext } from '../../lib/engine/types'

/**
 * What the recipient actually receives.
 *
 * `renderEmail` is the one function in this module whose output is read by a customer and by nobody else,
 * and it had no test at all — which is how a message came to go out with two unsubscribe links in it. A
 * real send and a test send both render through here, so a defect here is a defect in both.
 */
const ctx = {
  tenantId: 't1',
  organizationId: 'o1',
  campaignId: 'camp-1',
  runId: 'run-1',
  actionId: 'step-1',
  subjectEntityId: 'cust-1',
  customer: { firstName: 'Ada' },
} as unknown as AutomationContext

const originalEnv = { ...process.env }

beforeAll(() => {
  process.env.OM_MARKETING_TRACKING_SECRET = 'test-tracking-secret'
  process.env.APP_URL = 'https://shop.example'
})

afterAll(() => {
  process.env = { ...originalEnv }
})

function unsubscribeLinks(html: string): string[] {
  return [...html.matchAll(/href="([^"]*\/unsubscribe[^"]*)"/g)].map((match) => match[1])
}

describe('the unsubscribe link', () => {
  test('is appended once when the author did not place one', () => {
    const { html } = renderEmail({ subject: 'Hello', bodyHtml: '<p>Hello {{customer.firstName}}</p>' }, ctx)
    expect(html).toContain('Hello Ada')
    expect(unsubscribeLinks(html)).toHaveLength(1)
  })

  /**
   * The regression.
   *
   * The author places the link by writing `{{unsubscribeUrl}}`. The "did they place it themselves" check
   * used to run on the FINISHED html, after the rewriter had turned their link into a tracking URL — so it
   * never found it, appended a footer, and every message an author had designed carried two ways out.
   */
  test('is not appended a second time when the author placed it themselves', () => {
    const { html } = renderEmail(
      { subject: 'Hello', bodyHtml: '<p>Hi</p><p><a href="{{unsubscribeUrl}}">No more of these</a></p>' },
      ctx,
    )
    expect(unsubscribeLinks(html)).toHaveLength(1)
    // And it is still the author's anchor, not a footer bolted on beneath it.
    expect(html).toContain('No more of these')
    expect(html).not.toContain('>Unsubscribe<')
  })

  /**
   * An unsubscribe is not a click.
   *
   * Counting one inflates every click rate, and `pickSplitWinner` ranks lanes on click rate — so the variant
   * that drove the most unsubscribes would be promoted as the winner of the test.
   */
  test('is left untracked while every other link is rewritten', () => {
    const { html } = renderEmail(
      { subject: 'Hello', bodyHtml: '<p><a href="https://shop.example/boots">Boots</a> <a href="{{unsubscribeUrl}}">Out</a></p>' },
      ctx,
    )
    const [unsubscribe] = unsubscribeLinks(html)
    expect(unsubscribe).toContain('/api/marketing_automation/unsubscribe')
    expect(unsubscribe).not.toContain('/track/click')
    // The ordinary link went through the rewriter, so attribution still works.
    expect(html).toContain('/track/click')
    expect(html).not.toContain('href="https://shop.example/boots"')
  })

  test('a message with tracking switched off still has exactly one way out', () => {
    const { html } = renderEmail({ subject: 'Hello', bodyHtml: '<p>Hi</p>', track: false }, ctx)
    expect(unsubscribeLinks(html)).toHaveLength(1)
    expect(html).not.toContain('/track/click')
  })

  /**
   * A test send has no run, so it can have no unsubscribe link — and must not grow a footer pointing at a
   * URL that would 404 for the author who clicks it to check.
   */
  test('no run means no footer at all', () => {
    const { html } = renderEmail(
      { subject: 'Hello', bodyHtml: '<p>Hi</p>' },
      { ...ctx, runId: undefined } as unknown as AutomationContext,
    )
    expect(unsubscribeLinks(html)).toHaveLength(0)
  })
})
