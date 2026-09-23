import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { seedStaffActivityTypes, seedStaffAddressTypes, seedStaffTeamExamples, type StaffSeedScope } from './lib/seeds'
import { seedStaffTimeTrackingExamples } from './lib/timeTrackingSeeds'
import { migrateProjectCodes } from './lib/time-tracking/migrateProjectCodes'
import { appendWidgetsToRoles } from '@open-mercato/core/modules/dashboards/lib/role-widgets'
import type { ProgressService } from '@open-mercato/core/modules/progress/lib/progressService'
import {
  STAFF_TIME_REAPPLY_ROUNDING_JOB_TYPE,
  STAFF_TIME_REAPPLY_ROUNDING_QUEUE,
  getStaffQueue,
  type ReapplyRoundingScope,
} from './lib/time-tracking/reapplyRounding'
import {
  listTimeTrackingRecalculations,
  resolveTimeTrackingRecalculations,
} from './lib/time-tracking/recalculations'

const TIMESHEETS_DASHBOARD_WIDGET_IDS = [
  'staff.timesheets.timeReporting',
  'staff.timesheets.hoursByProject',
]

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

const seedExamplesCommand: ModuleCli = {
  command: 'seed-examples',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato staff seed-examples --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: StaffSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedStaffTeamExamples(tem, scope)
      })
      console.log('🧩 Staff team examples seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedTimeTrackingExamplesCommand: ModuleCli = {
  command: 'seed-time-tracking-examples',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato staff seed-time-tracking-examples --tenant <tenantId> --org <organizationId>')
      console.error('Seeds demo projects, tasks, logged hours and reports for the time-tracking suite.')
      process.exit(1)
      return
    }
    const container = await createRequestContainer()
    const scope: StaffSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      const seeded = await em.transactional(async (tem) => {
        await seedStaffTeamExamples(tem, scope)
        return seedStaffTimeTrackingExamples(tem, scope)
      })
      if (seeded) {
        console.log('⏱️  Time-tracking demo data seeded for organization', organizationId)
        // The seed writes entities directly rather than through the commands, so
        // nothing it creates reaches the query index. Listing still works — the
        // engine reads base tables — but `$ilike` filters are answered from the
        // token index, so search silently returns nothing for seeded rows.
        console.log('   Run `mercato query_index reindex` to make this data searchable.')
      } else {
        console.log('Time-tracking demo data already present; skipping')
      }
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const migrateProjectCodesCommand: ModuleCli = {
  command: 'migrate-project-codes',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    // `parseArgs` only records `--key value` and `--key=value` pairs, so a bare
    // trailing flag never lands in it — read the argv directly rather than
    // silently running a dry run when the caller asked to apply.
    const dryRun = !rest.includes('--apply') && args.apply !== 'true' && args.apply !== '1'
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato staff migrate-project-codes --tenant <tenantId> --org <organizationId> [--apply]')
      console.error('Shortens project codes to the 3-letter form and re-derives every task reference.')
      console.error('Runs as a dry run unless --apply is given.')
      process.exit(1)
      return
    }
    const container = await createRequestContainer()
    try {
      const em = container.resolve<EntityManager>('em')
      const result = await migrateProjectCodes(em, { tenantId, organizationId }, { dryRun })
      if (result.changes.length === 0) {
        console.log('Nothing to migrate — every project code is already short.')
      } else {
        for (const change of result.changes) {
          console.log(
            `  ${change.fromCode} → ${change.toCode}  (${change.taskCount} task${change.taskCount === 1 ? '' : 's'})  ${change.projectName}`,
          )
        }
      }
      console.log(
        dryRun
          ? `\n🔍 Dry run — ${result.changes.length} project(s) would change, ${result.tasksRenumbered} task reference(s) rewritten, ${result.skipped} left alone. Re-run with --apply.`
          : `\n🔤 ${result.changes.length} project code(s) shortened, ${result.tasksRenumbered} task reference(s) rewritten, ${result.skipped} left alone.`,
      )
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') await disposable.dispose()
    }
  },
}

const seedActivityTypesCommand: ModuleCli = {
  command: 'seed-activity-types',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato staff seed-activity-types --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: StaffSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedStaffActivityTypes(tem, scope)
      })
      console.log('🗂️  Staff activity types seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedAddressTypesCommand: ModuleCli = {
  command: 'seed-address-types',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato staff seed-address-types --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: StaffSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedStaffAddressTypes(tem, scope)
      })
      console.log('🏠 Staff address types seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedTimesheetsWidgetsCommand: ModuleCli = {
  command: 'seed-timesheets-widgets',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato staff seed-timesheets-widgets --tenant <tenantId> --org <organizationId>')
      console.error('Backfills timesheets dashboard widgets (timeReporting, hoursByProject) to existing tenant roles.')
      process.exit(1)
      return
    }
    const container = await createRequestContainer()
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await appendWidgetsToRoles(tem, {
          tenantId,
          organizationId,
          roleNames: ['superadmin', 'admin', 'employee'],
          widgetIds: TIMESHEETS_DASHBOARD_WIDGET_IDS,
        })
      })
      console.log('📊 Timesheets dashboard widgets seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

/**
 * The progress job's name is rendered in the operator's top bar, so it goes
 * through the locale files like every other user-facing string. A CLI has no
 * request to derive a locale from; `resolveTranslations` falls back to the
 * default one, and a failure to load them must not stop a backfill.
 */
async function resolveRecalculationJobName(): Promise<string> {
  try {
    const { translate } = await resolveTranslations()
    return translate('staff.time_tracking.recalculate.jobName', 'Recalculate time tracking')
  } catch {
    return 'Recalculate time tracking'
  }
}

/**
 * EP-51. `mercato staff timesheets:recalculate` — the operator entry point to the
 * recalculation registry.
 *
 * It enqueues; it does not do the work. That is deliberate and not merely
 * convenient: the restatement is the same `ProgressJob` on the same queue the
 * settings screen drives, so an operator running a backfill from a shell and a
 * manager pressing the button in the UI produce the same job, visible in the same
 * progress bar, cancellable the same way. A CLI that did the work in-process would
 * be a second implementation of a write over billing data.
 *
 * `--hook` may be repeated (`--hook a --hook b`) or comma-separated. Omitting it
 * runs the built-in rounding pass, which is what the settings route enqueues, so
 * the flagless invocation is the documented equivalent of pressing the button.
 */
const recalculateCommand: ModuleCli = {
  command: 'timesheets:recalculate',
  async run(rest) {
    const args = parseArgs(rest)
    if (rest.includes('--list')) {
      const registered = listTimeTrackingRecalculations()
      if (registered.length === 0) {
        console.log('No time-tracking recalculations are registered.')
        return
      }
      console.log('Registered time-tracking recalculations:')
      for (const entry of registered) console.log(`  ${entry.id}  (${entry.labelKey})`)
      return
    }

    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    if (!tenantId) {
      console.error('Usage: mercato staff timesheets:recalculate --tenant <tenantId> [--org <organizationId>] [--hook <id>]')
      console.error('       mercato staff timesheets:recalculate --list')
      console.error('Enqueues the registered recalculation hooks as a progress job. Locked entries are never touched.')
      process.exit(1)
      return
    }

    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    const hookIds = String(args.hook ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)

    let resolvedHookIds: string[]
    try {
      resolvedHookIds = resolveTimeTrackingRecalculations(hookIds.length ? hookIds : null).map((hook) => hook.id)
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      console.error('Run `mercato staff timesheets:recalculate --list` to see the registered ids.')
      process.exit(1)
      return
    }

    const container = await createRequestContainer()
    try {
      const scope: ReapplyRoundingScope = {
        tenantId,
        organizationIds: organizationId ? [organizationId] : null,
        userId: null,
      }
      const jobName = await resolveRecalculationJobName()
      const progressService = container.resolve<ProgressService>('progressService')
      const progressJob = await progressService.createJob(
        {
          jobType: STAFF_TIME_REAPPLY_ROUNDING_JOB_TYPE,
          name: jobName,
          description: `Running ${resolvedHookIds.join(', ')}. Locked entries are not changed.`,
          totalCount: 0,
          cancellable: true,
          meta: { source: 'staff.timesheets.cli.recalculate', hookIds: resolvedHookIds },
        },
        { tenantId, organizationId: organizationId || null, userId: null },
      )
      const queue = getStaffQueue(STAFF_TIME_REAPPLY_ROUNDING_QUEUE)
      await queue.enqueue({ progressJobId: progressJob.id, scope, hookIds: resolvedHookIds })
      console.log('⏱️  Time-tracking recalculation enqueued:', resolvedHookIds.join(', '))
      console.log('    Progress job:', progressJob.id)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

export default [
  seedActivityTypesCommand,
  seedAddressTypesCommand,
  seedExamplesCommand,
  seedTimeTrackingExamplesCommand,
  seedTimesheetsWidgetsCommand,
  migrateProjectCodesCommand,
  recalculateCommand,
]
