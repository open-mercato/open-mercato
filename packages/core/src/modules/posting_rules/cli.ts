import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { seedPostingRulesDefaults } from './lib/seedDefaults'

function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('--')) continue
    if (arg.includes('=')) {
      const [key, ...value] = arg.slice(2).split('=')
      result[key] = value.join('=')
      continue
    }
    const key = arg.slice(2)
    const next = args[i + 1]
    if (next && !next.startsWith('--')) {
      result[key] = next
      i++
    } else {
      result[key] = true
    }
  }
  return result
}

/**
 * `yarn mercato posting_rules dev-seed-defaults --tenant <id> --org <id>`
 *
 * Runs the module's own idempotent `seedPostingRulesDefaults` (sentinel
 * "UNALLOCATED" cost centre + empty settings row) for a tenant/organization
 * that existed before the module was enabled, so module setup never ran
 * for it. Safe to re-run. Refuses to run when NODE_ENV is "production".
 */
const devSeedDefaults: ModuleCli = {
  command: 'dev-seed-defaults',
  async run(rest) {
    if (process.env.NODE_ENV === 'production') {
      console.error('dev-seed-defaults refuses to run when NODE_ENV=production.')
      process.exitCode = 1
      return
    }
    const args = parseArgs(rest)
    const tenantId = typeof args.tenant === 'string' ? args.tenant : ''
    const organizationId = typeof args.org === 'string' ? args.org : ''
    if (!tenantId || !organizationId) {
      console.error('Usage: yarn mercato posting_rules dev-seed-defaults --tenant <id> --org <id>')
      process.exitCode = 1
      return
    }
    const container = await createRequestContainer()
    try {
      const em = (container.resolve('em') as EntityManager).fork()
      const touched = await seedPostingRulesDefaults(em, { tenantId, organizationId })
      console.log(touched ? 'Seeded posting_rules defaults (sentinel cost centre and/or settings row).' : 'Nothing to seed: defaults already present.')
    } catch (err) {
      console.error('dev-seed-defaults failed:', err instanceof Error ? err.message : err)
      process.exitCode = 1
    } finally {
      await (container as { dispose?: () => Promise<void> }).dispose?.()
    }
  },
}

export default [devSeedDefaults]
