import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { runWithCacheTenant } from '@open-mercato/cache'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { runOmnibusBackfill, type OmnibusBackfillResult } from './lib/omnibusBackfill'
import { resolveOmnibusCache } from './lib/omnibusCache'
import { omnibusBackfillOptionsSchema } from './data/validators'
import {
  installExampleCatalogData,
  seedCatalogExamplesForScope,
  seedCatalogPriceKinds,
  seedCatalogUnits,
  type CatalogSeedScope,
} from './lib/seeds'

function parseArgs(rest: string[]) {
  const args: Record<string, string> = {}
  for (let i = 0; i < rest.length; i += 1) {
    const part = rest[i]
    if (!part) continue
    if (part.startsWith('--')) {
      const [rawKey, rawValue] = part.slice(2).split('=')
      if (rawValue !== undefined) args[rawKey] = rawValue
      else if (rest[i + 1] && !rest[i + 1]!.startsWith('--')) {
        args[rawKey] = rest[i + 1]!
        i += 1
      }
    }
  }
  return args
}

const seedUnitsCommand: ModuleCli = {
  command: 'seed-units',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato catalog seed-units --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: CatalogSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedCatalogUnits(tem, scope)
      })
      console.log('📏 Unit dictionary seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedPriceKindsCommand: ModuleCli = {
  command: 'seed-price-kinds',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId) {
      console.error('Usage: mercato catalog seed-price-kinds --tenant <tenantId> [--org <organizationId>]')
      return
    }
    const container = await createRequestContainer()
    const scope = { tenantId, organizationId: organizationId || null }
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedCatalogPriceKinds(tem, scope)
      })
      console.log(
        '🏷️ Price kinds seeded for tenant',
        tenantId,
        organizationId ? `(org: ${organizationId})` : '(org: shared)',
      )
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedExamplesCommand: ModuleCli = {
  command: 'seed-examples',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato catalog seed-examples --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: CatalogSeedScope = { tenantId, organizationId }
    let seeded = false
    try {
      const em = container.resolve<EntityManager>('em')
      seeded = await em.transactional(async (tem) =>
        seedCatalogExamplesForScope(tem, container, scope)
      )
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
    if (seeded) {
      console.log('Catalog example data seeded for organization', organizationId)
    } else {
      console.log('Catalog example data already present; skipping')
    }
  },
}

const installExamplesBundle: ModuleCli = {
  command: 'seed-examples-bundle',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato catalog seed-examples-bundle --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: CatalogSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      const { seededExamples } = await em.transactional(async (tem) =>
        installExampleCatalogData(container, scope, tem)
      )
      if (seededExamples) {
        console.log('Catalog example data seeded for organization', organizationId)
      } else {
        console.log('Catalog example data already present; skipping examples')
      }
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const OMNIBUS_BACKFILL_USAGE =
  'Usage: mercato catalog omnibus:backfill --tenant <tenantId> [--org <organizationId>] [--channel-id <channelId> | --unscoped] [--batch-size N] [--dry-run]'

function readFlag(rest: string[], name: string): boolean {
  for (const part of rest) {
    if (part === `--${name}`) return true
    if (part.startsWith(`--${name}=`)) return parseBooleanToken(part.slice(name.length + 3)) === true
  }
  return false
}

export function parseOmnibusBackfillArgs(rest: string[]) {
  const args = parseArgs(rest.filter((part) => part !== '--dry-run' && part !== '--unscoped'))
  const rawBatchSize = args.batchSize ?? args['batch-size'] ?? args.batch
  return omnibusBackfillOptionsSchema.safeParse({
    tenantId: args.tenantId ?? args.tenant ?? '',
    organizationId: args.organizationId ?? args.org ?? args.orgId ?? undefined,
    channelId: args.channelId ?? args['channel-id'] ?? args.channel ?? undefined,
    unscoped: readFlag(rest, 'unscoped'),
    batchSize: rawBatchSize !== undefined ? Number(rawBatchSize) : undefined,
    dryRun: readFlag(rest, 'dry-run'),
  })
}

function printOmnibusBackfillResult(result: OmnibusBackfillResult) {
  const label = result.dryRun ? '[omnibus:backfill] Dry run' : '[omnibus:backfill] Complete'
  console.log(`${label} (tenant=${result.tenantId}, org=${result.organizationId ?? 'all'})`)
  for (const target of result.targets) {
    const key = target.coverageKey || '(unscoped)'
    console.log(
      `  ${key}: lookbackDays=${target.lookbackDays} recordedAt=${target.recordedAt} scanned=${target.scanned} alreadyCovered=${target.alreadyCovered} missing=${target.missing} created=${target.created} skippedIncomplete=${target.skippedIncomplete} skippedUntracked=${target.skippedUntracked}`,
    )
  }
  if (!result.dryRun) {
    console.log(`  Coverage recorded: ${result.coverageRecorded.map((key) => key || '(unscoped)').join(', ') || 'none'}`)
  }
  if (result.organizationId) {
    console.log(
      '  Coverage is tenant-wide and is recorded only by a run without --org; run the backfill without --org before enabling Omnibus.',
    )
  }
}

const omnibusBackfillCommand: ModuleCli = {
  command: 'omnibus:backfill',
  async run(rest) {
    const parsed = parseOmnibusBackfillArgs(rest)
    if (!parsed.success) {
      console.error(OMNIBUS_BACKFILL_USAGE)
      for (const issue of parsed.error.issues) {
        console.error(`  ${issue.path.join('.') || 'options'}: ${issue.message}`)
      }
      return
    }
    const container = await createRequestContainer()
    try {
      const result = await runWithCacheTenant(parsed.data.tenantId, () =>
        runOmnibusBackfill(
          {
            em: container.resolve<EntityManager>('em'),
            moduleConfigService: container.resolve<ModuleConfigService>('moduleConfigService'),
            cache: resolveOmnibusCache(container),
          },
          parsed.data,
        ),
      )
      printOmnibusBackfillResult(result)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

export default [seedUnitsCommand, seedPriceKindsCommand, seedExamplesCommand, installExamplesBundle, omnibusBackfillCommand]
