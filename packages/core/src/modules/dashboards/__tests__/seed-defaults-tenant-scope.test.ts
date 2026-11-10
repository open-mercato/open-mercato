/**
 * @jest-environment node
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import { DashboardRoleWidgets } from '@open-mercato/core/modules/dashboards/data/entities'
import { seedDashboardDefaultsForTenant } from '@open-mercato/core/modules/dashboards/cli'

jest.mock('@open-mercato/core/modules/dashboards/lib/widgets', () => ({
  loadAllWidgets: async () => [{ metadata: { id: 'widget.a', defaultEnabled: true } }],
}))

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '22222222-2222-4222-8222-222222222222'
const ROLE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ROLE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

type Row = Record<string, unknown>

function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, value]) => (row[key] ?? null) === value)
}

function buildEm() {
  const roles: Row[] = [
    { id: ROLE_A, name: 'admin', tenantId: TENANT_A },
    { id: ROLE_B, name: 'admin', tenantId: TENANT_B },
  ]
  const roleWidgetRows: Row[] = []
  const tem = {
    async findOne(entity: unknown, filter: Row) {
      if (entity === Role) return roles.find((row) => matches(row, filter)) ?? null
      if (entity === DashboardRoleWidgets) return roleWidgetRows.find((row) => matches(row, filter)) ?? null
      throw new Error('[internal] unexpected findOne entity')
    },
    create(entity: unknown, data: Row) {
      if (entity !== DashboardRoleWidgets) throw new Error('[internal] unexpected create entity')
      const record = { ...data }
      roleWidgetRows.push(record)
      return record
    },
    persist() {},
  }
  const em = {
    async transactional(callback: (inner: typeof tem) => Promise<void>) {
      await callback(tem)
    },
  }
  return { em: em as unknown as EntityManager, roleWidgetRows }
}

describe('seedDashboardDefaultsForTenant — role tenant scope', () => {
  test.each([
    [TENANT_A, ROLE_A],
    [TENANT_B, ROLE_B],
  ])('seeding tenant %s attaches that tenant\'s own same-named role', async (tenantId, expectedRoleId) => {
    const { em, roleWidgetRows } = buildEm()

    await seedDashboardDefaultsForTenant(em, { tenantId, roleNames: ['admin'] })

    expect(roleWidgetRows).toHaveLength(1)
    expect(roleWidgetRows[0]).toMatchObject({ tenantId, roleId: expectedRoleId })
  })

  test('skips a role name the tenant does not own instead of borrowing another tenant\'s role', async () => {
    const { em, roleWidgetRows } = buildEm()

    await seedDashboardDefaultsForTenant(em, {
      tenantId: '33333333-3333-4333-8333-333333333333',
      roleNames: ['admin'],
    })

    expect(roleWidgetRows).toHaveLength(0)
  })
})
