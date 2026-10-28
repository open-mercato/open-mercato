import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import {
  EncryptionMapVersionConflictError,
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
    const rawConnectionExecute = jest.fn()
    const em = {
      execute,
      getConnection: () => ({ execute: rawConnectionExecute }),
    } as never

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
    expect(rawConnectionExecute).not.toHaveBeenCalled()
  })
})

describe('upsertCanonicalEncryptionMap optimistic version', () => {
  const expected = new Date('2026-10-04T12:00:00.123Z')

  it('makes the conflict update conditional on the expected version', async () => {
    const execute = jest.fn(async (_sql: string, _params: readonly unknown[]) => [
      { id: 'canonical-id', updated_at: '2026-10-04T12:05:00.000Z' },
    ])

    const saved = await upsertCanonicalEncryptionMap({ execute } as never, {
      entityId: 'customers:person',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      fields: [{ field: 'email' }],
      isActive: true,
      expectedUpdatedAt: expected,
    })

    expect(saved).toEqual({ id: 'canonical-id', updatedAt: new Date('2026-10-04T12:05:00.000Z') })
    const [sql, params] = execute.mock.calls[0]
    expect(sql).toMatch(/do update set[\s\S]*where date_trunc\('milliseconds', "encryption_maps"\."updated_at"\) = date_trunc\('milliseconds', \?::timestamptz\)[\s\S]*returning/)
    expect(params).toEqual(['customers:person', 'tenant-1', 'org-1', '[{"field":"email"}]', true, expected.toISOString()])
  })

  it('keeps the unconditional upsert when no version is expected', async () => {
    const execute = jest.fn(async (_sql: string, _params: readonly unknown[]) => [
      { id: 'canonical-id', updated_at: new Date('2026-10-04T12:05:00.000Z') },
    ])

    await upsertCanonicalEncryptionMap({ execute } as never, {
      entityId: 'customers:person',
      tenantId: 'tenant-1',
      organizationId: null,
      fields: [],
      isActive: true,
    })

    const [sql, params] = execute.mock.calls[0]
    expect(sql).not.toContain('date_trunc')
    expect(params).toHaveLength(5)
  })

  it('throws a version conflict carrying the current version when the row moved', async () => {
    const current = new Date('2026-10-04T12:01:00.000Z')
    const execute = jest.fn(async (sql: string, _params: readonly unknown[]) => (
      sql.includes('insert into') ? [] : [{ updated_at: current }]
    ))

    const write = upsertCanonicalEncryptionMap({ execute } as never, {
      entityId: 'customers:person',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      fields: [{ field: 'email' }],
      isActive: true,
      expectedUpdatedAt: expected,
    })

    await expect(write).rejects.toBeInstanceOf(EncryptionMapVersionConflictError)
    await expect(write).rejects.toMatchObject({ expectedUpdatedAt: expected, currentUpdatedAt: current })
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls[1][1]).toEqual(['customers:person', 'tenant-1', 'org-1'])
  })

  it('drops the policy memo of the writing EntityManager', async () => {
    const previous = process.env.TENANT_DATA_ENCRYPTION
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    try {
      let fields = [{ field: 'email' }]
      const execute = jest.fn(async (sql: string, _params: readonly unknown[]) => (
        sql.includes('insert into')
          ? [{ id: 'canonical-id', updated_at: new Date('2026-10-04T12:05:00.000Z') }]
          : [{ entity_id: 'customers:person', tenant_id: 'tenant-1', organization_id: 'org-1', fields_json: fields }]
      ))
      const em = { execute }
      const service = new TenantDataEncryptionService(em as never)
      jest.spyOn(service, 'isEnabled').mockReturnValue(true)

      await expect(service.getEncryptedFieldNames('customers:person', 'tenant-1', 'org-1', { em: em as never }))
        .resolves.toEqual(['email'])
      fields = [{ field: 'email' }, { field: 'phone' }]
      await upsertCanonicalEncryptionMap(em as never, {
        entityId: 'customers:person',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        fields,
        isActive: true,
      })

      await expect(service.getEncryptedFieldNames('customers:person', 'tenant-1', 'org-1', { em: em as never }))
        .resolves.toEqual(['email', 'phone'])
    } finally {
      if (previous === undefined) delete process.env.TENANT_DATA_ENCRYPTION
      else process.env.TENANT_DATA_ENCRYPTION = previous
    }
  })
})
