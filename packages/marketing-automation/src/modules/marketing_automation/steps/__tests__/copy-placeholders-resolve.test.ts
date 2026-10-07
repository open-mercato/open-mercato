import { renderEmail } from '../send-email'
import { COPY_PLACEHOLDERS, interpolate } from '../../lib/interpolate'
import { neededRenderRoots } from '../../lib/render-values'
import type { AutomationContext } from '../../lib/engine/types'

/**
 * Every placeholder the module offers an author must resolve on a real send.
 *
 * This is the test that was missing, and its absence cost the module its worst bug: six of the eight entries
 * in `COPY_PLACEHOLDERS` could not resolve, because the persisted run context deliberately carries no
 * customer record and nothing put one back before interpolation. `interpolate` leaves an unresolved
 * placeholder verbatim, so the shipped Welcome template mailed customers a subject line reading
 * `Welcome, {{customer.displayName}}` — while the Preview button beside it rendered "Welcome, Ada", because
 * the preview endpoint spread the customer in and the send did not.
 *
 * The existing render test did not catch it because its fixture put `customer` straight into the context.
 * That is a context no send ever has. This one uses the real shape.
 */

/** What `lib/dispatcher.ts` actually persists — ids and scope, and nothing about the person. */
const REAL_CONTEXT = {
  tenantId: 't1',
  organizationId: 'o1',
  eventId: 'customers.person.created',
  occurredAt: '2026-09-30T08:00:00.000Z',
  dispatchDepth: 1,
  subjectEntityId: 'cust-1',
  campaignId: 'camp-1',
  runId: 'run-1',
  actionId: 'step-1',
  trigger: {},
} as unknown as AutomationContext

/** The shape `loadRenderValues` returns with every root asked for. */
const VALUES = {
  customer: { displayName: 'Ada Lovelace', email: 'ada@example.com' },
  score: { points: 120, tier: 'silver' },
  orders: { count: 3, totalGross: 900, daysSinceLast: 30 },
  survey: { nps: 9, answeredAt: '2026-09-01T00:00:00.000Z' },
}

const originalEnv = { ...process.env }
beforeAll(() => {
  process.env.OM_MARKETING_TRACKING_SECRET = 'test-tracking-secret'
  process.env.APP_URL = 'https://shop.example'
})
afterAll(() => { process.env = { ...originalEnv } })

describe('the placeholders the editor offers', () => {
  test('all of them resolve against a real run context plus send-time values', () => {
    const body = COPY_PLACEHOLDERS.join(' | ')
    const { html } = renderEmail({ subject: 'x', bodyHtml: `<p>${body}</p>` }, REAL_CONTEXT, { values: VALUES })

    // Not one survives. A surviving placeholder is a pair of literal braces in somebody's inbox.
    const survivors = COPY_PLACEHOLDERS.filter((placeholder) => html.includes(placeholder))
    expect(survivors).toEqual([])
  })

  test('the customer ones come out as the customer, not as braces', () => {
    const { subject } = renderEmail(
      { subject: 'Welcome, {{customer.displayName}}', bodyHtml: '<p>hi</p>' },
      REAL_CONTEXT,
      { values: VALUES },
    )
    expect(subject).toBe('Welcome, Ada Lovelace')
  })

  test('without the values they would not resolve, which is the bug this guards', () => {
    // Stated as a test rather than a comment so the failure mode is executable: this is exactly what a send
    // produced before the values were loaded.
    expect(interpolate('Welcome, {{customer.displayName}}', REAL_CONTEXT as unknown as Record<string, unknown>))
      .toBe('Welcome, {{customer.displayName}}')
  })

  test('nothing in the values can shadow the run context', () => {
    // The values are merged UNDER the context. A campaign whose copy could overwrite `runId` would rewrite
    // the tracking token minted from it.
    const { html } = renderEmail(
      { subject: 'x', bodyHtml: '<p>{{runId}}</p>' },
      REAL_CONTEXT,
      { values: { ...VALUES, runId: 'someone-elses-run' } as Record<string, unknown> },
    )
    expect(html).toContain('run-1')
    expect(html).not.toContain('someone-elses-run')
  })
})

describe('what a message asks for is what gets fetched', () => {
  test('copy naming only the customer needs no other root', () => {
    expect([...neededRenderRoots(['Welcome, {{customer.displayName}}', '<p>hi</p>', undefined])]).toEqual(['customer'])
  })

  test('a root nobody mentions is never asked for', () => {
    expect(neededRenderRoots(['<p>nothing here</p>']).size).toBe(0)
  })

  test('the placeholder syntax tolerates spaces, and so does the scan', () => {
    expect(neededRenderRoots(['{{ orders.count }}']).has('orders')).toBe(true)
  })

  test('every root named in COPY_PLACEHOLDERS is one the loader knows', () => {
    // A placeholder offered for a root the loader cannot fill is the original bug in a new costume.
    const roots = neededRenderRoots([COPY_PLACEHOLDERS.join(' ')])
    for (const placeholder of COPY_PLACEHOLDERS) {
      const root = placeholder.replace(/[{}]/g, '').split('.')[0]
      // `unsubscribeUrl` has no root — it is minted from the token, not loaded.
      if (!placeholder.includes('.')) continue
      expect(roots.has(root as never)).toBe(true)
    }
  })
})
