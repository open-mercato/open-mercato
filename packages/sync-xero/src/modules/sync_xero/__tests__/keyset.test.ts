/** @jest-environment node */
import { createXeroApiClient } from '../lib/api-client'
import { XERO_ENDPOINTS } from '../lib/constants'
import { createXeroDescriptor } from '../lib/descriptor'
import { walkXeroContacts, type XeroKeysetPage } from '../lib/keyset'
import { buildXeroGrantOwner } from '../lib/owner'
import { startFakeXeroApi, toXeroDotNetDate, type FakeXeroApi, type FakeXeroContact } from '../lib/testing/fakeXeroApi'
import { createFakeGrantService, type FakeGrantService } from './support/fakeGrantService'

const ORG = '996096ec-5362-40dd-be90-3e6a2be09dce'
const PROVIDER_DATA = { xeroOrganisationId: ORG, xeroConnectionId: 'a0a0a0a0-0000-4000-8000-00000000000a', xeroOrganisationName: 'Demo' }

function at(iso: string): string {
  return toXeroDotNetDate(new Date(iso))
}

function contact(id: string, iso: string): FakeXeroContact {
  return { ContactID: id, Name: `Contact ${id}`, ContactStatus: 'ACTIVE', UpdatedDateUTC: at(iso) }
}

let api: FakeXeroApi
let grants: FakeGrantService

async function setup(contacts: FakeXeroContact[]) {
  grants = createFakeGrantService({ connected: true, providerData: PROVIDER_DATA })
  api = await startFakeXeroApi({ isTokenValid: (token) => grants.isTokenValid(token) })
  api.seed({ organisations: [{ tenantId: ORG, connectionId: 'conn', name: 'Demo' }], contacts: { [ORG]: contacts } })
  return createXeroApiClient({
    grantService: grants.service,
    descriptor: createXeroDescriptor(XERO_ENDPOINTS),
    owner: buildXeroGrantOwner({ tenantId: 't', organizationId: 'o' }),
    endpoints: api.endpoints,
    budget: 'run',
    sleep: async () => undefined,
  })
}

async function collect(pages: AsyncGenerator<XeroKeysetPage>): Promise<XeroKeysetPage[]> {
  const collected: XeroKeysetPage[] = []
  for await (const page of pages) collected.push(page)
  return collected
}

function processedIds(pages: XeroKeysetPage[]): string[] {
  return pages.flatMap((page) => page.records.map((entry) => entry.record.ContactID))
}

afterEach(async () => {
  await api?.close()
})

describe('walkXeroContacts', () => {
  it('reads every contact once, re-reading the boundary second and dropping it by id', async () => {
    const contacts = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'].map((id, index) => contact(id, `2026-10-01T10:00:0${index + 1}.500Z`))
    const client = await setup(contacts)
    const pages = await collect(walkXeroContacts({ client, xeroOrganisationId: ORG, startAfter: null, pageSize: 3 }))
    expect(processedIds(pages)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'])
    expect(pages.at(-1)?.drained).toBe(true)
    const requests = api.requests().filter((request) => request.path === 'contacts')
    expect(requests[0]).toMatchObject({ ifModifiedSince: null, query: { page: '1', pageSize: '3', includeArchived: 'true' }, xeroTenantId: ORG })
    expect(requests[1].ifModifiedSince).toBe('2026-10-01T10:00:02Z')
    expect(requests.every((request) => request.query.page === '1')).toBe(true)
  })

  it('pages within an overfull second under the same filter and ends at the page count', async () => {
    const sameSecond = ['a', 'b', 'c', 'd', 'e'].map((id, index) => contact(id, `2026-10-01T10:00:10.${index + 1}00Z`))
    const client = await setup([...sameSecond, contact('f', '2026-10-01T10:00:12.000Z')])
    const pages = await collect(walkXeroContacts({ client, xeroOrganisationId: ORG, startAfter: null, pageSize: 2 }))
    expect(processedIds(pages)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    const requests = api.requests().filter((request) => request.path === 'contacts')
    const overfull = requests.filter((request) => request.ifModifiedSince === '2026-10-01T10:00:09Z').map((request) => request.query.page)
    expect(overfull).toEqual(['1', '2', '3'])
    expect(requests).toHaveLength(4)
    expect(pages.at(-1)?.drained).toBe(true)
  })

  it('processes a contact again when it is edited during the walk', async () => {
    const contacts = ['c1', 'c2', 'c3', 'c4'].map((id, index) => contact(id, `2026-10-01T10:00:0${index + 1}.500Z`))
    const client = await setup(contacts)
    const walk = walkXeroContacts({ client, xeroOrganisationId: ORG, startAfter: null, pageSize: 2 })
    const first = await walk.next()
    expect((first.value as XeroKeysetPage).records.map((entry) => entry.record.ContactID)).toEqual(['c1', 'c2'])
    api.seed({ contacts: { [ORG]: [contact('c1', '2026-10-01T10:00:20.500Z'), ...contacts.slice(1)] } })
    const rest = await collect(walk)
    expect(processedIds(rest)).toEqual(['c3', 'c4', 'c1'])
    expect(rest.flatMap((page) => page.records).find((entry) => entry.record.ContactID === 'c1')?.updatedAt.toISOString()).toBe(
      '2026-10-01T10:00:20.500Z',
    )
  })

  it('ends after one request when the first page is short or the last page', async () => {
    const client = await setup([contact('c1', '2026-10-01T10:00:01.000Z'), contact('c2', '2026-10-01T10:00:02.000Z')])
    const pages = await collect(walkXeroContacts({ client, xeroOrganisationId: ORG, startAfter: null, pageSize: 2 }))
    expect(pages).toHaveLength(1)
    expect(pages[0]).toMatchObject({ drained: true })
    expect(pages[0].lastUpdatedAt?.toISOString()).toBe('2026-10-01T10:00:02.000Z')
  })

  it('starts an incremental walk one second before the keyset, and yields an empty drained page when nothing changed', async () => {
    const client = await setup([contact('c1', '2026-10-01T10:00:01.000Z')])
    const pages = await collect(
      walkXeroContacts({ client, xeroOrganisationId: ORG, startAfter: new Date('2026-10-01T10:00:05.700Z'), pageSize: 1000 }),
    )
    expect(api.requests()[0].ifModifiedSince).toBe('2026-10-01T10:00:04Z')
    expect(pages).toEqual([expect.objectContaining({ records: [], lastUpdatedAt: null, drained: true })])
  })

  it('reports the Date header, the quota and the grant providerData of every page', async () => {
    const client = await setup([contact('c1', '2026-10-01T10:00:01.000Z')])
    const [page] = await collect(walkXeroContacts({ client, xeroOrganisationId: ORG, startAfter: null }))
    expect(page.date).toBeInstanceOf(Date)
    expect(page.quota.dayRemaining).toBe(999)
    expect(page.providerData).toEqual(PROVIDER_DATA)
  })

  it('stops before the next request once the signal is aborted', async () => {
    const client = await setup(['c1', 'c2', 'c3'].map((id, index) => contact(id, `2026-10-01T10:00:0${index + 1}.000Z`)))
    const controller = new AbortController()
    const walk = walkXeroContacts({ client, xeroOrganisationId: ORG, startAfter: null, pageSize: 1, signal: controller.signal })
    await walk.next()
    controller.abort(new Error('cancelled'))
    await expect(walk.next()).rejects.toThrow('cancelled')
    expect(api.requests()).toHaveLength(1)
  })
})
