import type { EntityManager } from '@mikro-orm/postgresql'
import type { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import {
  ensureXeroFieldDefinitions,
  ensureXeroFieldDefinitionsAfterSave,
  XERO_COMPANY_FIELD_DEFINITIONS,
  XERO_COMPANY_FIELDS_ENTITY_ID,
} from '../lib/field-definitions'
import { createFakeContainer } from './support/fakeContainer'

const mockReportError = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }

type StoredDefinition = Pick<CustomFieldDef, 'entityId' | 'organizationId' | 'tenantId' | 'key' | 'kind' | 'isActive'> & {
  configJson: Record<string, unknown>
  deletedAt?: Date | null
}

type InCondition = { $in: unknown[] }

function matches(value: unknown, condition: unknown): boolean {
  if (condition && typeof condition === 'object' && '$in' in condition) return (condition as InCondition).$in.includes(value)
  return value === condition
}

/** An EntityManager double holding `CustomFieldDef` rows: enough for the core's `ensureCustomFieldDefinitions`. */
function createDefinitionStore() {
  const rows: StoredDefinition[] = []
  let flushes = 0
  const em = {
    async find(_entity: unknown, where: Record<string, unknown>) {
      return rows.filter((row) => Object.entries(where).every(([key, condition]) => matches(row[key as keyof StoredDefinition], condition)))
    },
    create(_entity: unknown, data: StoredDefinition) {
      return { ...data }
    },
    persist(row: StoredDefinition) {
      if (!rows.includes(row)) rows.push(row)
    },
    async flush() {
      flushes += 1
    },
    fork() {
      return em
    },
  }
  return { rows, em: em as unknown as EntityManager, flushes: () => flushes }
}

type DefinitionsCache = Parameters<typeof ensureXeroFieldDefinitions>[0]['cache']

function createCache() {
  const deleteByTags = jest.fn(async (_tags: string[]) => undefined)
  return { deleteByTags, cache: { deleteByTags } as unknown as DefinitionsCache }
}

beforeEach(() => {
  mockReportError.mockReset()
})

describe('XERO_COMPANY_FIELD_DEFINITIONS', () => {
  it('declares the marker, the encrypted tax number and the merged-into field on the company profile', () => {
    const byKey = new Map(XERO_COMPANY_FIELD_DEFINITIONS.map((field) => [field.key, field]))
    expect([...byKey.keys()]).toEqual(['xero_contact_id', 'xero_tax_number', 'xero_merged_into'])
    expect(byKey.get('xero_contact_id')).toMatchObject({ kind: 'text', formEditable: false, filterable: false, listVisible: false })
    expect(byKey.get('xero_tax_number')).toMatchObject({ kind: 'text', encrypted: true, formEditable: true, filterable: false })
    expect(byKey.get('xero_merged_into')).toMatchObject({ kind: 'text', filterable: true, formEditable: false })
    expect(XERO_COMPANY_FIELDS_ENTITY_ID).toBe('customers:customer_company_profile')
  })
})

describe('ensureXeroFieldDefinitions', () => {
  it('creates the three definitions once and drops the form cache only when something changed', async () => {
    const store = createDefinitionStore()
    const { cache, deleteByTags } = createCache()

    const first = await ensureXeroFieldDefinitions({ em: store.em, cache, scope })
    expect(first).toEqual({ created: 3, updated: 0, unchanged: 0 })
    expect(store.rows.map((row) => [row.entityId, row.key, row.organizationId, row.tenantId])).toEqual([
      ['customers:customer_company_profile', 'xero_contact_id', scope.organizationId, scope.tenantId],
      ['customers:customer_company_profile', 'xero_tax_number', scope.organizationId, scope.tenantId],
      ['customers:customer_company_profile', 'xero_merged_into', scope.organizationId, scope.tenantId],
    ])
    expect(store.rows[1].configJson).toMatchObject({ encrypted: true, formEditable: true })
    expect(deleteByTags).toHaveBeenCalledTimes(1)
    expect(deleteByTags.mock.calls[0]?.[0].every((tag) => tag.includes('customers:customer_company_profile'))).toBe(true)

    const second = await ensureXeroFieldDefinitions({ em: store.em, cache, scope })
    expect(second).toEqual({ created: 0, updated: 0, unchanged: 3 })
    expect(store.rows).toHaveLength(3)
    expect(deleteByTags).toHaveBeenCalledTimes(1)
  })

  it('repairs a definition an admin changed or deactivated', async () => {
    const store = createDefinitionStore()
    const { cache, deleteByTags } = createCache()
    await ensureXeroFieldDefinitions({ em: store.em, cache, scope })
    const taxNumber = store.rows.find((row) => row.key === 'xero_tax_number')!
    taxNumber.configJson = { ...taxNumber.configJson, label: 'VAT' }
    store.rows.find((row) => row.key === 'xero_merged_into')!.isActive = false

    const result = await ensureXeroFieldDefinitions({ em: store.em, cache, scope })

    expect(result).toEqual({ created: 0, updated: 2, unchanged: 1 })
    expect(taxNumber.configJson).toMatchObject({ label: 'Tax number (Xero)', encrypted: true })
    expect(store.rows.find((row) => row.key === 'xero_merged_into')!.isActive).toBe(true)
    expect(deleteByTags).toHaveBeenCalledTimes(2)
  })

  it('works without a cache service', async () => {
    const store = createDefinitionStore()
    await expect(ensureXeroFieldDefinitions({ em: store.em, cache: undefined, scope })).resolves.toEqual({ created: 3, updated: 0, unchanged: 0 })
  })
})

describe('ensureXeroFieldDefinitionsAfterSave', () => {
  it('ensures the definitions on a forked EntityManager of the request container', async () => {
    const store = createDefinitionStore()
    const fork = jest.spyOn(store.em, 'fork')
    const container = createFakeContainer({ em: store.em, cache: createCache().cache })

    await expect(ensureXeroFieldDefinitionsAfterSave(container, scope)).resolves.toBe(true)

    expect(fork).toHaveBeenCalledTimes(1)
    expect(store.rows).toHaveLength(3)
  })

  it('reports a failure and never throws, so the Organisation save stands', async () => {
    const store = createDefinitionStore()
    jest.spyOn(store.em, 'flush').mockRejectedValueOnce(new Error('database unavailable'))
    const container = createFakeContainer({ em: store.em })

    await expect(ensureXeroFieldDefinitionsAfterSave(container, scope)).resolves.toBe(false)

    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), { module: 'sync_xero', code: 'sync_xero.field_definitions_failed' })
  })
})
