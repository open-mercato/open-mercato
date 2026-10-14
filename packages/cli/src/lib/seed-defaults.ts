import type { Module } from '@open-mercato/shared/modules/registry'

/**
 * A refusal the caller should report verbatim rather than as an unexpected failure — the
 * distinction `mercato seed:defaults` has always drawn in its output.
 */
export class SeedDefaultsRefusal extends Error {}

export type RunSeedDefaultsOptions = {
  moduleFilter?: string | null
  /**
   * Already-bootstrapped modules. Supplied by a composing caller (`mercato upgrade`) that has
   * bootstrapped once; omitted by the standalone command, which bootstraps for itself.
   */
  modules?: Module[]
}

/**
 * Runs every enabled module's `setup.seedDefaults` for every organization, then re-merges custom
 * role ACLs — the behaviour of `mercato seed:defaults` since #1099, extracted so the opt-in
 * `mercato upgrade --with-seed-defaults` runs exactly the same pass rather than a second
 * implementation of it.
 *
 * These hooks are NOT idempotent. See `printSeedDefaultsWarning` in `./upgrade` and the audit in
 * `.ai/specs/2026-07-27-mercato-upgrade-reconcile-command.md` before putting this on any automatic
 * path.
 */
export async function runSeedDefaults(options: RunSeedDefaultsOptions = {}): Promise<void> {
  const moduleFilter = options.moduleFilter ?? null
  let allModules = options.modules

  if (!allModules) {
    const [{ bootstrapFromAppRoot }, { createResolver }, { registerCliModules, getCliModules }] =
      await Promise.all([
        import('@open-mercato/shared/lib/bootstrap/dynamicLoader'),
        import('./resolver'),
        import('../registry'),
      ])
    const resolver = createResolver()
    const data = await bootstrapFromAppRoot(resolver.getAppDir())
    registerCliModules(data.modules)
    allModules = getCliModules()
  }

  const modulesToSeed = moduleFilter
    ? allModules.filter((mod) => mod.id === moduleFilter)
    : allModules

  if (moduleFilter && modulesToSeed.length === 0) {
    throw new SeedDefaultsRefusal(`Module "${moduleFilter}" not found.`)
  }

  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  const seedContainer = await createRequestContainer()
  const seedEm = seedContainer.resolve('em') as any

  const { Organization } = await import('@open-mercato/core/modules/directory/data/entities')
  const orgs = await seedEm.find(
    Organization,
    { deletedAt: null },
    { populate: ['tenant'] as const },
  )

  if (orgs.length === 0) {
    throw new SeedDefaultsRefusal('No organizations found. Run yarn initialize first.')
  }

  console.log(`📚 Running seed:defaults for ${orgs.length} org(s)...\n`)
  for (const org of orgs) {
    const tenantId = String(org.tenant.id)
    const organizationId = String(org.id)
    const seedCtx = { em: seedEm, tenantId, organizationId, container: seedContainer }

    console.log(`  🏢 org=${organizationId} tenant=${tenantId}`)
    for (const mod of modulesToSeed) {
      if (mod.setup?.seedDefaults) {
        console.log(`    📦 ${mod.id}...`)
        await mod.setup.seedDefaults(seedCtx)
      }
    }

    const { ensureCustomRoleAcls } = await import(
      '@open-mercato/core/modules/auth/lib/setup-app'
    )
    await ensureCustomRoleAcls(seedEm, tenantId, allModules)
  }

  console.log('\n✅ seed:defaults complete.')
}
