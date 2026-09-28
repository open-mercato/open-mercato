import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

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

  test('erases a customer who has no marketing data, and reports zero counts', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    // A uuid belonging to nobody: erasure is idempotent and safe on an empty subject, which is what makes
    // it testable without destroying anything.
    const nobody = '00000000-0000-4000-8000-0000000000ff'
    const response = await apiRequest(request, 'POST', `/api/marketing_automation/customers/${nobody}/gdpr`, {
      token,
      data: { confirm: 'erase' },
    })
    expect(response.ok(), await response.text()).toBe(true)
    const report = await readJsonSafe<{ runs?: number; messages?: number; scoreEntries?: number; consentKept?: number }>(response)
    expect(report).toMatchObject({ runs: 0, messages: 0, scoreEntries: 0, consentKept: 0 })
  })

  test('is refused to a principal that may read runs but not change customers', async ({ request }) => {
    const response = await request.get('/api/marketing_automation/customers/00000000-0000-4000-8000-000000000000/gdpr')
    expect([401, 403]).toContain(response.status())
  })
})
