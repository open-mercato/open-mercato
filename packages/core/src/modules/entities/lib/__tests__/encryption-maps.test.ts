import {
  mergeEncryptionMapFields,
  resolveCanonicalEncryptionMap,
  upsertCanonicalEncryptionMap,
} from '../encryption-maps'

function mapRecord(input: {
  id: string
  createdAt: string
  fields: Array<{ field: string; hashField?: string | null }>
  isActive?: boolean
}) {
  return {
    id: input.id,
    entityId: 'customers:person',
    tenantId: 'tenant-1',
    organizationId: null,
    fieldsJson: input.fields,
    isActive: input.isActive ?? true,
    createdAt: new Date(input.createdAt),
    updatedAt: new Date(input.createdAt),
    deletedAt: null,
  }
}

describe('encryption map canonicalization', () => {
  it('keeps the oldest row canonical and unions active fields without arbitrary hash precedence', () => {
    const newer = mapRecord({
      id: 'b',
      createdAt: '2026-01-02T00:00:00.000Z',
      fields: [
        { field: 'email', hashField: 'newer_email_hash' },
        { field: 'phone' },
      ],
    })
    const oldest = mapRecord({
      id: 'a',
      createdAt: '2026-01-01T00:00:00.000Z',
      fields: [
        { field: 'email' },
        { field: 'display_name', hashField: 'display_name_hash' },
      ],
    })

    const canonical = resolveCanonicalEncryptionMap([newer, oldest])

    expect(canonical?.id).toBe('a')
    expect(canonical?.fieldsJson).toEqual([
      { field: 'email', hashField: 'newer_email_hash' },
      { field: 'display_name', hashField: 'display_name_hash' },
      { field: 'phone', hashField: null },
    ])
  })

  it('ignores inactive duplicate declarations when any active row exists', () => {
    const fields = mergeEncryptionMapFields([
      mapRecord({ id: 'a', createdAt: '2026-01-01T00:00:00.000Z', fields: [{ field: 'active' }] }),
    ])
    const canonical = resolveCanonicalEncryptionMap([
      mapRecord({ id: 'a', createdAt: '2026-01-01T00:00:00.000Z', fields }),
      mapRecord({
        id: 'b',
        createdAt: '2026-01-02T00:00:00.000Z',
        fields: [{ field: 'inactive_only' }],
        isActive: false,
      }),
    ])

    expect(canonical?.isActive).toBe(true)
    expect(canonical?.fieldsJson).toEqual([{ field: 'active', hashField: null }])
  })
})

describe('upsertCanonicalEncryptionMap concurrency', () => {
  it('uses one conflict-safe statement so overlapping nullable-scope seeders leave one active row', async () => {
    const rows = new Map<string, { id: string; updated_at: Date; fields: string; active: boolean }>()
    const statements: string[] = []
    let arrivals = 0
    let release: (() => void) | null = null
    const bothArrived = new Promise<void>((resolve) => {
      release = resolve
    })
    const execute = jest.fn(async (sql: string, params: readonly unknown[]) => {
      statements.push(sql)
      arrivals += 1
      if (arrivals === 2) release?.()
      await bothArrived
      const key = `${String(params[0])}:${String(params[1])}:${String(params[2])}`
      const existing = rows.get(key)
      const saved = existing ?? {
        id: 'canonical-id',
        updated_at: new Date('2026-10-04T12:00:00.000Z'),
        fields: String(params[3]),
        active: Boolean(params[4]),
      }
      saved.fields = String(params[3])
      saved.active = Boolean(params[4])
      rows.set(key, saved)
      return [{ id: saved.id, updated_at: saved.updated_at }]
    })
    const em = { getConnection: () => ({ execute }) } as never

    await Promise.all([
      upsertCanonicalEncryptionMap(em, {
        entityId: 'customers:person',
        tenantId: 'tenant-1',
        organizationId: null,
        fields: [{ field: 'email' }],
        isActive: true,
      }),
      upsertCanonicalEncryptionMap(em, {
        entityId: 'customers:person',
        tenantId: 'tenant-1',
        organizationId: null,
        fields: [{ field: 'phone' }],
        isActive: true,
      }),
    ])

    expect(rows.size).toBe(1)
    expect([...rows.values()]).toEqual([
      expect.objectContaining({ id: 'canonical-id', active: true }),
    ])
    expect(statements).toHaveLength(2)
    for (const sql of statements) {
      expect(sql).toContain('on conflict ("entity_id", "tenant_id", "organization_id")')
      expect(sql).toContain('where "deleted_at" is null')
      expect(sql).toContain('do update set')
    }
    expect(execute.mock.calls.every(([, params]) => params[2] === null)).toBe(true)
  })
})
