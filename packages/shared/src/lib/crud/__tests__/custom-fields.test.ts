import { buildCustomFieldFiltersFromQuery, extractAllCustomFieldEntries, splitCustomFieldPayload, loadCustomFieldValues } from '../custom-fields'
import { encryptWithAesGcm } from '../../encryption/aes'

const mockEntityManager = (defs: any[]) => ({
  find: jest.fn().mockResolvedValue(defs),
})

describe('buildCustomFieldFiltersFromQuery', () => {
  const definitions = [
    {
      id: 'def-fashion-color',
      key: 'color',
      kind: 'text',
      entityId: 'catalog:product',
      configJson: { fieldset: 'fashion' },
    },
    {
      id: 'def-shared-material',
      key: 'material',
      kind: 'text',
      entityId: 'catalog:product',
      configJson: {},
    },
  ]

  it('generates filters for matching definitions regardless of fieldset when none specified', async () => {
    const em = mockEntityManager(definitions)
    const filters = await buildCustomFieldFiltersFromQuery({
      entityIds: ['catalog:product'],
      query: { cf_color: 'blue' },
      em: em as any,
      tenantId: 'tenant-1',
    })
    expect(em.find).toHaveBeenCalled()
    expect(filters).toEqual({ 'cf:color': 'blue' })
  })

  it('restricts filters to the requested fieldset code', async () => {
    const em = mockEntityManager(definitions)
    const filters = await buildCustomFieldFiltersFromQuery({
      entityIds: ['catalog:product'],
      query: { cf_color: 'blue' },
      em: em as any,
      tenantId: 'tenant-1',
      fieldset: 'fashion',
    })
    expect(filters).toEqual({ 'cf:color': 'blue' })
    const emptyFilters = await buildCustomFieldFiltersFromQuery({
      entityIds: ['catalog:product'],
      query: { cf_color: 'blue', cf_material: 'cotton' },
      em: em as any,
      tenantId: 'tenant-1',
      fieldset: 'tech',
    })
    expect(emptyFilters).toEqual({})
  })
})

describe('splitCustomFieldPayload', () => {
  it('pulls values from customValues map', () => {
    const raw = {
      name: 'Channel',
      customValues: {
        api_url: 'https://example.dev',
        priority: 5,
      },
    }
    expect(splitCustomFieldPayload(raw)).toEqual({
      base: { name: 'Channel' },
      custom: { api_url: 'https://example.dev', priority: 5 },
    })
  })

  it('maps array based customFields entries', () => {
    const raw = {
      customFields: [
        { key: 'api_url', value: 'https://example.dev' },
        { key: '', value: 'ignored' },
        { key: 'notes', value: null },
      ],
      code: 'demo',
    }
    expect(splitCustomFieldPayload(raw)).toEqual({
      base: { code: 'demo' },
      custom: {
        api_url: 'https://example.dev',
        notes: null,
      },
    })
  })
})

describe('extractAllCustomFieldEntries', () => {
  it('merges entries from customValues maps and customFields objects', () => {
    const item = {
      customValues: { api_url: 'https://fws1.api', priority: 5 },
      customFields: { notes: 'memo' },
      other: 'value',
    }
    expect(extractAllCustomFieldEntries(item)).toEqual({
      cf_api_url: 'https://fws1.api',
      cf_priority: 5,
      cf_notes: 'memo',
    })
  })

  it('reads entries from customFields arrays and keeps existing cf_* keys', () => {
    const item = {
      customFields: [
        { key: 'api_url', value: 'https://onet.pl' },
        { key: '', value: 'skip-me' },
        { key: 'notes' },
      ],
      cf_existing: 'foo',
    }
    expect(extractAllCustomFieldEntries(item)).toEqual({
      cf_api_url: 'https://onet.pl',
      cf_notes: undefined,
      cf_existing: 'foo',
    })
  })
})

describe('loadCustomFieldValues (encryption)', () => {
  it('decrypts encrypted custom field payloads when definitions mark them encrypted', async () => {
    const dek = Buffer.alloc(32, 2).toString('base64')
    const encrypted = encryptWithAesGcm(JSON.stringify('secret-note'), dek).value
    const em = {
      find: jest.fn().mockImplementation((_, where) => {
        if ((where as any).recordId) {
          return Promise.resolve([
            { recordId: 'rec-1', fieldKey: 'note', organizationId: null, tenantId: 'tenant-1', valueText: encrypted, valueMultiline: null, valueInt: null, valueFloat: null, valueBool: null, deletedAt: null },
          ])
        }
        return Promise.resolve([
          { key: 'note', entityId: 'demo:entity', organizationId: null, tenantId: 'tenant-1', kind: 'text', configJson: { encrypted: true }, isActive: true },
        ])
      }),
    }
    const mockService = { isEnabled: () => true, getDek: async () => ({ key: dek }) }
    const values = await loadCustomFieldValues({
      em: em as any,
      entityId: 'demo:entity',
      recordIds: ['rec-1'],
      tenantIdByRecord: { 'rec-1': 'tenant-1' },
      encryptionService: mockService as any,
    })
    expect(values['rec-1'].cf_note).toBe('secret-note')
  })
})
