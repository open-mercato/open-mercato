import { expect, test } from '@playwright/test'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityByBody,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-CRM-2453: People v2 detail save persists every field (#2453)
 *
 * Regression for the bug where the People v2 edit page returned a 200
 * "Person updated." but discarded the selected values for status, source,
 * lifecycle stage, job title, primary email, and primary phone.
 *
 * Root cause was server-side: `updatePersonCommand` mutated the person/profile
 * scalars and then, still inside the same `withAtomicFlush`, ran queries
 * (`ensureDictionaryEntry` + `syncLegacyPrimaryCompanyLink`, the latter doing a
 * `findOne` + `nativeUpdate`). Those interleaved reads dropped the still-pending
 * scalar changeset, so `updated_at` bumped while the edited columns were never
 * written. The fix flushes the scalar mutations before the read phases run.
 *
 * The person is linked to a company so the PUT keeps `companyEntityId`, which
 * is what triggers `syncLegacyPrimaryCompanyLink` — the exact path that
 * exhibited the lost write. Sending all fields in one PUT also guards against
 * partial-commit regressions.
 */
const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

const BASE_URL = process.env.BASE_URL?.trim() || null
function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

type PersonDetail = {
  person: {
    status?: string | null
    source?: string | null
    lifecycleStage?: string | null
    primaryEmail?: string | null
    primaryPhone?: string | null
    updatedAt?: string | null
    updated_at?: string | null
  }
  profile: { jobTitle?: string | null } | null
}

async function fetchPersonDetail(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  personId: string,
): Promise<PersonDetail> {
  const response = await request.fetch(resolveUrl(`/api/customers/people/${encodeURIComponent(personId)}`), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  expect(response.status(), 'GET /api/customers/people/:id should return 200').toBe(200)
  return (await response.json()) as PersonDetail
}

function resolveToken(detail: PersonDetail): string {
  const raw = detail.person.updatedAt ?? detail.person.updated_at
  expect(typeof raw, 'person detail should expose updatedAt').toBe('string')
  return new Date(Date.parse(raw as string)).toISOString()
}

test('TC-CRM-2453: People v2 full-payload save persists every field', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  let companyId: string | null = null
  let personId: string | null = null

  try {
    companyId = await createCompanyFixture(request, token, `TC2453 Co ${Date.now()}`)
    personId = await createPersonFixture(request, token, {
      firstName: 'Persist',
      lastName: 'Probe',
      displayName: 'Persist Probe',
      companyEntityId: companyId,
    })

    const before = await fetchPersonDetail(request, token, personId)

    const edits = {
      status: 'active',
      source: 'web',
      lifecycleStage: 'lead',
      primaryEmail: `tc2453+${Date.now()}@example.com`,
      primaryPhone: '+1 212 555 2453',
      jobTitle: 'TC2453 Engineer',
    }

    const putResponse = await request.fetch(resolveUrl('/api/customers/people'), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        [OPTIMISTIC_LOCK_HEADER]: resolveToken(before),
      },
      data: {
        id: personId,
        displayName: 'Persist Probe',
        firstName: 'Persist',
        lastName: 'Probe',
        // Keeping companyEntityId forces syncLegacyPrimaryCompanyLink to run —
        // the interleaved read that previously dropped the scalar changeset.
        companyEntityId: companyId,
        ...edits,
      },
    })

    expect(putResponse.status(), 'PUT should succeed').toBe(200)
    const putBody = (await putResponse.json()) as { ok?: boolean }
    expect(putBody.ok, 'PUT body should report ok').toBe(true)

    const after = await fetchPersonDetail(request, token, personId)
    expect(after.person.status, 'status should persist').toBe(edits.status)
    expect(after.person.source, 'source should persist').toBe(edits.source)
    expect(after.person.lifecycleStage, 'lifecycleStage should persist').toBe(edits.lifecycleStage)
    expect(after.person.primaryEmail, 'primaryEmail should persist').toBe(edits.primaryEmail)
    expect(after.person.primaryPhone, 'primaryPhone should persist').toBe(edits.primaryPhone)
    expect(after.profile?.jobTitle, 'jobTitle should persist').toBe(edits.jobTitle)
  } finally {
    await deleteEntityByBody(request, token, '/api/customers/people', personId)
    await deleteEntityByBody(request, token, '/api/customers/companies', companyId)
  }
})
