import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { PrivacyGovernanceService } from './services/governanceService'
import { environmentSanitizationSchema } from './data/validators'
import type { PrivacyRestoreReapplicationService } from './services/restoreReapplicationService'
import { assertActiveDatabaseIsRestoreTarget } from './services/restoreTarget'
import { z } from 'zod'

type ParsedArgs = { flags: Record<string, string | boolean> }

function parseArgs(args: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {}
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (!value?.startsWith('--')) continue
    const key = value.slice(2)
    const next = args[index + 1]
    if (next && !next.startsWith('--')) {
      flags[key] = next
      index += 1
    } else {
      flags[key] = true
    }
  }
  return { flags }
}

function stringFlag(args: ParsedArgs, key: string): string {
  const value = args.flags[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`[internal] Pass --${key} <value>`)
  }
  return value.trim()
}

const runRetention: ModuleCli = {
  command: 'retention-run',
  async run(rest) {
    try {
      const args = parseArgs(rest)
      const apply = args.flags.apply === true
      const maxBatchesValue = args.flags['max-batches']
      const maxBatches = typeof maxBatchesValue === 'string' ? Number.parseInt(maxBatchesValue, 10) : 20
      if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 100) {
        throw new Error('[internal] --max-batches must be between 1 and 100')
      }
      const container = await createRequestContainer()
      const service = container.resolve<PrivacyGovernanceService>('privacyGovernanceService')
      const tenantId = stringFlag(args, 'tenant')
      const organizationId = stringFlag(args, 'organization')
      const actorId = stringFlag(args, 'actor')
      const operation = await service.runRetention(
        { tenantId, organizationId },
        actorId,
        { policyId: stringFlag(args, 'policy'), dryRun: !apply, maxBatches },
        {
          container,
          auth: null,
          organizationScope: null,
          selectedOrganizationId: organizationId,
          organizationIds: [organizationId],
          systemActor: true,
        },
      )
      console.log(JSON.stringify({
        operationId: operation.id,
        status: operation.status,
        dryRun: operation.dryRun,
        report: operation.reportJson,
      }, null, 2))
      if (operation.status === 'failed' || operation.status === 'blocked') process.exitCode = 1
      if (operation.status === 'partial') process.exitCode = 2
    } catch (error) {
      console.error(`[data_erasure] ${error instanceof Error ? error.message : 'Retention run failed.'}`)
      process.exitCode = 1
    }
  },
}

const sanitizeEnvironment: ModuleCli = {
  command: 'sanitize-environment',
  async run(rest) {
    try {
      const args = parseArgs(rest)
      const apply = args.flags.apply === true
      const input = environmentSanitizationSchema.parse({
        profile: 'sandbox-strict',
        dryRun: !apply,
        confirmation: typeof args.flags.confirm === 'string' ? args.flags.confirm : null,
      })
      const container = await createRequestContainer()
      const service = container.resolve<PrivacyGovernanceService>('privacyGovernanceService')
      const operation = await service.runEnvironmentSanitization(
        { tenantId: stringFlag(args, 'tenant'), organizationId: stringFlag(args, 'organization') },
        stringFlag(args, 'actor'),
        input,
      )
      console.log(JSON.stringify({
        operationId: operation.id,
        status: operation.status,
        dryRun: operation.dryRun,
        report: operation.reportJson,
      }, null, 2))
      if (operation.status === 'failed' || operation.status === 'blocked') process.exitCode = 1
      if (operation.status === 'partial') process.exitCode = 2
    } catch (error) {
      console.error(`[data_erasure] ${error instanceof Error ? error.message : 'Environment sanitization failed.'}`)
      process.exitCode = 1
    }
  },
}

const reapplyRestoredErasures: ModuleCli = {
  command: 'restore-reapply',
  async run(rest) {
    try {
      const args = parseArgs(rest)
      const apply = args.flags.apply === true
      const confirmation = args.flags.confirm
      if (apply && confirmation !== 'REAPPLY_RESTORED_ERASURES') {
        throw new Error('[internal] Apply mode requires --confirm REAPPLY_RESTORED_ERASURES')
      }
      const after = new Date(stringFlag(args, 'after'))
      if (!Number.isFinite(after.getTime())) throw new Error('[internal] --after must be an ISO timestamp')
      const maxEntriesValue = args.flags['max-entries']
      const maxEntries = typeof maxEntriesValue === 'string' ? Number.parseInt(maxEntriesValue, 10) : 100
      if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 1_000) {
        throw new Error('[internal] --max-entries must be between 1 and 1000')
      }
      const offsetValue = args.flags.offset
      const offset = typeof offsetValue === 'string' ? Number.parseInt(offsetValue, 10) : 0
      if (!Number.isInteger(offset) || offset < 0) {
        throw new Error('[internal] --offset must be zero or a positive integer')
      }
      const actorId = z.string().uuid().parse(stringFlag(args, 'actor'))
      assertActiveDatabaseIsRestoreTarget()
      const container = await createRequestContainer()
      const service = container.resolve<PrivacyRestoreReapplicationService>('privacyRestoreReapplicationService')
      const result = await service.reapply({
        after,
        actorId,
        dryRun: !apply,
        maxEntries,
        offset,
        commandContext: {
          container,
          auth: null,
          organizationScope: null,
          selectedOrganizationId: null,
          organizationIds: null,
          systemActor: true,
        },
      })
      console.log(JSON.stringify(result, null, 2))
      if (result.failed > 0 || result.blocked > 0) process.exitCode = 1
      else if (result.partial > 0 || result.continuationRequired) process.exitCode = 2
    } catch (error) {
      console.error(`[data_erasure] ${error instanceof Error ? error.message : 'Restore erasure reapplication failed.'}`)
      process.exitCode = 1
    }
  },
}

const help: ModuleCli = {
  command: 'help',
  run() {
    console.log('Usage: yarn mercato data_erasure retention-run --tenant <id> --organization <id> --actor <user-id> --policy <id> [--apply] [--max-batches <n>]')
    console.log('       yarn mercato data_erasure sanitize-environment --tenant <id> --organization <id> --actor <user-id> [--apply --confirm SANITIZE_NON_PRODUCTION]')
    console.log('       yarn mercato data_erasure restore-reapply --after <backup-completed-at> --actor <user-id> [--apply --confirm REAPPLY_RESTORED_ERASURES] [--max-entries <n>] [--offset <n>]')
  },
}

export default [runRetention, sanitizeEnvironment, reapplyRestoredErasures, help]
