import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { ImportItem } from '@open-mercato/core/modules/data_sync/lib/adapter'
import type { AddressSnapshot } from '../lib/contacts/addresses'
import type { ClaimCompanyMappingInput } from '../lib/contacts/claim'
import type { CompanySnapshot } from '../lib/contacts/compare'
import { buildXeroCommandContext, createXeroContactWriter, type XeroContactWriter } from '../lib/contacts/company-writer'
import { createLazyXeroCompanyIndexes, type XeroCompanyIndexSources } from '../lib/contacts/indexes'
import type { XeroRunIndex } from '../lib/contacts/preload'
import type { XeroContactRecord } from '../lib/keyset'
import { createFakeContainer } from './support/fakeContainer'

const mockLoadSnapshots = jest.fn()
const mockClaim = jest.fn()
const mockLoadRunIndex = jest.fn()
const mockLoadIndexSources = jest.fn()
const mockLoadAddressState = jest.fn()
const mockStoreMapping = jest.fn()

jest.mock('../lib/contacts/preload', () => ({
  ...jest.requireActual('../lib/contacts/preload'),
  loadCompanySnapshots: (...args: unknown[]) => mockLoadSnapshots(...args),
  loadXeroRunIndex: (...args: unknown[]) => mockLoadRunIndex(...args),
  loadXeroAddressState: (...args: unknown[]) => mockLoadAddressState(...args),
}))

jest.mock('@open-mercato/core/modules/data_sync/lib/id-mapping', () => ({
  createExternalIdMappingService: () => ({ storeExternalIdMapping: (...args: unknown[]) => mockStoreMapping(...args) }),
}))

jest.mock('../lib/contacts/indexes', () => ({
  ...jest.requireActual('../lib/contacts/indexes'),
  loadXeroCompanyIndexSources: (...args: unknown[]) => mockLoadIndexSources(...args),
}))

jest.mock('../lib/contacts/claim', () => ({
  ...jest.requireActual('../lib/contacts/claim'),
  claimCompanyMapping: (...args: unknown[]) => mockClaim(...args),
}))

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const ORG = 'a3b1c2d3-0000-4000-8000-000000000001'
const PERSONAL = ['Acme Ltd', 'billing@acme.example', '+44 20 7946 0000', 'GB 123 456']

type StoredCompany = CompanySnapshot & { createdAt: number }
type StoredAddress = AddressSnapshot & { purpose?: string; isPrimary?: boolean }
type Command = { id: string; input: Record<string, unknown> }

let companies: Map<string, StoredCompany>
let mappings: Map<string, string>
let addresses: Map<string, StoredAddress>
let addressMappings: Map<string, string>
let commands: Command[]
let logWrites: Array<Record<string, unknown>>
let sequence: number
let failNextCommand: unknown
let refuseDelete: boolean
let indexLoads: number

const em = { fork() { return em } } as unknown as EntityManager

function externalIdOf(contactId: string): string {
  return `${ORG}:${contactId}`
}

function record(contactId: string, fields: Record<string, unknown> = {}): XeroContactRecord {
  return {
    ContactID: contactId,
    UpdatedDateUTC: '/Date(1760000000000+0000)/',
    Name: 'Acme Ltd',
    EmailAddress: 'billing@acme.example',
    Phones: [{ PhoneType: 'DEFAULT', PhoneNumber: '7946 0000', PhoneAreaCode: '020', PhoneCountryCode: '44' }],
    ContactStatus: 'ACTIVE',
    ...fields,
  }
}

function storeCompany(fields: Partial<StoredCompany> & { entityId: string }): StoredCompany {
  const company: StoredCompany = {
    displayName: 'Existing',
    legalName: null,
    primaryEmail: null,
    primaryPhone: null,
    websiteUrl: null,
    status: 'active',
    isActive: true,
    custom: {},
    createdAt: ++sequence,
    ...fields,
  }
  companies.set(company.entityId, company)
  return company
}

function applyInput(company: StoredCompany, input: Record<string, unknown>): void {
  for (const key of ['displayName', 'legalName', 'primaryEmail', 'primaryPhone', 'websiteUrl', 'status', 'isActive'] as const) {
    if (key in input) Object.assign(company, { [key]: input[key] })
  }
  if (input.customFields) company.custom = { ...company.custom, ...(input.customFields as Record<string, unknown>) }
}

const commandBus = {
  async execute<TInput, TResult>(id: string, options: { input: TInput }): Promise<{ result: TResult; logEntry: null }> {
    const input = options.input as Record<string, unknown>
    commands.push({ id, input })
    if (failNextCommand) {
      const error = failNextCommand
      failNextCommand = null
      throw error
    }
    if (id === 'customers.companies.create') {
      const entityId = `e-${++sequence}`
      const company = storeCompany({ entityId, displayName: String(input.displayName) })
      applyInput(company, input)
      return { result: { entityId, companyId: `p-${sequence}` } as TResult, logEntry: null }
    }
    if (id === 'customers.companies.update') {
      applyInput(companies.get(String(input.id))!, input)
      return { result: { entityId: input.id } as TResult, logEntry: null }
    }
    if (id === 'customers.addresses.create') {
      const addressId = `a-${++sequence}`
      const { organizationId: _organizationId, tenantId: _tenantId, ...values } = input
      addresses.set(addressId, { id: addressId, ...(values as Omit<StoredAddress, 'id'>) })
      return { result: { addressId } as TResult, logEntry: null }
    }
    if (id === 'customers.addresses.update') {
      const { id: addressId, organizationId: _organizationId, tenantId: _tenantId, ...values } = input
      addresses.set(String(addressId), { ...addresses.get(String(addressId))!, ...(values as Partial<StoredAddress>) })
      return { result: { addressId } as TResult, logEntry: null }
    }
    if (id === 'customers.addresses.delete') {
      addresses.delete(String(input.id))
      return { result: { addressId: input.id } as TResult, logEntry: null }
    }
    if (id === 'customers.companies.delete') {
      if (refuseDelete) throw new CrudHttpError(422, { error: 'Company has dependents', code: 'COMPANY_HAS_DEPENDENTS' })
      companies.delete(String(input.id))
      return { result: { entityId: input.id } as TResult, logEntry: null }
    }
    throw new Error(`[internal] unexpected command ${id}`)
  },
}

function claimAgainstMappings(input: ClaimCompanyMappingInput) {
  const externalId = externalIdOf(input.contactId)
  const mappedEntityId = mappings.get(externalId)
  if (mappedEntityId === input.candidateEntityId) return { outcome: 'won' }
  if (mappedEntityId) return { outcome: 'lost', winnerEntityId: mappedEntityId, winnerDeleted: !companies.has(mappedEntityId) }
  const candidateMapping = [...mappings.entries()].find(([, entityId]) => entityId === input.candidateEntityId)
  if (candidateMapping && candidateMapping[0] !== externalId) return { outcome: 'lost', winnerEntityId: null }
  mappings.set(externalId, input.candidateEntityId)
  return { outcome: 'won' }
}

function runIndexFrom(rows: Map<string, string>): XeroRunIndex {
  const byExternalId = new Map(rows)
  const mapped = new Set(rows.values())
  return {
    lookup: (externalId) => byExternalId.get(externalId) ?? null,
    isMapped: (entityId) => mapped.has(entityId),
    add(externalId, entityId) {
      byExternalId.set(externalId, entityId)
      mapped.add(entityId)
    },
  }
}

function indexSources(): XeroCompanyIndexSources {
  const live = [...companies.values()]
  return {
    companies: live.map((company) => ({ entityId: company.entityId, createdAt: new Date(company.createdAt), displayName: company.displayName })),
    markers: live
      .filter((company) => typeof company.custom.xero_contact_id === 'string')
      .map((company) => ({ entityId: company.entityId, value: String(company.custom.xero_contact_id) })),
    taxNumbers: live
      .filter((company) => typeof company.custom.xero_tax_number === 'string')
      .map((company) => ({ entityId: company.entityId, value: String(company.custom.xero_tax_number) })),
  }
}

function createWriter(): XeroContactWriter {
  const runIndex = runIndexFrom(mappings)
  return createXeroContactWriter({
    em,
    scope,
    xeroOrganisationId: ORG,
    runId: 'run-1',
    commandBus,
    commandContext: buildXeroCommandContext(createFakeContainer({}), scope),
    logService: { write: async (entry: Record<string, unknown>) => { logWrites.push(entry) } } as never,
    runIndex,
    indexes: createLazyXeroCompanyIndexes(async () => {
      indexLoads += 1
      return indexSources()
    }, runIndex.isMapped),
  })
}

async function writePage(writer: XeroContactWriter, records: XeroContactRecord[]): Promise<ImportItem[]> {
  await writer.preparePage(records)
  const items: ImportItem[] = []
  for (const entry of records) items.push(await writer.write(entry))
  return items
}

function logCodes(): unknown[] {
  return logWrites.map((entry) => entry.code)
}

beforeEach(() => {
  companies = new Map()
  mappings = new Map()
  addresses = new Map()
  addressMappings = new Map()
  commands = []
  logWrites = []
  sequence = 0
  failNextCommand = null
  refuseDelete = false
  indexLoads = 0
  mockLoadSnapshots.mockReset().mockImplementation(async (_em: EntityManager, _scope: unknown, ids: string[]) => {
    const snapshots = new Map<string, CompanySnapshot>()
    for (const id of ids) {
      const company = companies.get(id)
      if (company) snapshots.set(id, { ...company, custom: { ...company.custom } })
    }
    return snapshots
  })
  mockClaim.mockReset().mockImplementation(async (input: ClaimCompanyMappingInput) => claimAgainstMappings(input))
  mockLoadRunIndex.mockReset().mockImplementation(async () => runIndexFrom(mappings))
  mockLoadIndexSources.mockReset().mockImplementation(async () => indexSources())
  mockLoadAddressState.mockReset().mockImplementation(async (_em: EntityManager, _scope: unknown, externalIds: string[]) => {
    const state = { addressIdByExternalId: new Map<string, string>(), addresses: new Map<string, AddressSnapshot>() }
    for (const externalId of externalIds) {
      const addressId = addressMappings.get(externalId)
      if (!addressId) continue
      state.addressIdByExternalId.set(externalId, addressId)
      const row = addresses.get(addressId)
      if (row) state.addresses.set(addressId, { ...row })
    }
    return state
  })
  mockStoreMapping.mockReset().mockImplementation(async (_integrationId: string, _type: string, localId: string, externalId: string) => {
    addressMappings.set(externalId, localId)
  })
})

describe('buildXeroCommandContext', () => {
  it('builds the system-actor context of sync_excel scoped to the organization and tagged with syncOrigin', () => {
    const container = createFakeContainer({})
    expect(buildXeroCommandContext(container, scope)).toEqual({
      container,
      auth: null,
      organizationScope: { selectedId: scope.organizationId, filterIds: [scope.organizationId], allowedIds: [scope.organizationId], tenantId: scope.tenantId },
      selectedOrganizationId: scope.organizationId,
      organizationIds: [scope.organizationId],
      syncOrigin: 'sync_xero',
    })
  })
})

describe('createXeroContactWriter', () => {
  it('creates a Company for a new Contact with the marker and the tax number, claims it and reports ids only', async () => {
    const writer = createWriter()
    const [item] = await writePage(writer, [record('c1', { TaxNumber: 'GB 123 456', Website: 'not a website' })])

    expect(commands).toHaveLength(1)
    expect(commands[0]).toEqual({
      id: 'customers.companies.create',
      input: {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        displayName: 'Acme Ltd',
        legalName: 'Acme Ltd',
        primaryEmail: 'billing@acme.example',
        primaryPhone: '+44 20 7946 0000',
        status: 'active',
        isActive: true,
        customFields: { xero_contact_id: externalIdOf('c1'), xero_tax_number: 'GB 123 456' },
      },
    })
    expect(mappings.get(externalIdOf('c1'))).toBe('e-1')
    expect(item).toEqual({ externalId: externalIdOf('c1'), action: 'create', data: { localId: 'e-1', sourceIdentifier: externalIdOf('c1') } })
    expect(logWrites).toEqual([
      expect.objectContaining({
        integrationId: 'sync_xero',
        runId: 'run-1',
        level: 'warn',
        code: 'xero.value_left_out',
        payload: { sourceIdentifier: externalIdOf('c1'), entityIds: ['e-1'], field: 'websiteUrl' },
      }),
    ])
    const serialized = JSON.stringify({ item, logWrites })
    for (const value of PERSONAL) expect(serialized).not.toContain(value)
  })

  it('runs no command for an unchanged mapped Contact and loads no index', async () => {
    storeCompany({
      entityId: 'e-mapped',
      displayName: 'Acme Ltd',
      legalName: 'Acme Ltd',
      primaryEmail: 'billing@acme.example',
      primaryPhone: '+44 20 7946 0000',
      custom: { xero_contact_id: externalIdOf('c1') },
    })
    mappings.set(externalIdOf('c1'), 'e-mapped')

    const [item] = await writePage(createWriter(), [record('c1')])

    expect(commands).toEqual([])
    expect(item).toMatchObject({ action: 'skip', data: { localId: 'e-mapped' } })
    expect(indexLoads).toBe(0)
  })

  it('updates only the Xero-owned values that differ and never sends an OM-only key', async () => {
    storeCompany({
      entityId: 'e-mapped',
      displayName: 'Acme Ltd',
      legalName: 'Acme Ltd',
      primaryEmail: 'old@acme.example',
      primaryPhone: '+44 20 7946 0000',
      status: 'pending',
      custom: { xero_contact_id: externalIdOf('c1') },
    })
    mappings.set(externalIdOf('c1'), 'e-mapped')

    const [item] = await writePage(createWriter(), [record('c1')])

    expect(commands).toEqual([
      { id: 'customers.companies.update', input: { id: 'e-mapped', organizationId: scope.organizationId, tenantId: scope.tenantId, primaryEmail: 'billing@acme.example' } },
    ])
    expect(item).toMatchObject({ action: 'update', data: { localId: 'e-mapped' } })
  })

  it('updates a Contact read twice in one run and creates nothing the second time', async () => {
    const writer = createWriter()
    await writePage(writer, [record('c1')])
    const [second] = await writePage(writer, [record('c1', { EmailAddress: 'accounts@acme.example' })])

    expect(commands.map((command) => command.id)).toEqual(['customers.companies.create', 'customers.companies.update'])
    expect(second).toMatchObject({ action: 'update', data: { localId: 'e-1' } })
  })

  it('refuses a mapped Contact whose Company was deleted in OM', async () => {
    mappings.set(externalIdOf('c1'), 'e-deleted')

    const [item] = await writePage(createWriter(), [record('c1')])

    expect(commands).toEqual([])
    expect(item).toMatchObject({ action: 'skip', data: { localId: 'e-deleted', errorCode: 'xero.company_deleted_in_om' } })
    expect(logWrites).toEqual([expect.objectContaining({ level: 'warn', code: 'xero.company_deleted_in_om', payload: { sourceIdentifier: externalIdOf('c1'), entityIds: ['e-deleted'] } })])
  })

  it('finds the Company an interrupted attempt left by its marker and writes the Xero values to it', async () => {
    storeCompany({ entityId: 'e-marked', displayName: 'Acme Ltd', custom: { xero_contact_id: externalIdOf('c1') } })

    const [item] = await writePage(createWriter(), [record('c1')])

    expect(commands.map((command) => command.id)).toEqual(['customers.companies.update'])
    expect(mappings.get(externalIdOf('c1'))).toBe('e-marked')
    expect(item).toMatchObject({ action: 'update', data: { localId: 'e-marked' } })
  })

  it('matches an unmapped Company by tax number, logs the match and writes the marker with the first update', async () => {
    storeCompany({ entityId: 'e-tax', displayName: 'Acme (manual)', custom: { xero_tax_number: 'gb123456' } })

    const [item] = await writePage(createWriter(), [record('c1', { TaxNumber: 'GB 123 456' })])

    expect(commands).toHaveLength(1)
    expect(commands[0].id).toBe('customers.companies.update')
    expect(commands[0].input).toMatchObject({ id: 'e-tax', displayName: 'Acme Ltd', customFields: { xero_contact_id: externalIdOf('c1') } })
    expect(item).toMatchObject({ action: 'update', data: { localId: 'e-tax' } })
    expect(logWrites).toEqual([expect.objectContaining({ level: 'info', code: 'xero.company_matched_by_tax_number', payload: { sourceIdentifier: externalIdOf('c1'), entityIds: ['e-tax'] } })])
  })

  it('falls back to CompanyNumber, and names every candidate of an ambiguous number while using the oldest', async () => {
    storeCompany({ entityId: 'e-old', custom: { xero_tax_number: 'REG 1' } })
    storeCompany({ entityId: 'e-new', custom: { xero_tax_number: 'reg1' } })

    const [item] = await writePage(createWriter(), [record('c1', { CompanyNumber: 'REG1' })])

    expect(item).toMatchObject({ action: 'update', data: { localId: 'e-old' } })
    expect(logCodes()).toEqual(['xero.company_match_ambiguous', 'xero.company_matched_by_tax_number'])
    expect(logWrites[0].payload).toEqual({ sourceIdentifier: externalIdOf('c1'), entityIds: ['e-old', 'e-new'] })
  })

  it('never matches by name: it creates the Company and warns of the duplicate risk', async () => {
    storeCompany({ entityId: 'e-namesake', displayName: 'ACME LTD.' })

    const [item] = await writePage(createWriter(), [record('c1')])

    expect(commands.map((command) => command.id)).toEqual(['customers.companies.create'])
    expect(item).toMatchObject({ action: 'create' })
    expect(logWrites).toEqual([expect.objectContaining({ code: 'xero.company_duplicate_risk', payload: { sourceIdentifier: externalIdOf('c1'), entityIds: [item.data?.localId, 'e-namesake'] } })])
  })

  it('caps the Companies named in a log row at 20 and gives their total', async () => {
    for (let index = 0; index < 25; index += 1) storeCompany({ entityId: `e-namesake-${index}`, displayName: 'ACME LTD.' })

    await writePage(createWriter(), [record('c1')])

    const payload = logWrites.find((write) => write.code === 'xero.company_duplicate_risk')?.payload as { entityIds: string[]; entityIdCount: number }
    expect(payload.entityIds).toHaveLength(20)
    expect(payload.entityIdCount).toBe(26)
  })

  it('warns when a second Contact carries a tax number another Contact claimed in the run', async () => {
    storeCompany({ entityId: 'e-tax', custom: { xero_tax_number: 'GB 123' } })
    const writer = createWriter()

    await writePage(writer, [record('c1', { TaxNumber: 'GB123' }), record('c2', { TaxNumber: 'gb 123', Name: 'Acme Trading' })])

    expect(mappings.get(externalIdOf('c1'))).toBe('e-tax')
    expect(mappings.get(externalIdOf('c2'))).toBe('e-2')
    expect(logWrites).toContainEqual(expect.objectContaining({ code: 'xero.tax_number_shared', payload: { sourceIdentifier: externalIdOf('c2'), contactIds: ['c1', 'c2'] } }))
  })

  it('after a claim lost to another writer, deletes the Company it created and updates the winner', async () => {
    storeCompany({ entityId: 'e-winner', displayName: 'Acme Ltd' })
    mockClaim.mockImplementationOnce(async () => {
      mappings.set(externalIdOf('c1'), 'e-winner')
      return { outcome: 'lost', winnerEntityId: 'e-winner', winnerDeleted: false }
    })

    const [item] = await writePage(createWriter(), [record('c1')])

    expect(commands.map((command) => command.id)).toEqual(['customers.companies.create', 'customers.companies.delete', 'customers.companies.update'])
    expect(commands[1].input).toEqual({ id: 'e-2' })
    expect(companies.has('e-2')).toBe(false)
    expect(item).toMatchObject({ action: 'update', data: { localId: 'e-winner' } })
  })

  it('logs a refused cleanup and keeps going when the created Company already has dependents', async () => {
    storeCompany({ entityId: 'e-winner', displayName: 'Acme Ltd' })
    refuseDelete = true
    mockClaim.mockImplementationOnce(async () => ({ outcome: 'lost', winnerEntityId: 'e-winner', winnerDeleted: false }))

    const [item] = await writePage(createWriter(), [record('c1')])

    expect(item).toMatchObject({ action: 'update', data: { localId: 'e-winner' } })
    expect(logWrites).toContainEqual(expect.objectContaining({ code: 'xero.company_claim_cleanup_refused', payload: { sourceIdentifier: externalIdOf('c1'), entityIds: ['e-2'] } }))
  })

  it('drops a candidate another Contact claimed meanwhile and matches again', async () => {
    storeCompany({ entityId: 'e-tax', custom: { xero_tax_number: 'GB 123' } })
    mockClaim.mockImplementationOnce(async () => ({ outcome: 'lost', winnerEntityId: null }))

    const [item] = await writePage(createWriter(), [record('c1', { TaxNumber: 'GB123' })])

    expect(mockClaim.mock.calls.map(([input]) => (input as ClaimCompanyMappingInput).candidateEntityId)).toEqual(['e-tax', 'e-2'])
    expect(item).toMatchObject({ action: 'create', data: { localId: 'e-2' } })
  })

  it('keeps a created Company that another Contact mapped meanwhile, and creates a new one', async () => {
    mockClaim.mockImplementationOnce(async () => ({ outcome: 'lost', winnerEntityId: null }))

    const [item] = await writePage(createWriter(), [record('c1')])

    const creates = commands.filter((command) => command.id === 'customers.companies.create')
    expect(creates).toHaveLength(2)
    expect(commands.some((command) => command.id === 'customers.companies.delete')).toBe(false)
    expect(companies.has('e-1')).toBe(true)
    expect(item).toMatchObject({ action: 'create', data: { localId: 'e-3' } })
    expect(mappings.get(externalIdOf('c1'))).toBe('e-3')
  })

  it('fails a Contact without a name or one the customers validators reject, and rethrows other errors', async () => {
    const writer = createWriter()
    const [nameless] = await writePage(writer, [record('c1', { Name: ' ' })])
    expect(nameless).toEqual({
      externalId: externalIdOf('c1'),
      action: 'failed',
      data: { errorCode: 'xero.contact_invalid', errorMessage: expect.any(String), sourceIdentifier: externalIdOf('c1') },
    })

    failNextCommand = new CrudHttpError(400, { error: 'Invalid input' })
    const [rejected] = await writePage(writer, [record('c2')])
    expect(rejected).toMatchObject({ action: 'failed', data: { errorCode: 'xero.contact_invalid' } })

    failNextCommand = new Error('connection terminated')
    await expect(writePage(writer, [record('c3')])).rejects.toThrow('connection terminated')
  })

  it('refuses a mapped Contact whose Company is deleted between the page preload and the update', async () => {
    storeCompany({ entityId: 'e-mapped', displayName: 'Acme Ltd', legalName: 'Acme Ltd', primaryEmail: 'old@acme.example', custom: { xero_contact_id: externalIdOf('c1') } })
    mappings.set(externalIdOf('c1'), 'e-mapped')
    failNextCommand = new CrudHttpError(404, { error: 'Not found' })

    const [item] = await writePage(createWriter(), [record('c1')])

    expect(item).toMatchObject({ action: 'skip', data: { localId: 'e-mapped', errorCode: 'xero.company_deleted_in_om' } })
    expect(logWrites).toEqual([expect.objectContaining({ level: 'warn', code: 'xero.company_deleted_in_om', payload: { sourceIdentifier: externalIdOf('c1'), entityIds: ['e-mapped'] } })])
  })

  it.each([403, 409])('rethrows a %i from a customers command so the run fails and resumes from the cursor', async (status) => {
    failNextCommand = new CrudHttpError(status, { error: 'Refused' })
    await expect(writePage(createWriter(), [record('c1')])).rejects.toMatchObject({ status })
  })

  it('loads the mapped Companies of a page once, whatever the page size', async () => {
    const records = Array.from({ length: 250 }, (_, index) => record(`c${index + 1}`))
    for (const entry of records) {
      const entityId = `e-${entry.ContactID}`
      storeCompany({ entityId, displayName: 'Acme Ltd', legalName: 'Acme Ltd', primaryEmail: 'billing@acme.example', primaryPhone: '+44 20 7946 0000', custom: { xero_contact_id: externalIdOf(entry.ContactID) } })
      mappings.set(externalIdOf(entry.ContactID), entityId)
    }

    const items = await writePage(createWriter(), records)

    expect(mockLoadSnapshots).toHaveBeenCalledTimes(1)
    expect((mockLoadSnapshots.mock.calls[0] as unknown[])[2]).toHaveLength(250)
    expect(items.every((item) => item.action === 'skip')).toBe(true)
    expect(indexLoads).toBe(0)
  })

  it('marks the Company of a merged-away Contact with the survivor, writes nothing else and names both Companies', async () => {
    storeCompany({ entityId: 'e-losing', displayName: 'Old name', custom: { xero_contact_id: externalIdOf('c-losing') } })
    storeCompany({ entityId: 'e-survivor', displayName: 'Acme Ltd', custom: { xero_contact_id: externalIdOf('c-survivor') } })
    mappings.set(externalIdOf('c-losing'), 'e-losing')
    mappings.set(externalIdOf('c-survivor'), 'e-survivor')
    const writer = createWriter()
    const merged = record('c-losing', { ContactStatus: 'ARCHIVED', MergedToContactID: 'c-survivor' })

    const [item] = await writePage(writer, [merged])

    expect(commands).toEqual([
      {
        id: 'customers.companies.update',
        input: { id: 'e-losing', organizationId: scope.organizationId, tenantId: scope.tenantId, customFields: { xero_merged_into: 'c-survivor' } },
      },
    ])
    expect(companies.get('e-losing')).toMatchObject({ displayName: 'Old name', status: 'active' })
    expect(item).toMatchObject({ action: 'skip', data: { localId: 'e-losing', errorCode: 'xero.contact_merged' } })
    expect(logWrites).toEqual([
      expect.objectContaining({
        code: 'xero.contact_merged',
        payload: { sourceIdentifier: externalIdOf('c-losing'), entityIds: ['e-losing', 'e-survivor'], contactIds: ['c-losing', 'c-survivor'] },
      }),
    ])

    commands = []
    await writePage(writer, [merged])
    expect(commands).toEqual([])
  })

  it('only flips the status of a GDPR-redacted Contact and keeps the Company\'s data', async () => {
    storeCompany({ entityId: 'e-mapped', displayName: 'Jane Doe Consulting', primaryEmail: 'jane@example.com', custom: { xero_contact_id: externalIdOf('c1') } })
    mappings.set(externalIdOf('c1'), 'e-mapped')
    const writer = createWriter()

    const [item] = await writePage(writer, [record('c1', { ContactStatus: 'GDPRREQUEST', Name: '', EmailAddress: '' })])

    expect(commands).toEqual([
      { id: 'customers.companies.update', input: { id: 'e-mapped', organizationId: scope.organizationId, tenantId: scope.tenantId, status: 'archived', isActive: false } },
    ])
    expect(companies.get('e-mapped')).toMatchObject({ displayName: 'Jane Doe Consulting', primaryEmail: 'jane@example.com', status: 'archived' })
    expect(item).toMatchObject({ action: 'update', data: { localId: 'e-mapped' } })
  })

  it('archives the mapped Company of an archived Contact and brings it back when the Contact is restored', async () => {
    storeCompany({ entityId: 'e-mapped', displayName: 'Acme Ltd', legalName: 'Acme Ltd', primaryEmail: 'billing@acme.example', primaryPhone: '+44 20 7946 0000', custom: { xero_contact_id: externalIdOf('c1') } })
    mappings.set(externalIdOf('c1'), 'e-mapped')
    const writer = createWriter()

    await writePage(writer, [record('c1', { ContactStatus: 'ARCHIVED' })])
    expect(commands.at(-1)?.input).toMatchObject({ status: 'archived', isActive: false })
    await writePage(writer, [record('c1', { ContactStatus: 'ACTIVE' })])
    expect(commands.at(-1)?.input).toMatchObject({ status: 'active', isActive: true })
  })

  it('creates no Company and writes no log row for an unmapped archived, GDPR-redacted or supplier-only Contact', async () => {
    const items = await writePage(createWriter(), [
      record('c1', { ContactStatus: 'ARCHIVED' }),
      record('c2', { ContactStatus: 'GDPRREQUEST' }),
      record('c3', { IsSupplier: true, IsCustomer: false }),
    ])

    expect(items.map((entry) => entry.action)).toEqual(['skip', 'skip', 'skip'])
    expect(commands).toEqual([])
    expect(logWrites).toEqual([])
    expect(indexLoads).toBe(0)
  })

  it('reports orphaned marked Companies after a full pass, skipping those created within the last minute, and never fails', async () => {
    storeCompany({ entityId: 'e-orphan', custom: { xero_contact_id: externalIdOf('c1') } })
    storeCompany({ entityId: 'e-mapped', custom: { xero_contact_id: externalIdOf('c2') } })
    mappings.set(externalIdOf('c2'), 'e-mapped')
    const writer = createWriter()

    await writer.reportOrphans(new Date(sequence + 60_000))
    expect(logWrites).toEqual([
      expect.objectContaining({ level: 'warn', code: 'xero.company_orphaned', payload: { sourceIdentifier: externalIdOf('c1'), entityIds: ['e-orphan'] } }),
    ])

    logWrites = []
    await writer.reportOrphans(new Date(sequence))
    expect(logWrites).toEqual([])

    mockLoadIndexSources.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(writer.reportOrphans()).resolves.toBeUndefined()
    expect(commands).toEqual([])
  })

  describe('Xero-owned addresses', () => {
    const street = { AddressType: 'STREET', AddressLine1: '1 High Street', City: 'London', PostalCode: 'SW1A 1AA', Country: 'United Kingdom' }
    const pobox = { AddressType: 'POBOX', AddressLine1: 'PO Box 12', Country: 'Narnia' }

    function mappedCompany(contactId: string): string {
      const entityId = `e-${contactId}`
      storeCompany({ entityId, displayName: 'Acme Ltd', legalName: 'Acme Ltd', primaryEmail: 'billing@acme.example', primaryPhone: '+44 20 7946 0000', custom: { xero_contact_id: externalIdOf(contactId) } })
      mappings.set(externalIdOf(contactId), entityId)
      return entityId
    }

    it('creates and maps one non-primary row per Xero address type, converting the country', async () => {
      const [item] = await writePage(createWriter(), [record('c1', { Addresses: [street, pobox] })])

      const addressCommands = commands.filter((command) => command.id === 'customers.addresses.create')
      expect(addressCommands.map((command) => command.input)).toEqual([
        { organizationId: scope.organizationId, tenantId: scope.tenantId, entityId: 'e-1', purpose: 'billing', isPrimary: false, addressLine1: 'PO Box 12', country: 'Narnia' },
        { organizationId: scope.organizationId, tenantId: scope.tenantId, entityId: 'e-1', purpose: 'office', isPrimary: false, addressLine1: '1 High Street', city: 'London', postalCode: 'SW1A 1AA', country: 'GB' },
      ])
      expect(addressMappings).toEqual(new Map([[`${externalIdOf('c1')}:POBOX`, 'a-3'], [`${externalIdOf('c1')}:STREET`, 'a-4']]))
      expect(item).toMatchObject({ action: 'create', data: { localId: 'e-1' } })
      expect(logWrites).toEqual([
        expect.objectContaining({ code: 'xero.address_country_unrecognised', payload: { sourceIdentifier: `${externalIdOf('c1')}:POBOX`, entityIds: ['e-1'], field: 'country' } }),
      ])
    })

    it('removes a created address again when its mapping cannot be stored, so a resumed run does not duplicate it', async () => {
      const entityId = mappedCompany('c1')
      const failure = new Error('connection reset')
      mockStoreMapping.mockRejectedValueOnce(failure)

      await expect(writePage(createWriter(), [record('c1', { Addresses: [street] })])).rejects.toBe(failure)

      const [created] = commands.filter((command) => command.id === 'customers.addresses.create')
      expect(created.input).toMatchObject({ entityId, purpose: 'office' })
      expect(commands.at(-1)).toEqual({ id: 'customers.addresses.delete', input: { id: expect.stringMatching(/^a-/) } })
      expect(addresses.size).toBe(0)
      expect(addressMappings.size).toBe(0)
    })

    it('updates a mapped row only where a Xero value differs and reports the item as updated', async () => {
      const entityId = mappedCompany('c1')
      addresses.set('a-street', { id: 'a-street', entityId, addressLine1: '1 High Street', city: 'Leeds', postalCode: 'SW1A 1AA', country: 'GB', isPrimary: true })
      addressMappings.set(`${externalIdOf('c1')}:STREET`, 'a-street')

      const [item] = await writePage(createWriter(), [record('c1', { Addresses: [street] })])

      expect(commands).toEqual([
        { id: 'customers.addresses.update', input: { id: 'a-street', organizationId: scope.organizationId, tenantId: scope.tenantId, city: 'London' } },
      ])
      expect(addresses.get('a-street')).toMatchObject({ city: 'London', isPrimary: true })
      expect(item).toMatchObject({ action: 'update', data: { localId: entityId } })

      commands = []
      const [unchanged] = await writePage(createWriter(), [record('c1', { Addresses: [street] })])
      expect(commands).toEqual([])
      expect(unchanged.action).toBe('skip')
    })

    it('re-creates a row a user moved to another customer and never touches the user\'s own rows', async () => {
      const entityId = mappedCompany('c1')
      addresses.set('a-moved', { id: 'a-moved', entityId: 'e-someone-else', addressLine1: 'Old line' })
      addresses.set('a-user', { id: 'a-user', entityId, addressLine1: 'User line', isPrimary: true })
      addressMappings.set(`${externalIdOf('c1')}:STREET`, 'a-moved')

      await writePage(createWriter(), [record('c1', { Addresses: [street] })])

      expect(commands.map((command) => [command.id, command.input.id ?? command.input.entityId])).toEqual([['customers.addresses.create', entityId]])
      expect(addressMappings.get(`${externalIdOf('c1')}:STREET`)).not.toBe('a-moved')
      expect(addresses.get('a-moved')).toEqual({ id: 'a-moved', entityId: 'e-someone-else', addressLine1: 'Old line' })
      expect(addresses.get('a-user')).toEqual({ id: 'a-user', entityId, addressLine1: 'User line', isPrimary: true })
      expect(commands.some((command) => 'isPrimary' in command.input && command.input.isPrimary === true)).toBe(false)
    })

    it('writes no address for a GDPR-redacted or merged-away Contact', async () => {
      mappedCompany('c1')
      mappedCompany('c2')

      await writePage(createWriter(), [
        record('c1', { ContactStatus: 'GDPRREQUEST', Addresses: [street] }),
        record('c2', { MergedToContactID: 'c9', Addresses: [street] }),
      ])

      expect(commands.some((command) => command.id.startsWith('customers.addresses.'))).toBe(false)
    })
  })
})
