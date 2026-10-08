/**
 * The step sequence behind `mercato upgrade`, kept free of module bootstrap and database wiring so
 * the order, the exclusions and the failure handling are provable without a database.
 *
 * Every step here is additive and idempotent on re-run. That is what makes the command safe to put
 * on an unattended deploy path, and it is why the destructive-on-re-run class — module
 * `setup.seedDefaults`, `configs restore-defaults`, `seedExamples` — is excluded from the default
 * path. See `.ai/specs/2026-07-27-mercato-upgrade-reconcile-command.md` for the audit of all 21
 * `seedDefaults` implementations behind that exclusion.
 */

/** A refusal to be reported as a plain message, not as an unexpected crash. */
export class UpgradeRefusal extends Error {}

export type UpgradeQuery = (
  sql: string,
  values?: unknown[],
) => Promise<{ rows: Array<Record<string, unknown>> }>

/**
 * `upgrade` reconciles an existing deployment; it never creates a tenant, organization or user.
 * That invariant is what makes it safe to run unattended, and it means an uninitialised database is
 * a refusal rather than something to bootstrap — running the reconcile steps against one would
 * produce partial state that looks initialised but has no tenant.
 */
export async function assertDeploymentInitialized(query: UpgradeQuery): Promise<void> {
  const tableCheck = await query(`SELECT to_regclass('public.users') AS regclass`)
  if (!tableCheck.rows?.[0]?.regclass) {
    throw new UpgradeRefusal(
      'This database has no users table, so it has never been initialized. Run `yarn mercato init` first.',
    )
  }

  const countResult = await query('SELECT COUNT(*)::text AS count FROM users')
  const count = Number.parseInt(String(countResult.rows?.[0]?.count ?? '0'), 10)
  if (!Number.isFinite(count) || count === 0) {
    throw new UpgradeRefusal(
      'This database has no users, so it has never been initialized. Run `yarn mercato init` first.',
    )
  }
}

/**
 * Validated before any step runs. Two of the composed commands report an unknown tenant by printing
 * and returning, which would let a scoped run report success having reconciled nothing; checking
 * here makes those branches unreachable. Compared as text so a non-UUID argument is a refusal rather
 * than a cast error.
 */
export async function assertTenantExists(query: UpgradeQuery, tenantId: string): Promise<void> {
  const result = await query(
    'SELECT id::text AS id FROM tenants WHERE id::text = $1 AND deleted_at IS NULL',
    [tenantId],
  )
  if (!result.rows?.length) {
    throw new UpgradeRefusal(`Tenant not found, or soft-deleted: ${tenantId}`)
  }
}

const TENANT_SCOPE_FLAGS = ['tenant', 'tenantId'] as const

function readFlagValue(args: readonly string[], name: string): string | undefined {
  const assignment = `--${name}=`
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token) continue
    if (token.startsWith(assignment)) return token.slice(assignment.length)
    if (token === `--${name}`) {
      const next = args[index + 1]
      return next && !next.startsWith('--') ? next : ''
    }
  }
  return undefined
}

/**
 * Reads `--tenant` / `--tenantId` in both the `--flag value` and `--flag=value` spellings.
 *
 * An absent flag means every tenant, which is the command's documented default. A flag that is
 * *present with no value* — a bare `--tenant`, one followed by another flag, or a `--tenant=` left
 * behind by an empty variable expansion — is a refusal instead, because reading it as absent would
 * silently widen the run from the single tenant the operator asked for to all of them, reinstalling
 * definitions and granting ACLs outside the requested scope. Refusing here, before the lock is
 * taken and before anything migrates, is what makes the scope flag fail-before-write.
 */
export function parseUpgradeTenantScope(args: readonly string[]): string | null {
  let resolved: string | null = null

  for (const name of TENANT_SCOPE_FLAGS) {
    const raw = readFlagValue(args, name)
    if (raw === undefined) continue

    const value = raw.trim()
    if (!value) {
      throw new UpgradeRefusal(
        `--${name} was passed without a tenant id. Pass the tenant id to reconcile one tenant, ` +
          'or omit the flag to reconcile every tenant.',
      )
    }
    if (resolved === null) resolved = value
  }

  return resolved
}

export type UpgradeModuleCommandRunner = (
  moduleName: string,
  commandName: string,
  args: string[],
  options?: { optional?: boolean },
) => Promise<boolean>

export type UpgradeDeps = {
  /** Applies pending migrations. The caller already holds the upgrade lock, so this must not take it. */
  migrate: () => Promise<void>
  runModuleCommand: UpgradeModuleCommandRunner
  /** Supplied only when `--with-seed-defaults` was passed; its absence is what keeps the hazard opt-in. */
  seedDefaults?: () => Promise<void>
  log?: (message: string) => void
  warn?: (message: string) => void
  now?: () => number
}

export type UpgradeOptions = {
  tenantId?: string | null
  withSeedDefaults?: boolean
}

export type UpgradeStepOutcome = {
  label: string
  status: 'ran' | 'skipped' | 'tolerated'
  durationMs: number
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`
  return `${(durationMs / 1000).toFixed(1)}s`
}

function isMissingFileError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/**
 * Runs the four reconcile steps in order, then the opt-in fifth.
 *
 * Each step is wrapped so a non-zero `process.exitCode` fails the run. Several of the composed
 * commands report some refusals by printing and returning rather than throwing, which would
 * otherwise let `upgrade` claim success having reconciled nothing. The caller additionally
 * pre-validates `--tenant` and the module registry, which is what makes the remaining
 * print-and-return branches unreachable from here.
 */
export async function runUpgradeSteps(
  deps: UpgradeDeps,
  options: UpgradeOptions = {},
): Promise<UpgradeStepOutcome[]> {
  const log = deps.log ?? ((message: string) => console.log(message))
  const warn = deps.warn ?? ((message: string) => console.warn(message))
  const now = deps.now ?? (() => Date.now())
  const outcomes: UpgradeStepOutcome[] = []

  // Scope flags are always passed explicitly: per-command defaults disagree (`entities install`
  // defaults to every non-deleted tenant, other commands default to global-only), so relying on
  // them would make the composed behaviour depend on which command you are looking at. The space
  // form is used deliberately — `auth sync-role-acls` silently ignores `--tenant=<id>`.
  const scopeArgs = options.tenantId ? ['--tenant', options.tenantId] : []

  const runStep = async (
    label: string,
    action: () => Promise<'ran' | 'skipped' | 'tolerated'>,
  ): Promise<void> => {
    const startedAt = now()
    const previousExitCode = process.exitCode
    process.exitCode = undefined

    let status: 'ran' | 'skipped' | 'tolerated'
    try {
      status = await action()
      const code = process.exitCode
      if (code !== undefined && code !== 0) {
        throw new Error(`Step "${label}" refused or failed (exit code ${code})`)
      }
    } finally {
      process.exitCode = previousExitCode
    }

    const durationMs = now() - startedAt
    outcomes.push({ label, status, durationMs })
    const suffix = status === 'ran' ? '' : ` (${status})`
    log(`   ✅ ${label} — ${formatDuration(durationMs)}${suffix}`)
  }

  await runStep('database migrations', async () => {
    await deps.migrate()
    return 'ran'
  })

  await runStep('entities install', async () => {
    // Deliberately no `--force`: it defeats the checksum cache that makes this step a no-op when
    // nothing drifted, and forces cache invalidation on every scope.
    await deps.runModuleCommand('entities', 'install', scopeArgs)
    return 'ran'
  })

  await runStep('auth sync-role-acls', async () => {
    await deps.runModuleCommand('auth', 'sync-role-acls', scopeArgs)
    return 'ran'
  })

  await runStep('feature_toggles seed-defaults', async () => {
    try {
      // `optional` tolerates the module being absent from this deployment. It does NOT tolerate a
      // throw from inside the command, which is why the missing-defaults case is caught below: the
      // command reads its defaults file before touching the database, so a packaging slip would
      // otherwise fail a deploy over data it only ever creates.
      const ran = await deps.runModuleCommand('feature_toggles', 'seed-defaults', [], {
        optional: true,
      })
      return ran ? 'ran' : 'skipped'
    } catch (error: unknown) {
      if (!isMissingFileError(error)) throw error
      warn('   ⚠️  feature_toggles seed-defaults skipped: its defaults file is missing from this build.')
      return 'tolerated'
    }
  })

  if (options.withSeedDefaults) {
    if (!deps.seedDefaults) {
      throw new Error('[internal] --with-seed-defaults was requested but no seed runner was supplied')
    }
    await runStep('seed:defaults (opt-in)', async () => {
      await deps.seedDefaults!()
      return 'ran'
    })
  }

  return outcomes
}

/**
 * The warning that must precede an opt-in `--with-seed-defaults` run. Every item is a measured
 * behaviour of a shipped `seedDefaults` implementation, not a hypothetical.
 */
export const SEED_DEFAULTS_HAZARDS = [
  'sync_excel        wipes configured integration credentials to {} and force-re-enables it',
  'customers         reverts admin-customised dictionary colour/icon to seed values',
  'workflows         overwrites a tenant-edited workflow definition on a structural diff',
  'dashboards/staff  resurrects widgets an admin deliberately removed',
  'systemic          existence checks filter deletedAt:null, so soft-deleted rows return as duplicates',
] as const

export function printSeedDefaultsWarning(log: (message: string) => void): void {
  log('')
  log('⚠️  --with-seed-defaults runs module seed hooks, which this repo does not treat as idempotent.')
  log('   Known destructive behaviour on re-run:')
  for (const hazard of SEED_DEFAULTS_HAZARDS) log(`     • ${hazard}`)
  log('   Not every implementation has been audited. MUST NOT be wired into a deploy script.')
  log('   Continuing because the flag was passed explicitly.')
  log('')
}

/**
 * Printed after a successful run. Operators have no other way to learn that the reconcile is
 * deliberately partial, or that a release may carry source-level changes for their own code.
 */
export function printUpgradeFollowUps(
  log: (message: string) => void,
  options: { seedDefaultsAlreadyRan?: boolean } = {},
): void {
  log('')
  log('Not run by `upgrade` — each needs an operator decision:')
  if (!options.seedDefaultsAlreadyRan) {
    log('   • mercato seed:defaults             module seed hooks are not idempotent; they can overwrite')
    log('                                       tenant configuration on re-run. Opt in with --with-seed-defaults.')
  }
  log('   • mercato reindex                   minutes-scale; schedule it as its own operator decision.')
  log('   • mercato configs restore-defaults  passes force:true, resetting vector + notifications config.')
  log('')
  log('📋 Database reconciled. Source-level changes are not: review UPGRADE_NOTES.md for the window you')
  log('   upgraded across and apply anything affecting your own modules. If that section names a companion')
  log('   `om-auto-upgrade-<from>-<to>` skill, run it with a coding agent — it migrates most patterns')
  log('   mechanically.')
  log('')
}
