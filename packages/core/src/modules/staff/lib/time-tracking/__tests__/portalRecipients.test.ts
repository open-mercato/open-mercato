/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import { filterPortalRecipientsByFeature } from '../portalRecipients'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const FEATURE = 'portal.support_tickets.view'

type AclRow = { user_id: string; features_json: unknown; is_portal_admin: boolean }
type WhereCall = [string, string, unknown]

function makeEm(tables: { userAcls?: AclRow[]; roleAcls?: AclRow[]; fail?: boolean }) {
  const queries: { table: string; wheres: WhereCall[] }[] = []
  const selectFrom = (table: string) => {
    const query = { table, wheres: [] as WhereCall[] }
    queries.push(query)
    const builder = {
      innerJoin: () => builder,
      select: () => builder,
      where: (column: string, operator: string, value: unknown) => {
        query.wheres.push([column, operator, value])
        return builder
      },
      execute: async () => {
        if (tables.fail) throw new Error('relation does not exist')
        const candidates = (query.wheres.find(([column]) => column.endsWith('user_id'))?.[2] ?? []) as string[]
        const rows = table === 'customer_user_acls' ? tables.userAcls ?? [] : tables.roleAcls ?? []
        return rows.filter((row) => candidates.includes(row.user_id))
      },
    }
    return builder
  }
  const em = { getKysely: () => ({ selectFrom }) } as unknown as EntityManager
  return { em, queries }
}

describe('filterPortalRecipientsByFeature', () => {
  it('keeps users whose role ACLs grant the feature, wildcard-aware, and drops the rest', async () => {
    const { em } = makeEm({
      roleAcls: [
        { user_id: 'exact', features_json: [FEATURE], is_portal_admin: false },
        { user_id: 'wildcard', features_json: ['portal.support_tickets.*'], is_portal_admin: false },
        { user_id: 'other', features_json: ['portal.time_reports.view'], is_portal_admin: false },
      ],
    })

    await expect(filterPortalRecipientsByFeature(em, ['exact', 'wildcard', 'other', 'no-roles'], SCOPE, FEATURE))
      .resolves.toEqual(['exact', 'wildcard'])
  })

  it('treats a portal admin as unrestricted', async () => {
    const { em } = makeEm({ roleAcls: [{ user_id: 'admin', features_json: [], is_portal_admin: true }] })
    await expect(filterPortalRecipientsByFeature(em, ['admin'], SCOPE, FEATURE)).resolves.toEqual(['admin'])
  })

  it('lets a per-user ACL replace the role grants, and skips the role query for those users', async () => {
    const { em, queries } = makeEm({
      userAcls: [{ user_id: 'restricted', features_json: ['portal.time_reports.view'], is_portal_admin: false }],
      roleAcls: [{ user_id: 'restricted', features_json: [FEATURE], is_portal_admin: false }],
    })

    await expect(filterPortalRecipientsByFeature(em, ['restricted'], SCOPE, FEATURE)).resolves.toEqual([])
    expect(queries.map((query) => query.table)).toEqual(['customer_user_acls'])
  })

  it('reads features stored as a JSON string', async () => {
    const { em } = makeEm({ userAcls: [{ user_id: 'json', features_json: JSON.stringify([FEATURE]), is_portal_admin: false }] })
    await expect(filterPortalRecipientsByFeature(em, ['json'], SCOPE, FEATURE)).resolves.toEqual(['json'])
  })

  it('scopes the role lookup to the tenant and organization', async () => {
    const { em, queries } = makeEm({ roleAcls: [] })
    await filterPortalRecipientsByFeature(em, ['user-1'], SCOPE, FEATURE)
    const roleQuery = queries.find((query) => query.table === 'customer_user_roles')
    expect(roleQuery?.wheres).toEqual(expect.arrayContaining([
      ['customer_roles.tenant_id', '=', 'tenant-1'],
      ['customer_roles.organization_id', '=', 'org-1'],
      ['customer_roles.deleted_at', 'is', null],
      ['customer_user_roles.deleted_at', 'is', null],
    ]))
  })

  it('fails closed when the customer tables are unavailable', async () => {
    const { em } = makeEm({ fail: true })
    await expect(filterPortalRecipientsByFeature(em, ['user-1'], SCOPE, FEATURE)).resolves.toEqual([])
  })

  it('does not query anything for an empty audience', async () => {
    const { em, queries } = makeEm({})
    await expect(filterPortalRecipientsByFeature(em, [], SCOPE, FEATURE)).resolves.toEqual([])
    expect(queries).toHaveLength(0)
  })
})
