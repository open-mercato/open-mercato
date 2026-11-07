import { randomInt } from 'node:crypto'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture, createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type Fixture = { personId: string; companyIds: string[]; linkIds: string[] }
type LinkState = { companyId: string; isPrimary: boolean }

async function createFixture(request: APIRequestContext, token: string, stamp: string, companyCount: number): Promise<Fixture> {
  const personId = await createPersonFixture(request, token, {
    firstName: 'PrimaryRace', lastName: stamp, displayName: `PrimaryRace ${stamp}`,
  })
  const fixture: Fixture = { personId, companyIds: [], linkIds: [] }
  try {
    for (let index = 0; index < companyCount; index += 1) {
      const companyId = await createCompanyFixture(request, token, `PrimaryRace Co${index} ${stamp}`)
      fixture.companyIds.push(companyId)
      const linked = await apiRequest(request, 'POST', `/api/customers/people/${personId}/companies`, {
        token, data: { companyId, isPrimary: index === 0 },
      })
      expect(linked.status(), await linked.text()).toBe(200)
      const body = await readJsonSafe<{ result?: { id?: string } }>(linked)
      expect(body?.result?.id).toBeTruthy()
      fixture.linkIds.push(body?.result?.id as string)
    }
  } catch (error) {
    await cleanupFixture(request, token, fixture)
    throw error
  }
  return fixture
}

async function cleanupFixture(request: APIRequestContext, token: string, fixture: Fixture | null): Promise<void> {
  if (!fixture) return
  await deleteEntityIfExists(request, token, '/api/customers/people', fixture.personId)
  for (const companyId of fixture.companyIds) {
    await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
  }
}

async function readLinks(client: IntegrationDbClient, personId: string): Promise<LinkState[]> {
  const result = await client.query<{ company_entity_id: string; is_primary: boolean }>(
    `select company_entity_id, is_primary from customer_person_company_links
      where person_entity_id = $1 and deleted_at is null order by created_at`,
    [personId],
  )
  return result.rows.map((row) => ({ companyId: row.company_entity_id, isPrimary: row.is_primary }))
}

async function readProfileCompanyId(client: IntegrationDbClient, personId: string): Promise<string | null> {
  const result = await client.query<{ company_entity_id: string | null }>(
    'select company_entity_id from customer_people where entity_id = $1',
    [personId],
  )
  return result.rows[0]?.company_entity_id ?? null
}

async function waitForBlockedBackend(
  client: IntegrationDbClient,
  blockerPid: number,
  queryFragment: string,
  waitEvent: string | null = null,
): Promise<number> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const result = await client.query<{ pid: number }>(
      `select pid from pg_stat_activity
        where $1 = any(pg_blocking_pids(pid)) and query like $2
          and ($3::text is null or wait_event = $3)`,
      [blockerPid, `%${queryFragment}%`, waitEvent],
    )
    if (result.rows[0]) return result.rows[0].pid
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('[internal] Primary-company contender did not reach the expected PostgreSQL lock')
}

async function raceBehindProfileGate(
  personId: string,
  first: (request: APIRequestContext) => Promise<APIResponse>,
  second: (request: APIRequestContext) => Promise<APIResponse>,
): Promise<Array<{ status: number; body: string }>> {
  const stamp = `${Date.now()}_${randomInt(1_000_000)}`
  const functionName = `om_pcl_primary_gate_${stamp}`
  const triggerName = `om_pcl_primary_gate_trigger_${stamp}`
  const gateKey = randomInt(1, 2_147_483_647)
  try {
    await withClient(async (client) => {
      await client.query(
        `create function "${functionName}"() returns trigger language plpgsql as $$
         begin
           perform pg_advisory_xact_lock(${gateKey});
           return new;
         end
         $$`,
      )
      await client.query(
        `create trigger "${triggerName}" before update on customer_people
           for each row when (old.entity_id = '${personId}'::uuid)
           execute function "${functionName}"()`,
      )
    })
    return await withCredentialIsolatedRequest(async (firstRequest) => (
      withCredentialIsolatedRequest(async (secondRequest) => (
        withClient(async (blocker) => (
          withClient(async (observer) => {
            const blockerPid = Number((await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid)
            const pending: Array<Promise<APIResponse>> = []
            await blocker.query('select pg_advisory_lock($1)', [gateKey])
            try {
              const firstPending = first(firstRequest)
              pending.push(firstPending)
              const firstPid = await waitForBlockedBackend(observer, blockerPid, 'customer_people', 'advisory')
              const secondPending = second(secondRequest)
              pending.push(secondPending)
              await waitForBlockedBackend(observer, firstPid, 'customer_')
              await blocker.query('select pg_advisory_unlock($1)', [gateKey])
              const responses = await Promise.all([firstPending, secondPending])
              return Promise.all(responses.map(async (response) => ({ status: response.status(), body: await response.text() })))
            } finally {
              await blocker.query('select pg_advisory_unlock_all()')
              await Promise.allSettled(pending)
            }
          })
        ))
      ))
    ))
  } finally {
    await withClient(async (client) => {
      await client.query(`drop trigger if exists "${triggerName}" on customer_people`)
      await client.query(`drop function if exists "${functionName}"()`)
    })
  }
}

test.describe('TC-CRM-093 person primary company stays unique under concurrent writes', () => {
  test('two overlapping PATCH requests promoting different links leave exactly one primary link', async ({ request }) => {
    test.setTimeout(60_000)
    const token = await getAuthToken(request, 'admin')
    let fixture: Fixture | null = null
    try {
      fixture = await createFixture(request, token, `${Date.now()}_${randomInt(1_000_000)}`, 3)
      const { personId, companyIds, linkIds } = fixture
      const patchPrimary = (linkId: string) => (isolated: APIRequestContext) => apiRequest(
        isolated, 'PATCH', `/api/customers/people/${personId}/companies/${linkId}`,
        { token, data: { isPrimary: true }, timeout: 15_000, retryTransport: false },
      )

      const responses = await raceBehindProfileGate(personId, patchPrimary(linkIds[1]), patchPrimary(linkIds[2]))
      for (const response of responses) expect(response.status, response.body).toBe(200)

      await withClient(async (client) => {
        const primaries = (await readLinks(client, personId)).filter((link) => link.isPrimary)
        expect(primaries.map((link) => link.companyId)).toEqual([companyIds[2]])
        expect(await readProfileCompanyId(client, personId)).toBe(companyIds[2])
      })
    } finally {
      await cleanupFixture(request, token, fixture)
    }
  })

  test('re-promoting the current primary while another link is promoted ends with the later request primary', async ({ request }) => {
    test.setTimeout(60_000)
    const token = await getAuthToken(request, 'admin')
    let fixture: Fixture | null = null
    try {
      fixture = await createFixture(request, token, `${Date.now()}_${randomInt(1_000_000)}`, 2)
      const { personId, companyIds, linkIds } = fixture
      const patchPrimary = (linkId: string) => (isolated: APIRequestContext) => apiRequest(
        isolated, 'PATCH', `/api/customers/people/${personId}/companies/${linkId}`,
        { token, data: { isPrimary: true }, timeout: 15_000, retryTransport: false },
      )

      const responses = await raceBehindProfileGate(personId, patchPrimary(linkIds[1]), patchPrimary(linkIds[0]))
      for (const response of responses) expect(response.status, response.body).toBe(200)

      await withClient(async (client) => {
        const primaries = (await readLinks(client, personId)).filter((link) => link.isPrimary)
        expect(primaries.map((link) => link.companyId)).toEqual([companyIds[0]])
        expect(await readProfileCompanyId(client, personId)).toBe(companyIds[0])
      })
    } finally {
      await cleanupFixture(request, token, fixture)
    }
  })

  test('a primary link create overlapping a primary PATCH leaves exactly one primary link', async ({ request }) => {
    test.setTimeout(60_000)
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}_${randomInt(1_000_000)}`
    let fixture: Fixture | null = null
    try {
      fixture = await createFixture(request, token, stamp, 2)
      const { personId, companyIds, linkIds } = fixture
      const newCompanyId = await createCompanyFixture(request, token, `PrimaryRace New ${stamp}`)
      companyIds.push(newCompanyId)

      const responses = await raceBehindProfileGate(
        personId,
        (isolated) => apiRequest(isolated, 'PATCH', `/api/customers/people/${personId}/companies/${linkIds[1]}`, {
          token, data: { isPrimary: true }, timeout: 15_000, retryTransport: false,
        }),
        (isolated) => apiRequest(isolated, 'POST', `/api/customers/people/${personId}/companies`, {
          token, data: { companyId: newCompanyId, isPrimary: true }, timeout: 15_000, retryTransport: false,
        }),
      )
      expect(responses[0].status, responses[0].body).toBe(200)
      expect(responses[1].status, responses[1].body).toBe(200)

      await withClient(async (client) => {
        const primaries = (await readLinks(client, personId)).filter((link) => link.isPrimary)
        expect(primaries.map((link) => link.companyId)).toEqual([newCompanyId])
        expect(await readProfileCompanyId(client, personId)).toBe(newCompanyId)
      })
    } finally {
      await cleanupFixture(request, token, fixture)
    }
  })

  test('re-promoting the current primary link keeps it primary', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let fixture: Fixture | null = null
    try {
      fixture = await createFixture(request, token, `${Date.now()}_${randomInt(1_000_000)}`, 2)
      const { personId, companyIds, linkIds } = fixture
      const response = await apiRequest(request, 'PATCH', `/api/customers/people/${personId}/companies/${linkIds[0]}`, {
        token, data: { isPrimary: true },
      })
      expect(response.status(), await response.text()).toBe(200)

      await withClient(async (client) => {
        const primaries = (await readLinks(client, personId)).filter((link) => link.isPrimary)
        expect(primaries.map((link) => link.companyId)).toEqual([companyIds[0]])
        expect(await readProfileCompanyId(client, personId)).toBe(companyIds[0])
      })
    } finally {
      await cleanupFixture(request, token, fixture)
    }
  })

  test('saving the person with one of two primary companies repairs the duplicate to a single primary', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let fixture: Fixture | null = null
    try {
      fixture = await createFixture(request, token, `${Date.now()}_${randomInt(1_000_000)}`, 2)
      const { personId, companyIds } = fixture
      await withClient(async (client) => {
        await client.query(
          'update customer_person_company_links set is_primary = true where person_entity_id = $1 and deleted_at is null',
          [personId],
        )
      })
      const response = await apiRequest(request, 'PUT', '/api/customers/people', {
        token, data: { id: personId, companyEntityId: companyIds[1] },
      })
      expect(response.status(), await response.text()).toBe(200)

      await withClient(async (client) => {
        const primaries = (await readLinks(client, personId)).filter((link) => link.isPrimary)
        expect(primaries.map((link) => link.companyId)).toEqual([companyIds[1]])
        expect(await readProfileCompanyId(client, personId)).toBe(companyIds[1])
      })
    } finally {
      await cleanupFixture(request, token, fixture)
    }
  })
})
