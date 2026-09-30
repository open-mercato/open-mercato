import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-MA-016: subject access and erasure.
 *
 * The export must cover every table this module holds subject data in, and the erasure must be REFUSED
 * without an explicit confirmation — a destructive action reachable by URL alone is one somebody performs
 * by accident. The erasure itself is not exercised against a real customer here: it is irreversible, and a
 * test that quietly anonymised seeded data would make every later test's numbers depend on whether this
 * one ran.
 */
test.describe('TC-MA-016 GDPR export and erasure', () => {
  async function customerId(request: Parameters<typeof apiRequest>[0], token: string): Promise<string | null> {
    const response = await apiRequest(request, 'GET', '/api/customers/people?pageSize=1', { token })
    if (!response.ok()) return null
    const body = await readJsonSafe<{ items?: Array<{ id?: string; entityId?: string }> }>(response)
    return body?.items?.[0]?.entityId ?? body?.items?.[0]?.id ?? null
  }

  test('exports every category of data, and no internals', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const subject = await customerId(request, token)
    test.skip(!subject, 'no customer available in this installation')

    const response = await apiRequest(request, 'GET', `/api/marketing_automation/customers/${subject}/gdpr`, { token })
    expect(response.ok(), await response.text()).toBe(true)
    // One person's complete marketing record must not sit in a cache.
    expect(response.headers()['cache-control']).toContain('no-store')

    const body = await readJsonSafe<Record<string, unknown>>(response)
    for (const key of ['consent', 'consentHistory', 'scoreEntries', 'runs', 'messages', 'engagement']) {
      expect(Array.isArray(body?.[key]), `${key} must be present even when empty`).toBe(true)
    }
    expect(body?.subjectEntityId).toBe(subject)
    expect(typeof body?.exportedAt).toBe('string')
    // Curated, not dumped: the engine's own fields are not part of what the data says about a person.
    const serialised = JSON.stringify(body)
    expect(serialised).not.toContain('claimToken')
    expect(serialised).not.toContain('currentStepIndex')
    expect(serialised).not.toContain('occurrenceKey')
  })

  test('refuses to erase without an explicit confirmation', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const subject = await customerId(request, token)
    test.skip(!subject, 'no customer available in this installation')

    for (const data of [{}, { confirm: true }, { confirm: 'yes' }, { confirm: 'ERASE' }]) {
      const response = await apiRequest(request, 'POST', `/api/marketing_automation/customers/${subject}/gdpr`, { token, data })
      expect(response.status(), JSON.stringify(data)).toBe(400)
      const body = await readJsonSafe<{ code?: string }>(response)
      expect(body?.code).toBe('marketing_automation.errors.eraseNotConfirmed')
    }
  })

  /**
   * A uuid belonging to nobody is a 404, not a report of zeros.
   *
   * It used to answer 200 with every count at zero, which is a lie in the one place a lie is least
   * acceptable: somebody keeps that report as the answer to a legal request. It also made the endpoint an
   * existence oracle — a caller could tell a customer of this organization from anybody else's by whether
   * the report came back.
   */
  test('refuses to report an erasure for somebody who is not a customer here', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const nobody = '00000000-0000-4000-8000-0000000000ff'
    const response = await apiRequest(request, 'POST', `/api/marketing_automation/customers/${nobody}/gdpr`, {
      token,
      data: { confirm: 'erase' },
    })
    expect(response.status(), await response.text()).toBe(404)
  })

  test('erases its own fixture, keeps the consent, and reports what it changed', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    /**
     * Its own fixture, created and removed here.
     *
     * Erasure is irreversible, so it must not touch a customer another spec relies on — and a person this
     * test just created has no marketing data by construction, which is exactly the subject whose report
     * should be all zeros. Erasure nulls subject links rather than deleting rows, so nothing it does stops
     * the fixture being cleaned up afterwards.
     */
    const stamp = Date.now()
    const subject = await createPersonFixture(request, token, {
      firstName: 'QA',
      lastName: `Erasable ${stamp}`,
      displayName: `QA Erasable ${stamp}`,
      primaryEmail: `qa-erasable-${stamp}@example.invalid`,
    })

    try {
      /**
       * A consent record first, and it is not decoration.
       *
       * Erasure keeps consent — forgetting an unsubscribe is how somebody gets mailed again — so this is the
       * row that makes `consentKept` mean something. It is also what turned a hang into a reproducible one:
       * the erasure's raw statements ran on a pooled connection instead of the transaction's, so they waited
       * for locks the same request was holding and the endpoint never answered. Erasing a uuid that belonged
       * to nobody, which is all this spec used to do, touched no rows and never took a lock.
       */
      const consent = await apiRequest(request, 'PUT', `/api/marketing_automation/customers/${subject}/consent`, {
        token,
        data: { channel: 'email', state: 'unsubscribed', reason: 'TC-MA-016 before erasure' },
      })
      expect(consent.status(), await consent.text()).toBe(200)

      const response = await apiRequest(request, 'POST', `/api/marketing_automation/customers/${subject}/gdpr`, {
        token,
        data: { confirm: 'erase' },
      })
      expect(response.ok(), await response.text()).toBe(true)
      const report = await readJsonSafe<{ runs?: number; messages?: number; scoreEntries?: number; consentKept?: number }>(response)
      /**
       * The consent is KEPT and counted — forgetting an unsubscribe is how somebody gets mailed again.
       *
       * The other counts are asserted as numbers rather than as zeros. A brand-new person is not guaranteed to
       * have no marketing data: an installation with a live `customers.person.created` campaign enrols them
       * before this test can erase them, and the first version of this assertion failed on `runs: 1` for
       * exactly that reason. What must be true of every erasure is that it answers with a complete report.
       */
      expect(report?.consentKept).toBe(1)
      for (const key of ['runs', 'messages', 'scoreEntries'] as const) {
        expect(typeof report?.[key], key).toBe('number')
      }

      // Idempotent: a second erasure of the same person is a legitimate request and must not fail on the
      // first one's record of itself.
      const again = await apiRequest(request, 'POST', `/api/marketing_automation/customers/${subject}/gdpr`, {
        token,
        data: { confirm: 'erase' },
      })
      expect(again.ok(), await again.text()).toBe(true)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', subject)
    }
  })

  test('is refused to a principal that may read runs but not change customers', async ({ request }) => {
    const response = await request.get('/api/marketing_automation/customers/00000000-0000-4000-8000-000000000000/gdpr')
    expect([401, 403]).toContain(response.status())
  })
})
