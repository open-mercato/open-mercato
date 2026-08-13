import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import type { EntityManager } from '@mikro-orm/postgresql'
import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { ensureRoles, ensureDefaultRoleAcls } from '@open-mercato/core/modules/auth/lib/setup-app'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

const APP_ROOT = path.resolve(process.env.OM_TEST_APP_ROOT?.trim() || path.resolve(process.cwd(), 'apps/mercato'))
const EXAMPLE_CALENDAR_ENTITY_ID = 'example:calendar_entity'
const EXAMPLE_TODO_ENTITY_ID = 'example:todo'

type ModuleLike = {
  id: string
  setup?: {
    defaultRoleFeatures?: Record<string, string[]>
    onTenantCreated?: (input: Record<string, unknown>) => Promise<unknown>
    seedDefaults?: (input: Record<string, unknown>) => Promise<unknown>
    seedExamples?: (input: Record<string, unknown>) => Promise<unknown>
  }
}

let bootstrapPromise: Promise<{ modules: ModuleLike[] }> | null = null

async function getModules(): Promise<ModuleLike[]> {
  if (!bootstrapPromise) bootstrapPromise = bootstrapFromAppRoot(APP_ROOT) as Promise<{ modules: ModuleLike[] }>
  return (await bootstrapPromise).modules
}

async function getExampleModule(): Promise<ModuleLike> {
  const found = (await getModules()).find((module) => module.id === 'example')
  expect(found, 'the example module must be registered in this app').toBeTruthy()
  return found!
}

type TenantFixture = { tenantId: string; organizationId: string }

/**
 * A tenant nobody has initialized.
 *
 * Written straight to the two tables rather than through `setupInitialTenant`, because the point
 * of this test is what the example module's own hooks do to a virgin scope — running the full
 * initializer first would seed the very rows the assertions are about.
 */
async function createTenantFixture(label: string): Promise<TenantFixture> {
  return withClient(async (client) => {
    const tenant = await client.query<{ id: string }>(
      `INSERT INTO tenants (name, is_active, created_at, updated_at)
       VALUES ($1, true, now(), now()) RETURNING id`,
      [label],
    )
    const tenantId = tenant.rows[0].id
    const organization = await client.query<{ id: string }>(
      `INSERT INTO organizations (tenant_id, name, is_active, depth, created_at, updated_at)
       VALUES ($1, $2, true, 0, now(), now()) RETURNING id`,
      [tenantId, `${label} org`],
    )
    return { tenantId, organizationId: organization.rows[0].id }
  })
}

async function dropTenantFixture(fixture: TenantFixture | null): Promise<void> {
  if (!fixture) return
  await withClient(async (client) => {
    await client.query('DELETE FROM custom_entities_storage WHERE tenant_id = $1', [fixture.tenantId])
    await client.query('DELETE FROM custom_field_values WHERE tenant_id = $1', [fixture.tenantId])
    await client.query('DELETE FROM custom_field_defs WHERE tenant_id = $1', [fixture.tenantId])
    await client.query('DELETE FROM custom_field_entity_configs WHERE tenant_id = $1', [fixture.tenantId])
    await client.query('DELETE FROM custom_entities WHERE tenant_id = $1', [fixture.tenantId])
    await client.query('DELETE FROM todos WHERE tenant_id = $1', [fixture.tenantId])
    await client.query(
      'DELETE FROM role_acls WHERE role_id IN (SELECT id FROM roles WHERE tenant_id = $1)',
      [fixture.tenantId],
    )
    await client.query('DELETE FROM roles WHERE tenant_id = $1', [fixture.tenantId])
    await client.query('DELETE FROM organizations WHERE tenant_id = $1', [fixture.tenantId])
    await client.query('DELETE FROM tenants WHERE id = $1', [fixture.tenantId])
  })
}

async function countCustomFieldDefs(fixture: TenantFixture): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM custom_field_defs
        WHERE tenant_id = $1 AND entity_id = ANY($2::text[])`,
      [fixture.tenantId, [EXAMPLE_CALENDAR_ENTITY_ID, EXAMPLE_TODO_ENTITY_ID]],
    )
    return Number(result.rows[0]?.count ?? '-1')
  })
}

async function readCalendarRecordIds(fixture: TenantFixture): Promise<string[]> {
  return withClient(async (client) => {
    const result = await client.query<{ entity_id: string }>(
      `SELECT entity_id FROM custom_entities_storage
        WHERE tenant_id = $1 AND organization_id = $2 AND entity_type = $3 AND deleted_at IS NULL
        ORDER BY entity_id`,
      [fixture.tenantId, fixture.organizationId, EXAMPLE_CALENDAR_ENTITY_ID],
    )
    return result.rows.map((row) => row.entity_id)
  })
}

async function countTodos(fixture: TenantFixture): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM todos WHERE tenant_id = $1 AND organization_id = $2',
      [fixture.tenantId, fixture.organizationId],
    )
    return Number(result.rows[0]?.count ?? '-1')
  })
}

async function readRoleFeatures(fixture: TenantFixture, roleName: string): Promise<string[]> {
  return withClient(async (client) => {
    const result = await client.query<{ features_json: unknown }>(
      `SELECT a.features_json FROM role_acls a
         JOIN roles r ON r.id = a.role_id
        WHERE r.tenant_id = $1 AND r.name = $2`,
      [fixture.tenantId, roleName],
    )
    const raw = result.rows[0]?.features_json
    if (Array.isArray(raw)) return raw as string[]
    if (typeof raw === 'string') return JSON.parse(raw) as string[]
    return []
  })
}

/**
 * Milestone B coverage for the module's three setup hooks.
 *
 * They are not three flavours of "seed something" — each receives a different thing at a
 * different moment, and the module's own docstring stakes a claim about which job only that hook
 * can do. This test is what makes the claim falsifiable: the hooks are driven directly against a
 * tenant nobody has initialized, in the order and with the arguments the framework uses, and then
 * driven a second time to prove the idempotency each one asserts by a different mechanism (the
 * installer upserts definitions, the reference records carry deterministic ids, the todo seeder
 * returns early once the scope has rows).
 *
 * The hooks run in-process rather than through `mercato init` deliberately: the initializer would
 * seed the very rows under assertion, and its own success would then be indistinguishable from
 * this module's hooks having done anything at all.
 */
test.describe('TC-EXAMPLE-010: the example setup hooks install, seed and re-run without duplicating', () => {
  test('onTenantCreated installs definitions and only definitions, and is idempotent', async () => {
    test.slow()
    const exampleModule = await getExampleModule()
    let fixture: TenantFixture | null = null

    try {
      fixture = await createTenantFixture(`TC-EXAMPLE-010 install ${randomUUID().slice(0, 8)}`)
      expect(await countCustomFieldDefs(fixture), 'a virgin tenant starts with nothing').toBe(0)

      const container = await createRequestContainer()
      const em = container.resolve('em') as EntityManager

      expect(exampleModule.setup?.onTenantCreated, 'the module must declare the hook').toBeTruthy()
      await exampleModule.setup!.onTenantCreated!({
        em: em.fork(),
        tenantId: fixture.tenantId,
        organizationId: fixture.organizationId,
      })

      const afterFirst = await countCustomFieldDefs(fixture)
      expect(afterFirst, 'the hook must install this module\'s custom-field definitions').toBeGreaterThan(0)

      // The boundary this hook must respect: definitions, never records. It gets an
      // `EntityManager` and no container, so it cannot resolve the data engine that writes rows —
      // a hook that seeded records here would be reaching past its own contract.
      expect(await readCalendarRecordIds(fixture), 'onTenantCreated writes no records').toEqual([])
      expect(await countTodos(fixture), 'onTenantCreated writes no demo domain rows').toBe(0)

      await exampleModule.setup!.onTenantCreated!({
        em: em.fork(),
        tenantId: fixture.tenantId,
        organizationId: fixture.organizationId,
      })
      expect(await countCustomFieldDefs(fixture), 'the installer upserts; it must not duplicate').toBe(afterFirst)
    } finally {
      await dropTenantFixture(fixture)
    }
  })

  test('seedDefaults writes the deterministic reference records and re-running changes nothing', async () => {
    test.slow()
    const exampleModule = await getExampleModule()
    let fixture: TenantFixture | null = null

    try {
      fixture = await createTenantFixture(`TC-EXAMPLE-010 defaults ${randomUUID().slice(0, 8)}`)
      const container = await createRequestContainer()
      const em = container.resolve('em') as EntityManager

      await exampleModule.setup!.onTenantCreated!({
        em: em.fork(),
        tenantId: fixture.tenantId,
        organizationId: fixture.organizationId,
      })

      expect(exampleModule.setup?.seedDefaults, 'the module must declare the hook').toBeTruthy()
      await exampleModule.setup!.seedDefaults!({
        em: em.fork(),
        container,
        tenantId: fixture.tenantId,
        organizationId: fixture.organizationId,
      })

      const firstRun = await readCalendarRecordIds(fixture)
      expect(firstRun.length, 'defaults must write scoped reference records').toBeGreaterThan(0)
      // Reference rows are not demo data: `seedExamples` is the only hook allowed to create
      // domain rows, and it has not run.
      expect(await countTodos(fixture), 'defaults must not seed demo todos').toBe(0)

      await exampleModule.setup!.seedDefaults!({
        em: em.fork(),
        container,
        tenantId: fixture.tenantId,
        organizationId: fixture.organizationId,
      })
      const secondRun = await readCalendarRecordIds(fixture)
      // Identity, not just cardinality: the ids are derived from the scope, so a second run
      // upserts the same rows. A count-only assertion would pass on a seeder that replaced them.
      expect(secondRun).toEqual(firstRun)
    } finally {
      await dropTenantFixture(fixture)
    }
  })

  test('seedExamples creates demo todos once and returns early on a scope that already has them', async () => {
    test.slow()
    const exampleModule = await getExampleModule()
    let fixture: TenantFixture | null = null

    try {
      fixture = await createTenantFixture(`TC-EXAMPLE-010 examples ${randomUUID().slice(0, 8)}`)
      const container = await createRequestContainer()
      const em = container.resolve('em') as EntityManager

      await exampleModule.setup!.onTenantCreated!({
        em: em.fork(),
        tenantId: fixture.tenantId,
        organizationId: fixture.organizationId,
      })
      await exampleModule.setup!.seedDefaults!({
        em: em.fork(),
        container,
        tenantId: fixture.tenantId,
        organizationId: fixture.organizationId,
      })

      expect(exampleModule.setup?.seedExamples, 'the module must declare the hook').toBeTruthy()
      await exampleModule.setup!.seedExamples!({
        em: em.fork(),
        container,
        tenantId: fixture.tenantId,
        organizationId: fixture.organizationId,
      })
      const firstRun = await countTodos(fixture)
      expect(firstRun, 'the opt-in hook is the only one that may create demo rows').toBeGreaterThan(0)

      await exampleModule.setup!.seedExamples!({
        em: em.fork(),
        container,
        tenantId: fixture.tenantId,
        organizationId: fixture.organizationId,
      })
      expect(await countTodos(fixture), 'the seeder returns early once the scope has todos').toBe(firstRun)
    } finally {
      await dropTenantFixture(fixture)
    }
  })

  test('a scope that skips the opt-in hook gets definitions and defaults but no demo rows', async () => {
    test.slow()
    const exampleModule = await getExampleModule()
    let fixture: TenantFixture | null = null

    try {
      fixture = await createTenantFixture(`TC-EXAMPLE-010 no-examples ${randomUUID().slice(0, 8)}`)
      const container = await createRequestContainer()
      const em = container.resolve('em') as EntityManager

      // Exactly what `mercato init --no-examples` runs: the two unconditional hooks, and not
      // the third. The distinction only means something if the skipped hook is the one that
      // would otherwise have written rows here.
      await exampleModule.setup!.onTenantCreated!({
        em: em.fork(),
        tenantId: fixture.tenantId,
        organizationId: fixture.organizationId,
      })
      await exampleModule.setup!.seedDefaults!({
        em: em.fork(),
        container,
        tenantId: fixture.tenantId,
        organizationId: fixture.organizationId,
      })

      expect(await countCustomFieldDefs(fixture)).toBeGreaterThan(0)
      expect((await readCalendarRecordIds(fixture)).length).toBeGreaterThan(0)
      expect(await countTodos(fixture), '--no-examples must leave the scope free of demo rows').toBe(0)
    } finally {
      await dropTenantFixture(fixture)
    }
  })

  test('the declared role features reach the real role ACLs, merged rather than replaced', async () => {
    test.slow()
    const exampleModule = await getExampleModule()
    const modules = await getModules()
    let fixture: TenantFixture | null = null

    try {
      fixture = await createTenantFixture(`TC-EXAMPLE-010 roles ${randomUUID().slice(0, 8)}`)
      const container = await createRequestContainer()
      const em = container.resolve('em') as EntityManager

      const declared = exampleModule.setup?.defaultRoleFeatures ?? {}
      expect(Object.keys(declared).sort()).toEqual(['admin', 'employee', 'superadmin'])

      await ensureRoles(em.fork(), { tenantId: fixture.tenantId })
      await ensureDefaultRoleAcls(em.fork(), fixture.tenantId, modules as never)

      for (const roleName of ['superadmin', 'admin', 'employee'] as const) {
        const granted = await readRoleFeatures(fixture, roleName)
        for (const feature of declared[roleName] ?? []) {
          expect(granted, `${roleName} must be granted ${feature}`).toContain(feature)
        }
        // Merged, not replaced: the same ACL row carries other modules' grants too, so a
        // module that overwrote the list would break every neighbour silently.
        expect(
          granted.some((feature) => !feature.startsWith('example.')),
          `${roleName} keeps the grants other modules declared`,
        ).toBe(true)
        // The first write must already be a set. Two modules legitimately declare the same
        // grant — this module asks for `payment_gateways.view` and so does that module — and
        // storing it twice on init while the second run collapsed it made the same list take
        // two shapes depending only on how often setup had run.
        expect(
          [...new Set(granted)].length,
          `${roleName} must be granted each feature exactly once`,
        ).toBe(granted.length)
      }

      // Re-running merges rather than duplicating.
      const before = await readRoleFeatures(fixture, 'employee')
      await ensureDefaultRoleAcls(em.fork(), fixture.tenantId, modules as never)
      const after = await readRoleFeatures(fixture, 'employee')
      expect(after).toEqual(before)
    } finally {
      await dropTenantFixture(fixture)
    }
  })
})
