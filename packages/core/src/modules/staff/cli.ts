import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { seedStaffActivityTypes, seedStaffAddressTypes, seedStaffTeamExamples, type StaffSeedScope } from './lib/seeds'
import { seedStaffTimeTrackingExamples } from './lib/timeTrackingSeeds'
import { migrateProjectCodes } from './lib/time-tracking/migrateProjectCodes'
import { appendWidgetsToRoles } from '@open-mercato/core/modules/dashboards/lib/role-widgets'

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

export default [
  seedActivityTypesCommand,
  seedAddressTypesCommand,
  seedExamplesCommand,
  seedTimeTrackingExamplesCommand,
  seedTimesheetsWidgetsCommand,
  migrateProjectCodesCommand,
]
