import { loadCustomFieldValues } from '../custom-fields'
import { encryptWithAesGcm } from '../../encryption/aes'

type Row = Record<string, unknown>

function matchesCondition(columnValue: unknown, condition: unknown): boolean {
  if (condition && typeof condition === 'object' && !Array.isArray(condition) && '$in' in (condition as Row)) {
    const candidates = (condition as { $in: unknown[] }).$in
    if (columnValue === null) return false
    return candidates.some((candidate) => candidate !== null && candidate === columnValue)
  }
  return columnValue === (condition ?? null)
}

function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === '$and') return (condition as Row[]).every((sub) => matchesWhere(row, sub))
    if (key === '$or') return (condition as Row[]).some((sub) => matchesWhere(row, sub))
    return matchesCondition(row[key] ?? null, condition)
  })
}

function createSqlLikeEm(tables: { definitions: Row[]; values: Row[] }) {
  return {
    find: jest.fn(async (_entity: unknown, where: Row) => {
      const table = 'recordId' in where ? tables.values : tables.definitions
      return table.filter((row) => matchesWhere(row, where))
    }),
  }
}

function definitionRow(overrides: Row): Row {
  return {
    entityId: 'example:todo',
    key: 'labels',
    kind: 'text',
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    configJson: {},
    isActive: true,
    deletedAt: null,
    ...overrides,
  }
}

function valueRow(overrides: Row): Row {
  return {
    entityId: 'example:todo',
    recordId: 'todo-1',
    fieldKey: 'labels',
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    valueText: null,
    valueMultiline: null,
    valueInt: null,
    valueFloat: null,
    valueBool: null,
    deletedAt: null,
    ...overrides,
  }
}

describe('loadCustomFieldValues with organization-wide definitions (#6029)', () => {
  const scope = {
    entityId: 'example:todo',
    recordIds: ['todo-1'],
    tenantIdByRecord: { 'todo-1': 'tenant-1' },
    organizationIdByRecord: { 'todo-1': 'org-1' },
  }

  it('applies the multi flag of an organization-specific definition', async () => {
    const em = createSqlLikeEm({
      definitions: [definitionRow({ organizationId: 'org-1', configJson: { multi: true } })],
      values: [valueRow({ valueText: 'ops' })],
    })

    const values = await loadCustomFieldValues({ em: em as any, ...scope })

    expect(values['todo-1'].cf_labels).toEqual(['ops'])
  })

  it('applies the multi flag of a definition with organization_id NULL', async () => {
    const em = createSqlLikeEm({
      definitions: [definitionRow({ organizationId: null, configJson: { multi: true } })],
      values: [valueRow({ valueText: 'ops' })],
    })

    const values = await loadCustomFieldValues({ em: em as any, ...scope })

    expect(values['todo-1'].cf_labels).toEqual(['ops'])
  })

  it('decrypts values of an encrypted definition with organization_id NULL', async () => {
    const dek = Buffer.alloc(32, 3).toString('base64')
    const em = createSqlLikeEm({
      definitions: [definitionRow({ key: 'note', organizationId: null, configJson: { encrypted: true } })],
      values: [valueRow({ fieldKey: 'note', valueText: encryptWithAesGcm('secret-note', dek).value })],
    })
    const encryptionService = { isEnabled: () => true, getDek: async () => ({ key: dek }) }

    const values = await loadCustomFieldValues({ em: em as any, ...scope, encryptionService: encryptionService as any })

    expect(values['todo-1'].cf_note).toBe('secret-note')
  })
})
