import { expect, test } from '@playwright/test'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityByBody,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-CRM-company-delete-guard: deleting a company that still has dependents
 * returns a structured 422 the detail page can surface as a flash.
 *
 * Regression for the runtime crash where CompanyDetailV2Page.handleDelete let
 * the deleteCrud rejection propagate (the "Cannot delete company: linked …"
 * error hit the Next.js error overlay instead of a toast). The page now catches
 * the rejection and flashes the message; this test pins the server contract the
 * client relies on (status 422, code COMPANY_HAS_DEPENDENTS, human message),
 * and that the delete succeeds once the dependents are removed.
 */
const BASE_URL = process.env.BASE_URL?.trim() || null
function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

test('TC-CRM-company-delete-guard: company with a linked person is refused with a structured 422', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  let companyId: string | null = null
  let personId: string | null = null

  try {
    companyId = await createCompanyFixture(request, token, `TC-DELGUARD Co ${Date.now()}`)
    personId = await createPersonFixture(request, token, {
      firstName: 'Del',
      lastName: 'Guard',
      displayName: 'Del Guard',
      companyEntityId: companyId,
    })

    const blocked = await request.fetch(resolveUrl('/api/customers/companies'), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { id: companyId },
    })
    expect(blocked.status(), 'deleting a company with dependents should be refused, not crash').toBe(422)
    const body = (await blocked.json()) as { error?: string; code?: string }
    expect(body.code, 'structured dependents code').toBe('COMPANY_HAS_DEPENDENTS')
    expect(typeof body.error, 'human-readable message present').toBe('string')
    expect(body.error ?? '', 'message explains the linkage').toMatch(/Cannot delete company/i)

    // Remove the dependent, then the company deletes cleanly.
    await deleteEntityByBody(request, token, '/api/customers/people', personId)
    personId = null
    const ok = await request.fetch(resolveUrl('/api/customers/companies'), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { id: companyId },
    })
    expect(ok.status(), 'company deletes once dependents are gone').toBe(200)
    companyId = null
  } finally {
    await deleteEntityByBody(request, token, '/api/customers/people', personId)
    await deleteEntityByBody(request, token, '/api/customers/companies', companyId)
  }
})

/**
 * Regression for #5965: unlinking a person from a company soft-deletes the
 * `customer_person_company_links` row, and the row keeps its `company_entity_id`
 * foreign key. The dependency guard only counts active links, so the delete passed
 * the 422 check and then blew up on the foreign key with an HTTP 500.
 */
test('TC-CRM-company-delete-guard: company deletes after its only person link was soft-deleted', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  let companyId: string | null = null
  let personId: string | null = null

  try {
    companyId = await createCompanyFixture(request, token, `TC-DELGUARD Unlinked Co ${Date.now()}`)
    personId = await createPersonFixture(request, token, {
      firstName: 'Soft',
      lastName: 'Unlinked',
      displayName: 'Soft Unlinked',
      companyEntityId: companyId,
    })

    const unlinked = await request.fetch(resolveUrl(`/api/customers/people/${personId}/companies/${companyId}`), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    expect(unlinked.status(), 'canonical unlink soft-deletes the person-company link').toBe(200)

    const deleted = await request.fetch(resolveUrl('/api/customers/companies'), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { id: companyId },
    })
    expect(deleted.status(), 'company with no active links deletes instead of returning 500').toBe(200)
    companyId = null
  } finally {
    await deleteEntityByBody(request, token, '/api/customers/people', personId)
    await deleteEntityByBody(request, token, '/api/customers/companies', companyId)
  }
})
