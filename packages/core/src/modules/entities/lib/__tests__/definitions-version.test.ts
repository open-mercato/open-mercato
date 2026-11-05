/** @jest-environment node */
import { resolveEntityDefinitionsVersion } from '../definitions-version'

jest.mock('@open-mercato/core/modules/entities/data/entities', () => ({
  CustomFieldDef: 'CustomFieldDef',
  CustomFieldEntityConfig: 'CustomFieldEntityConfig',
}))

type FindOneResult = { updatedAt: Date | string } | null

function makeEm(byEntity: Record<string, FindOneResult>) {
  const findOne = jest.fn(async (entity: unknown) => byEntity[entity as string] ?? null)
  return { em: { findOne } as any, findOne }
}

const scope = { entityId: 'test:entity', tenantId: 'tenant-1', organizationId: 'org-1' }

describe('resolveEntityDefinitionsVersion (issue #3152)', () => {
  it('returns the newest updatedAt across definitions and config', async () => {
    const { em } = makeEm({
      CustomFieldDef: { updatedAt: new Date('2026-06-01T00:00:00.000Z') },
      CustomFieldEntityConfig: { updatedAt: new Date('2026-05-01T00:00:00.000Z') },
    })

    const version = await resolveEntityDefinitionsVersion(em, scope)

    expect(version).toBe('2026-06-01T00:00:00.000Z')
  })

  it('falls back to config when it is the only versioned row', async () => {
    const { em } = makeEm({
      CustomFieldDef: null,
      CustomFieldEntityConfig: { updatedAt: new Date('2026-05-01T00:00:00.000Z') },
    })

    const version = await resolveEntityDefinitionsVersion(em, scope)

    expect(version).toBe('2026-05-01T00:00:00.000Z')
  })

  it('returns null when the schema has no definitions or config', async () => {
    const { em } = makeEm({ CustomFieldDef: null, CustomFieldEntityConfig: null })

    const version = await resolveEntityDefinitionsVersion(em, scope)

    expect(version).toBeNull()
  })

  it('scopes the query to the entity and the visible tenant/org union', async () => {
    const { em, findOne } = makeEm({
      CustomFieldDef: { updatedAt: new Date('2026-06-01T00:00:00.000Z') },
      CustomFieldEntityConfig: null,
    })

    await resolveEntityDefinitionsVersion(em, scope)

    const where = findOne.mock.calls[0][1] as Record<string, unknown>
    expect(where.entityId).toBe('test:entity')
    expect(where.$and).toEqual([
      { $or: [{ organizationId: 'org-1' }, { organizationId: null }] },
      { $or: [{ tenantId: 'tenant-1' }, { tenantId: null }] },
    ])
    // Only the timestamp column is projected so no other data materializes.
    const options = findOne.mock.calls[0][2] as Record<string, unknown>
    expect(options.fields).toEqual(['updatedAt'])
    expect(options.orderBy).toEqual({ updatedAt: 'desc' })
  })
})
