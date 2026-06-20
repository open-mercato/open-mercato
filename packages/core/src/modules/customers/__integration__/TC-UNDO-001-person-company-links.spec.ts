import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createPersonFixture, createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  expectOperation,
  undoOk,
  expectTokenConsumed,
  skipIfUndoTestsDisabled,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 customers.personCompanyLinks (#2572) — regression for #2507.
 *
 * Linking a person to a company then undoing must soft-delete the link (I3) and reject the
 * consumed token on a second undo (I5). Issue #2507 (fixed by #2509) was an undo no-op under
 * tenant encryption; this drives the real nested route + undo endpoint and asserts the link
 * actually disappears. Self-contained: person and company are created via API and removed in
 * teardown.
 */

async function linkedCompanyIds(
  request: APIRequestContext,
  token: string,
  personId: string,
): Promise<string[]> {
  const res = await apiRequest(request, 'GET', `/api/customers/people/${encodeURIComponent(personId)}/companies`, { token })
  const body = (await readJsonSafe(res)) as { items?: Array<{ id: string; companyId: string }> } | null
  return (body?.items ?? []).map((item) => item.companyId)
}

test.describe('TC-UNDO-001 customers.personCompanyLinks undo (#2507)', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('create link → undo removes it (I3) + token consumed (I5)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    let companyId: string | null = null
    let linkId: string | null = null
    try {
      companyId = await createCompanyFixture(request, token, `Undo LinkCo ${stamp}`)
      personId = await createPersonFixture(request, token, {
        firstName: 'Undo',
        lastName: `LinkPerson ${stamp}`,
        displayName: `Undo LinkPerson ${stamp}`,
      })

      const createRes = await apiRequest(request, 'POST', `/api/customers/people/${personId}/companies`, {
        token,
        data: { companyId },
      })
      expect(createRes.ok(), `link create status ${createRes.status()}`).toBeTruthy()
      const createOp = expectOperation(createRes, 'personCompanyLinks.create')
      const createBody = (await readJsonSafe(createRes)) as { result?: { id?: string } } | null
      linkId = createBody?.result?.id ?? null
      expect(linkId, 'link id present').toBeTruthy()
      expect(await linkedCompanyIds(request, token, personId as string), 'company linked after create').toContain(companyId)

      await undoOk(request, token, createOp.undoToken, 'undo person-company link create')
      expect(await linkedCompanyIds(request, token, personId as string), 'link removed on undo (I3, #2507)').not.toContain(companyId)

      await expectTokenConsumed(request, token, createOp.undoToken, 'personCompanyLinks.create double-undo (I5)')
    } finally {
      if (personId && linkId) await apiRequest(request, 'DELETE', `/api/customers/people/${personId}/companies/${linkId}`, { token }).catch(() => {})
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
