import { readFileSync } from 'node:fs'

const migrationCases = [
  {
    file: 'Migration20260419100521.ts',
    orgIndex: 'create unique index "ai_agent_prompt_overrides_tenant_org_agent_version_uq"',
    tenantIndex:
      'create unique index "ai_agent_prompt_overrides_tenant_agent_version_null_org_uq"',
  },
  {
    file: 'Migration20260419132948.ts',
    orgIndex:
      'create unique index "ai_agent_mutation_policy_overrides_tenant_org_agent_uq"',
    tenantIndex:
      'create unique index "ai_agent_mutation_policy_overrides_tenant_agent_null_org_uq"',
  },
  {
    file: 'Migration20260419134235.ts',
    orgIndex: 'create unique index "ai_pending_actions_tenant_org_idempotency_uq"',
    tenantIndex: 'create unique index "ai_pending_actions_tenant_idem_null_org_uq"',
  },
]

describe('AI assistant nullable organization unique indexes', () => {
  it.each(migrationCases)(
    '$file uses partial unique indexes for org and tenant-wide rows',
    ({ file, orgIndex, tenantIndex }) => {
      const source = readFileSync(
        new URL(`../../migrations/${file}`, import.meta.url),
        'utf8',
      )

      expect(source).toContain(orgIndex)
      expect(source).toContain('where "organization_id" is not null')
      expect(source).toContain(tenantIndex)
      expect(source).toContain('where "organization_id" is null')
      expect(source).not.toContain(' add constraint ')
    },
  )

  it('keeps the module snapshot aligned with partial unique indexes', () => {
    const snapshot = JSON.parse(
      readFileSync(
        new URL('../../migrations/.snapshot-open-mercato.json', import.meta.url),
        'utf8',
      ),
    ) as {
      tables: Array<{ name: string; indexes: Array<{ keyName: string; expression?: string }> }>
    }

    const indexes = new Map<string, string>()
    for (const table of snapshot.tables) {
      for (const index of table.indexes) {
        if (index.expression) indexes.set(index.keyName, index.expression)
      }
    }

    for (const { orgIndex, tenantIndex } of migrationCases) {
      const orgIndexName = orgIndex.match(/"([^"]+)"/)?.[1]
      const tenantIndexName = tenantIndex.match(/"([^"]+)"/)?.[1]
      expect(orgIndexName ? indexes.get(orgIndexName) : undefined).toContain(
        'where "organization_id" is not null',
      )
      expect(tenantIndexName ? indexes.get(tenantIndexName) : undefined).toContain(
        'where "organization_id" is null',
      )
    }
  })
})
