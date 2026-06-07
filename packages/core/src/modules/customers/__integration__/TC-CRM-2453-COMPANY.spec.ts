import { expect, test } from '@playwright/test'
import {
  createCompanyFixture,
  deleteEntityByBody,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-CRM-2453-COMPANY: Companies v2 detail save persists every field (#2453 sibling)
 *
 * Mirror of TC-CRM-2453 for the companies surface. `updateCompanyCommand` mutated
 * the company entity/profile scalars and then, still inside the same
 * `withAtomicFlush`, ran `syncEntityTags` — whose `loadEntityTagIds`
 * `findWithDecryption` plus the in-scope `CustomerTag` `em.find` are reads on the
 * same EntityManager. Those interleaved reads dropped the still-pending scalar
 * changeset (MikroORM v7 identity-map), so the write returned 200 with
 * `updated_at` bumped while displayName / status / source / primaryEmail / legalName
 * were never persisted. The fix flushes the scalar mutations before the tag-sync
 * phase runs.
 *
 * Sending a `tags` array in the PUT is what forces `syncEntityTags` to run its
 * interleaved find — the exact path that exhibited the lost write. Sending all
 * fields in one PUT also guards against partial-commit regressions.
 */
const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

const BASE_URL = process.env.BASE_URL?.trim() || null
function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

type CompanyDetail = {
  company: {
    displayName?: string | null
    status?: string | null
    source?: string | null
    lifecycleStage?: string | null
    primaryEmail?: string | null
    primaryPhone?: string | null
    updatedAt?: string | null
    updated_at?: string | null
  }
  profile: { legalName?: string | null } | null
}

async function fetchCompanyDetail(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  companyId: string,
): Promise<CompanyDetail> {
  const response = await request.fetch(resolveUrl(`/api/customers/companies/${encodeURIComponent(companyId)}`), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  expect(response.status(), 'GET /api/customers/companies/:id should return 200').toBe(200)
  return (await response.json()) as CompanyDetail
}

function resolveToken(detail: CompanyDetail): string {
  const raw = detail.company.updatedAt ?? detail.company.updated_at
  expect(typeof raw, 'company detail should expose updatedAt').toBe('string')
  return new Date(Date.parse(raw as string)).toISOString()
}

async function createTagFixture(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  suffix: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/customers/tags', {
    token,
    data: { slug: `tc2453-co-${suffix}`, label: `TC2453 Co ${suffix}` },
  })
  const payload = await readJsonSafe(response)
  expect(response.ok(), `Failed to create tag: ${response.status()}`).toBeTruthy()
  const id = (payload as { id?: string; tagId?: string }).id ?? (payload as { tagId?: string }).tagId
  expect(typeof id, 'tag create response should expose id').toBe('string')
  return id as string
}

test('TC-CRM-2453-COMPANY: Companies v2 full-payload save persists every field', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  let companyId: string | null = null
  let tagId: string | null = null

  try {
    const stamp = Date.now()
    companyId = await createCompanyFixture(request, token, `TC2453 Co ${stamp}`)
    tagId = await createTagFixture(request, token, String(stamp))

    const before = await fetchCompanyDetail(request, token, companyId)

    const edits = {
      displayName: `TC2453 Renamed ${stamp}`,
      status: 'active',
      source: 'web',
      lifecycleStage: 'lead',
      primaryEmail: `tc2453co+${stamp}@example.com`,
      primaryPhone: '+1 212 555 2453',
      legalName: `TC2453 Legal ${stamp}`,
    }

    const putResponse = await request.fetch(resolveUrl('/api/customers/companies'), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        [OPTIMISTIC_LOCK_HEADER]: resolveToken(before),
      },
      data: {
        id: companyId,
        // A non-empty tags array forces syncEntityTags to run its interleaved
        // find — the read that previously dropped the scalar changeset.
        tags: [tagId],
        ...edits,
      },
    })

    expect(putResponse.status(), 'PUT should succeed').toBe(200)
    const putBody = (await putResponse.json()) as { ok?: boolean }
    expect(putBody.ok, 'PUT body should report ok').toBe(true)

    const after = await fetchCompanyDetail(request, token, companyId)
    expect(after.company.displayName, 'displayName should persist').toBe(edits.displayName)
    expect(after.company.status, 'status should persist').toBe(edits.status)
    expect(after.company.source, 'source should persist').toBe(edits.source)
    expect(after.company.lifecycleStage, 'lifecycleStage should persist').toBe(edits.lifecycleStage)
    expect(after.company.primaryEmail, 'primaryEmail should persist').toBe(edits.primaryEmail)
    expect(after.company.primaryPhone, 'primaryPhone should persist').toBe(edits.primaryPhone)
    expect(after.profile?.legalName, 'legalName should persist').toBe(edits.legalName)
  } finally {
    await deleteEntityByBody(request, token, '/api/customers/companies', companyId)
    await deleteEntityByBody(request, token, '/api/customers/tags', tagId)
  }
})
