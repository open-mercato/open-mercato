import { Migration } from '@mikro-orm/migrations'
import { readTenantBoundaryConfiguration } from '../../../lib/rls/runtime/config'
import { loadTenantTableManifest } from '../../../lib/rls/runtime/manifest'
import { createTenantMigrationHooks } from '../../../lib/rls/runtime/migrations'

export class Migration20261113160000 extends Migration {
  override async up(): Promise<void> {}

  override async down(): Promise<void> {
    const env = { ...process.env }
    const configuration = readTenantBoundaryConfiguration(env)
    if (!configuration.enabled) throw new Error('[internal] Enable tenant boundary maintenance configuration before policy rollback')
    const hooks = createTenantMigrationHooks(configuration, env, () => loadTenantTableManifest(configuration))
    await hooks.rollbackPolicies()
  }
}
