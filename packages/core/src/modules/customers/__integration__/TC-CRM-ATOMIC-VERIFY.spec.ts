import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CRM-ATOMIC-VERIFY: backward-compatibility + data-safety guard for the
 * atomic-write refactor of the customers / customer_accounts modules (PR #2374).
 *
 * The refactor wrapped multi-step writes in `withAtomicFlush(..., { transaction: true })`
 * across the company create/update/delete commands, the address primary-flag sync, and
 * the person-company link create/update/delete commands. This spec asserts — against the
 * live HTTP API — that the externally observable contracts are unchanged after the
 * refactor:
 *
 *   1. Company field fidelity: every field in `companyCreateSchema` (base entity fields
 *      + company profile fields) round-trips set -> read; a partial PUT update re-reads
 *      cleanly. NOTE: `profile.annualRevenue` comes back as a decimal string (e.g.
 *      "1000.00"), so it is compared numerically. `temperature`/`renewalQuarter` are
 *      accepted by the validator but the detail GET does not serialize them, so they are
 *      asserted only insofar as the create succeeds.
 *   2. Address primary-flag BC: two addresses each created with isPrimary=true settle to
 *      exactly one primary; a PUT that promotes the other keeps exactly one primary.
 *   3. Person-company links: create -> GET -> PATCH(isPrimary) -> DELETE round-trip, with
 *      a two-link primary-reassignment proving the atomic "exactly one primary" invariant.
 *   4. Undo round-trip: the `x-om-operation` header carries an undoToken; undo of a
 *      company CREATE removes it, undo of an UPDATE restores fields, and undo of a DELETE
 *      restores the company plus its child address (deleteCompany's snapshot-restore undo).
 *
 * Self-contained: all fixtures are API-created with Date.now()-unique values and removed
 * in finally. No reliance on seeded/demo data.
 */

const COMPANIES_PATH = '/api/customers/companies'
const ADDRESSES_PATH = '/api/customers/addresses'
const PEOPLE_PATH = '/api/customers/people'
const UNDO_PATH = '/api/audit_logs/audit-logs/actions/undo'

type JsonRecord = Record<string, unknown>

function parseUndoToken(res: APIResponse): string {
  const header = res.headers()['x-om-operation'] ?? ''
  expect(header.startsWith('omop:'), `x-om-operation header missing/invalid: "${header}"`).toBeTruthy()
  const decoded = JSON.parse(decodeURIComponent(header.slice('omop:'.length))) as { undoToken?: string }
  expect(typeof decoded.undoToken, 'x-om-operation must carry an undoToken').toBe('string')
  return decoded.undoToken as string
}

async function undo(request: APIRequestContext, token: string, undoToken: string): Promise<void> {
  const res = await apiRequest(request, 'POST', UNDO_PATH, { token, data: { undoToken } })
  const body = (await readJsonSafe(res)) as JsonRecord
  expect(res.status(), `undo failed: ${res.status()} ${JSON.stringify(body)}`).toBe(200)
  expect(body.ok, 'undo response must be { ok: true }').toBe(true)
}

async function getCompanyDetail(
  request: APIRequestContext,
  token: string,
  companyId: string,
  include?: string,
): Promise<APIResponse> {
  const suffix = include ? `?include=${encodeURIComponent(include)}` : ''
  return apiRequest(request, 'GET', `${COMPANIES_PATH}/${companyId}${suffix}`, { token })
}

async function listAddresses(
  request: APIRequestContext,
  token: string,
  entityId: string,
): Promise<Array<{ id: string; is_primary: boolean }>> {
  const res = await apiRequest(request, 'GET', `${ADDRESSES_PATH}?entityId=${entityId}`, { token })
  expect(res.ok(), `list addresses failed: ${res.status()}`).toBeTruthy()
  const body = (await readJsonSafe(res)) as { items?: Array<JsonRecord> }
  return (body.items ?? []).map((item) => ({
    id: String(item.id),
    is_primary: Boolean(item.is_primary),
  }))
}

async function listPersonCompanies(
  request: APIRequestContext,
  token: string,
  personId: string,
): Promise<Array<{ id: string; companyId: string; isPrimary: boolean }>> {
  const res = await apiRequest(request, 'GET', `${PEOPLE_PATH}/${personId}/companies`, { token })
  expect(res.ok(), `list person companies failed: ${res.status()}`).toBeTruthy()
  const body = (await readJsonSafe(res)) as {
    items?: Array<{ id: string; companyId: string; isPrimary: boolean }>
  }
  return body.items ?? []
}

test.describe('TC-CRM-ATOMIC-VERIFY: atomic-write BC + data-safety for customers', () => {
  test('company create/update fields round-trip set -> read', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let companyId: string | null = null

    try {
      const createPayload = {
        displayName: `ATOMIC Co ${stamp}`,
        description: `desc ${stamp}`,
        primaryEmail: `atomic.${stamp}@example.com`,
        primaryPhone: '+14155550123',
        status: 'active',
        lifecycleStage: 'customer',
        source: 'referral',
        temperature: 'hot',
        renewalQuarter: 'Q3',
        isActive: true,
        legalName: `ATOMIC Legal ${stamp}`,
        brandName: `ATOMIC Brand ${stamp}`,
        domain: `atomic-${stamp}.example`,
        websiteUrl: `https://atomic-${stamp}.example`,
        industry: 'Software',
        sizeBucket: '11-50',
        annualRevenue: 1234567,
      }

      const createRes = await apiRequest(request, 'POST', COMPANIES_PATH, { token, data: createPayload })
      expect(createRes.status(), `create company failed: ${createRes.status()}`).toBe(201)
      const createBody = (await readJsonSafe(createRes)) as { id?: string; companyId?: string }
      companyId = createBody.id ?? null
      expect(companyId, 'create response must expose entity id').toBeTruthy()

      const detailRes = await getCompanyDetail(request, token, companyId as string)
      expect(detailRes.ok(), `company detail failed: ${detailRes.status()}`).toBeTruthy()
      const detail = (await readJsonSafe(detailRes)) as {
        company: JsonRecord
        profile: JsonRecord | null
      }

      // Base entity fields round-trip exactly.
      expect(detail.company.displayName).toBe(createPayload.displayName)
      expect(detail.company.description).toBe(createPayload.description)
      expect(detail.company.primaryEmail).toBe(createPayload.primaryEmail)
      expect(detail.company.primaryPhone).toBe(createPayload.primaryPhone)
      expect(detail.company.status).toBe(createPayload.status)
      expect(detail.company.lifecycleStage).toBe(createPayload.lifecycleStage)
      expect(detail.company.source).toBe(createPayload.source)
      expect(detail.company.isActive).toBe(true)

      // Company profile fields round-trip; annualRevenue is a decimal string on read.
      expect(detail.profile).not.toBeNull()
      const profile = detail.profile as JsonRecord
      expect(profile.legalName).toBe(createPayload.legalName)
      expect(profile.brandName).toBe(createPayload.brandName)
      expect(profile.domain).toBe(createPayload.domain)
      expect(profile.websiteUrl).toBe(createPayload.websiteUrl)
      expect(profile.industry).toBe(createPayload.industry)
      expect(profile.sizeBucket).toBe(createPayload.sizeBucket)
      expect(Number(profile.annualRevenue)).toBe(createPayload.annualRevenue)

      // PUT a subset and re-read; updated fields change, untouched fields persist.
      const updatePayload = {
        id: companyId,
        displayName: `ATOMIC Co UPDATED ${stamp}`,
        status: 'prospect',
        industry: 'Fintech',
      }
      const updateRes = await apiRequest(request, 'PUT', COMPANIES_PATH, { token, data: updatePayload })
      expect(updateRes.ok(), `update company failed: ${updateRes.status()}`).toBeTruthy()

      const rereadRes = await getCompanyDetail(request, token, companyId as string)
      const reread = (await readJsonSafe(rereadRes)) as { company: JsonRecord; profile: JsonRecord }
      expect(reread.company.displayName).toBe(updatePayload.displayName)
      expect(reread.company.status).toBe(updatePayload.status)
      expect(reread.profile.industry).toBe(updatePayload.industry)
      // Untouched fields survive the partial update.
      expect(reread.company.lifecycleStage).toBe(createPayload.lifecycleStage)
      expect(reread.profile.legalName).toBe(createPayload.legalName)
      expect(Number(reread.profile.annualRevenue)).toBe(createPayload.annualRevenue)
    } finally {
      await deleteEntityIfExists(request, token, COMPANIES_PATH, companyId)
    }
  })

  test('address primary-flag stays single after atomic create + promote', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let companyId: string | null = null

    try {
      companyId = await createCompanyFixture(request, token, `ATOMIC Addr Co ${stamp}`)

      const create1 = await apiRequest(request, 'POST', ADDRESSES_PATH, {
        token,
        data: { entityId: companyId, addressLine1: `1 First St ${stamp}`, city: 'NYC', isPrimary: true },
      })
      expect(create1.status(), `address1 create failed: ${create1.status()}`).toBe(201)
      const addr1 = String(((await readJsonSafe(create1)) as JsonRecord).id)

      const create2 = await apiRequest(request, 'POST', ADDRESSES_PATH, {
        token,
        data: { entityId: companyId, addressLine1: `2 Second St ${stamp}`, city: 'LA', isPrimary: true },
      })
      expect(create2.status(), `address2 create failed: ${create2.status()}`).toBe(201)
      const addr2 = String(((await readJsonSafe(create2)) as JsonRecord).id)

      // After two isPrimary=true inserts the atomic sync must leave exactly one primary,
      // and it must be the most recently promoted address (addr2).
      const afterCreate = await listAddresses(request, token, companyId)
      expect(afterCreate.filter((a) => a.is_primary)).toHaveLength(1)
      expect(afterCreate.find((a) => a.id === addr2)?.is_primary, 'addr2 is the primary').toBe(true)
      expect(afterCreate.find((a) => a.id === addr1)?.is_primary, 'addr1 demoted').toBe(false)

      // Promote addr1 via PUT; still exactly one primary, now addr1.
      const promote = await apiRequest(request, 'PUT', ADDRESSES_PATH, {
        token,
        data: { id: addr1, isPrimary: true },
      })
      expect(promote.ok(), `promote addr1 failed: ${promote.status()}`).toBeTruthy()

      const afterPromote = await listAddresses(request, token, companyId)
      expect(afterPromote.filter((a) => a.is_primary)).toHaveLength(1)
      expect(afterPromote.find((a) => a.id === addr1)?.is_primary, 'addr1 now primary').toBe(true)
      expect(afterPromote.find((a) => a.id === addr2)?.is_primary, 'addr2 demoted').toBe(false)
    } finally {
      // Addresses are removed by the company delete cascade.
      await deleteEntityIfExists(request, token, COMPANIES_PATH, companyId)
    }
  })

  test('person-company link create/update/delete round-trips with single-primary invariant', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    let companyA: string | null = null
    let companyB: string | null = null

    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Atomic',
        lastName: 'Linker',
        displayName: `Atomic Linker ${stamp}`,
      })
      companyA = await createCompanyFixture(request, token, `ATOMIC Link A ${stamp}`)
      companyB = await createCompanyFixture(request, token, `ATOMIC Link B ${stamp}`)

      // Create link A (primary).
      const createA = await apiRequest(request, 'POST', `${PEOPLE_PATH}/${personId}/companies`, {
        token,
        data: { companyId: companyA, isPrimary: true },
      })
      expect(createA.ok(), `link A create failed: ${createA.status()}`).toBeTruthy()
      const bodyA = (await readJsonSafe(createA)) as { ok: boolean; result: { id: string; isPrimary: boolean } }
      expect(bodyA.ok).toBe(true)
      const linkA = bodyA.result.id
      expect(bodyA.result.isPrimary).toBe(true)

      // Create link B (non-primary).
      const createB = await apiRequest(request, 'POST', `${PEOPLE_PATH}/${personId}/companies`, {
        token,
        data: { companyId: companyB, isPrimary: false },
      })
      expect(createB.ok(), `link B create failed: ${createB.status()}`).toBeTruthy()
      const bodyB = (await readJsonSafe(createB)) as { result: { id: string } }
      const linkB = bodyB.result.id

      // Two links: exactly one primary (A).
      const afterCreate = await listPersonCompanies(request, token, personId)
      expect(afterCreate).toHaveLength(2)
      expect(afterCreate.filter((l) => l.isPrimary)).toHaveLength(1)
      expect(afterCreate.find((l) => l.id === linkA)?.isPrimary, 'A primary').toBe(true)

      // PATCH B -> primary; primary moves atomically from A to B (still exactly one).
      const patch = await apiRequest(request, 'PATCH', `${PEOPLE_PATH}/${personId}/companies/${linkB}`, {
        token,
        data: { isPrimary: true },
      })
      expect(patch.ok(), `patch link B failed: ${patch.status()}`).toBeTruthy()

      const afterPatch = await listPersonCompanies(request, token, personId)
      expect(afterPatch.filter((l) => l.isPrimary)).toHaveLength(1)
      expect(afterPatch.find((l) => l.id === linkB)?.isPrimary, 'B now primary').toBe(true)
      expect(afterPatch.find((l) => l.id === linkA)?.isPrimary, 'A demoted').toBe(false)

      // DELETE link A; one link remains and it is primary (B).
      const del = await apiRequest(request, 'DELETE', `${PEOPLE_PATH}/${personId}/companies/${linkA}`, { token })
      expect(del.ok(), `delete link A failed: ${del.status()}`).toBeTruthy()

      const afterDelete = await listPersonCompanies(request, token, personId)
      expect(afterDelete).toHaveLength(1)
      expect(afterDelete[0].id).toBe(linkB)
      expect(afterDelete[0].isPrimary, 'sole remaining link is primary').toBe(true)
    } finally {
      // Unlink anything still attached so the company deletes are not blocked (422).
      if (personId) {
        const remaining = await listPersonCompanies(request, token, personId).catch(() => [])
        for (const link of remaining) {
          await apiRequest(request, 'DELETE', `${PEOPLE_PATH}/${personId}/companies/${link.id}`, { token }).catch(
            () => {},
          )
        }
      }
      await deleteEntityIfExists(request, token, PEOPLE_PATH, personId)
      await deleteEntityIfExists(request, token, COMPANIES_PATH, companyA)
      await deleteEntityIfExists(request, token, COMPANIES_PATH, companyB)
    }
  })

  test('undo of company create removes the company', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let companyId: string | null = null

    try {
      const createRes = await apiRequest(request, 'POST', COMPANIES_PATH, {
        token,
        data: { displayName: `ATOMIC Undo-Create ${stamp}` },
      })
      expect(createRes.status()).toBe(201)
      companyId = ((await readJsonSafe(createRes)) as { id?: string }).id ?? null
      expect(companyId).toBeTruthy()
      const undoToken = parseUndoToken(createRes)

      const before = await getCompanyDetail(request, token, companyId as string)
      expect(before.status(), 'company exists before undo').toBe(200)

      await undo(request, token, undoToken)

      const after = await getCompanyDetail(request, token, companyId as string)
      expect(after.status(), 'company gone after undo of create').toBe(404)
      companyId = null // already removed by undo
    } finally {
      await deleteEntityIfExists(request, token, COMPANIES_PATH, companyId)
    }
  })

  test('undo of company update restores fields', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let companyId: string | null = null

    try {
      companyId = await createCompanyFixture(request, token, `ATOMIC Undo-Update ${stamp}`)

      // Update to a distinct status, capturing the update's undo token.
      const updateRes = await apiRequest(request, 'PUT', COMPANIES_PATH, {
        token,
        data: { id: companyId, status: 'won', displayName: `ATOMIC Undo-Update CHANGED ${stamp}` },
      })
      expect(updateRes.ok(), `update failed: ${updateRes.status()}`).toBeTruthy()
      const undoToken = parseUndoToken(updateRes)

      const changed = (await readJsonSafe(await getCompanyDetail(request, token, companyId))) as {
        company: JsonRecord
      }
      expect(changed.company.status).toBe('won')

      await undo(request, token, undoToken)

      const restored = (await readJsonSafe(await getCompanyDetail(request, token, companyId))) as {
        company: JsonRecord
      }
      // Reverted to the fixture's create-time state (status was unset, displayName original).
      expect(restored.company.status).not.toBe('won')
      expect(restored.company.displayName).toBe(`ATOMIC Undo-Update ${stamp}`)
    } finally {
      await deleteEntityIfExists(request, token, COMPANIES_PATH, companyId)
    }
  })

  test('undo of company delete restores the company and its child address', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let companyId: string | null = null

    try {
      companyId = await createCompanyFixture(request, token, `ATOMIC Undo-Delete ${stamp}`)

      const addrRes = await apiRequest(request, 'POST', ADDRESSES_PATH, {
        token,
        data: { entityId: companyId, addressLine1: `99 Restore Rd ${stamp}`, isPrimary: true },
      })
      expect(addrRes.status()).toBe(201)
      const addressId = String(((await readJsonSafe(addrRes)) as JsonRecord).id)

      const delRes = await apiRequest(request, 'DELETE', `${COMPANIES_PATH}?id=${companyId}`, { token })
      expect(delRes.ok(), `delete failed: ${delRes.status()}`).toBeTruthy()
      const undoToken = parseUndoToken(delRes)

      const afterDelete = await getCompanyDetail(request, token, companyId)
      expect(afterDelete.status(), 'company gone after delete').toBe(404)

      await undo(request, token, undoToken)

      const restoredRes = await getCompanyDetail(request, token, companyId, 'addresses')
      expect(restoredRes.status(), 'company restored after undo of delete').toBe(200)
      const restored = (await readJsonSafe(restoredRes)) as {
        company: JsonRecord
        addresses: Array<JsonRecord>
      }
      expect(restored.company.displayName).toBe(`ATOMIC Undo-Delete ${stamp}`)
      // The deleteCompany undo replays the snapshot, restoring the child address by id.
      const restoredAddress = restored.addresses.find((a) => String(a.id) === addressId)
      expect(restoredAddress, 'child address restored by undo').toBeTruthy()
      expect(Boolean(restoredAddress?.isPrimary), 'restored address keeps its primary flag').toBe(true)
    } finally {
      await deleteEntityIfExists(request, token, COMPANIES_PATH, companyId)
    }
  })
})
