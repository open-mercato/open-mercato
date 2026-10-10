import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { resolveFinancialCountryPlugin } from './lib/registries'
import { readFinancialJurisdiction } from './lib/jurisdiction'
import { seedChartOfAccounts } from './lib/chartOfAccounts'
import { setup } from './setup'

/**
 * Applies the module's reference data to a tenant that already exists.
 *
 * `setup.ts` reaches new tenants only, which leaves every tenant created before a
 * template gained an account without it — the same gap `auth sync-role-acls`
 * closes for role features. This is the command that closes it here: the chart of
 * accounts for the tenant's jurisdiction, then the payment methods and cash
 * account, all of it idempotent by code so re-running is always safe.
 *
 * `--country <code>` seeds a jurisdiction's chart without changing the stored
 * jurisdiction; with no flag the configured one is used, and an unconfigured
 * tenant seeds only the jurisdiction-neutral reference data.
 */
function parseArgs(rest: string[]): Record<string, string> {
  const args: Record<string, string> = {}
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]?.replace(/^--/, '')
    const value = rest[index + 1]
    if (key && value && !value.startsWith('--')) args[key] = value
    else if (key) args[key] = 'true'
  }
  return args
}

const seedDefaults: ModuleCli = {
  command: 'seed-defaults',
  async run(rest) {
    const args = parseArgs(rest)
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager
    const configService = (() => {
      try {
        return resolve('moduleConfigService') as ModuleConfigService
      } catch {
        return null
      }
    })()

    const tenantId = args.tenant ?? args.tenantId
    const organizationId = args.org ?? args.organizationId
    const organizations = await em.find(
      Organization,
      {
        // `tenant` is a relation, so the filter is `{ tenant: { id } }` — passing
        // the id as a bare string makes MikroORM compare it against the entity and
        // stringify an object into the uuid column.
        ...(tenantId ? { tenant: { id: tenantId } } : {}),
        ...(organizationId ? { id: organizationId } : {}),
      },
      { populate: ['tenant'] },
    )

    if (organizations.length === 0) {
      console.error('No matching organizations. Pass --org <organizationId> and/or --tenant <tenantId>.')
      return
    }

    for (const organization of organizations) {
      const scope = {
        tenantId: organization.tenant.id,
        organizationId: organization.id,
      }
      const configured = await readFinancialJurisdiction(configService, scope)
      const countryCode = (args.country || configured || '').trim().toUpperCase() || null
      const plugin = resolveFinancialCountryPlugin(countryCode)
      const template = plugin.chartOfAccounts

      if (template && template.listAccounts().length > 0 && countryCode) {
        const result = await seedChartOfAccounts(em, scope, template, {
          currencyCode: (args.currency || plugin.tax.currencyCode).toUpperCase(),
          countryCode,
        })
        console.log(
          `${countryCode} chart: ${result.created.length} created, ${result.skipped.length} already present.`,
        )
      } else {
        console.log('No jurisdiction chart to seed (pass --country SA, or configure one first).')
      }

      await setup.seedDefaults?.({
        em,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        container: resolve,
      } as never)
      console.log(`${organization.name ?? organization.id}: payment methods and cash account seeded.`)
    }
  },
}

const cliCommands: ModuleCli[] = [seedDefaults]

export default cliCommands
