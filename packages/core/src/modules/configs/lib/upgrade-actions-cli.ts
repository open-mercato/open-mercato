import { z } from 'zod'
import * as semver from 'semver'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { parseModuleCliOptions } from '@open-mercato/shared/lib/cli/parseModuleCliOptions'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { AdvisoryLockUnavailableError } from '@open-mercato/shared/lib/db/advisoryLock'
import {
  executeUpgradeAction,
  getCurrentVersion,
  isUpgradeActionsEnabled,
  listUpgradeActionStates,
  revertUpgradeAction,
  UpgradeActionError,
  UpgradeActionPostCommitError,
  validateUpgradeActionScope,
  type UpgradeActionState,
} from '../services/upgradeActionsService'

export const UPGRADE_ACTIONS_CLI_HELP = [
  'Usage: yarn mercato configs upgrade-actions <list|up|down> --tenant <uuid> --organization <uuid> [options]',
  '',
  '  list                         Show every upgrade action and whether it is applied in this scope.',
  '  up                           Apply pending organization-scoped actions in version order.',
  '  up --action <id> --version <version> [--allow-tenant-wide]',
  '                               Apply one action. Tenant-wide actions need --allow-tenant-wide.',
  '  down --action <id> --version <version>',
  '                               Revert one applied action that declares a down handler.',
  '',
  'Requires UPGRADE_ACTIONS_ENABLED. The organization must be active and belong to the tenant.',
].join('\n')

const uuid = z.string().uuid()

const argsSchema = z
  .object({
    subcommand: z.enum(['list', 'up', 'down']),
    tenantId: uuid,
    organizationId: uuid,
    actionId: z.string().trim().min(1).optional(),
    actionVersion: z
      .string()
      .trim()
      .refine((value) => semver.valid(semver.coerce(value)) !== null, 'invalid version')
      .optional(),
    allowTenantWide: z.boolean(),
  })
  .superRefine((args, ctx) => {
    const targeted = args.actionId !== undefined || args.actionVersion !== undefined
    if (targeted && (args.actionId === undefined || args.actionVersion === undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '--action and --version must be passed together' })
    }
    if (args.subcommand === 'down' && !targeted) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'down requires --action and --version' })
    }
    if (args.subcommand === 'list' && targeted) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'list does not accept --action or --version' })
    }
    if (args.allowTenantWide && !(args.subcommand === 'up' && targeted)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '--allow-tenant-wide only applies to a targeted up' })
    }
  })

export type UpgradeActionsCliArgs = z.infer<typeof argsSchema>

export type UpgradeActionsCliIo = {
  line: (text: string) => void
  error: (text: string) => void
  progress: ((text: string) => void) | null
}

export type UpgradeActionsCliScope = {
  container: AwilixContainer
  em: EntityManager
}

export type UpgradeActionsCliDeps = {
  io: UpgradeActionsCliIo
  openScope: () => Promise<{ scope: UpgradeActionsCliScope; close: () => Promise<void> }>
}

export function isUpgradeActionsHelpRequest(tokens: readonly string[]): boolean {
  return tokens.length === 0 || tokens.some((token) => token === '--help' || token === '-h' || token === 'help')
}

export function parseUpgradeActionsCliArgs(tokens: readonly string[]): { args: UpgradeActionsCliArgs } | { error: string } {
  const [subcommand, ...rest] = tokens
  const options = parseModuleCliOptions(rest, { skipEmptyKeys: true, consumeEmptyValues: true })
  const read = (key: string) => (typeof options[key] === 'string' ? (options[key] as string) : undefined)
  const parsed = argsSchema.safeParse({
    subcommand,
    tenantId: read('tenant'),
    organizationId: read('organization'),
    actionId: read('action'),
    actionVersion: read('version'),
    allowTenantWide: options['allow-tenant-wide'] === true || parseBooleanToken(read('allow-tenant-wide') ?? '') === true,
  })
  if (parsed.success) return { args: parsed.data }
  const issue = parsed.error.issues[0]
  const field = issue?.path?.[0]
  const flag = field === 'tenantId' ? '--tenant' : field === 'organizationId' ? '--organization' : field === 'subcommand' ? 'subcommand' : null
  return { error: flag ? `Invalid ${flag}: ${issue.message}` : issue?.message ?? 'Invalid arguments' }
}

function pluralize(count: number): string {
  return `${count} upgrade action${count === 1 ? '' : 's'}`
}

function moduleLabel(state: Pick<UpgradeActionState, 'ownerModuleId' | 'id'>): string {
  return state.ownerModuleId ?? state.id.split('.')[0]
}

function renderProgress(current: number, total: number): string {
  const width = 20
  const normalized = total > 0 ? total : 1
  const filled = Math.round((Math.min(current, normalized) / normalized) * width)
  return `[${'='.repeat(filled)}${'.'.repeat(width - filled)}] ${current}/${normalized}`
}

export function describeUpgradeActionFailure(error: unknown): string {
  if (error instanceof UpgradeActionError) return error.code
  if (error instanceof UpgradeActionPostCommitError) return 'post-commit step failed'
  if (error instanceof AdvisoryLockUnavailableError) {
    if (error.reason === 'commit_unknown') return 'commit outcome unknown; run list to see whether it was applied'
    if (error.reason === 'deadline') return 'another run of this action is in progress; retry later'
    return 'database unavailable; retry later'
  }
  if (error instanceof Error && error.name && error.name !== 'Error') return `handler failed (${error.name})`
  return 'handler failed'
}

function printList(io: UpgradeActionsCliIo, states: UpgradeActionState[]): void {
  if (!states.length) {
    io.line('No upgrade actions are registered for this app version.')
    return
  }
  for (const state of states) {
    const status = state.applied ? 'applied' : 'pending'
    const details = [
      state.scope ?? 'scope unknown',
      state.available ? (state.reversible ? 'reversible' : 'forward-only') : 'definition unavailable',
    ]
    io.line(` ${moduleLabel(state)}: ${state.id}@${state.version} ${status} (${details.join(', ')})`)
  }
}

type ModuleTally = { total: number; applied: number }

async function runBatch(
  deps: UpgradeActionsCliDeps,
  scope: UpgradeActionsCliScope,
  args: UpgradeActionsCliArgs,
  states: UpgradeActionState[],
): Promise<boolean> {
  const { io } = deps
  const available = states.filter((state) => state.available)
  const pending = available.filter((state) => !state.applied)
  const runnable = pending.filter((state) => state.scope === 'organization')
  const skipped = pending.filter((state) => state.scope === 'tenant')

  const tallies = new Map<string, ModuleTally>()
  for (const state of available) {
    if (!tallies.has(moduleLabel(state))) tallies.set(moduleLabel(state), { total: 0, applied: 0 })
  }
  for (const state of runnable) tallies.get(moduleLabel(state))!.total += 1

  let failure: { state: UpgradeActionState; reason: string; committed: boolean } | null = null
  let progressModule: string | null = null
  for (const state of runnable) {
    const label = moduleLabel(state)
    const tally = tallies.get(label)!
    if (io.progress && progressModule !== label) {
      if (progressModule !== null) io.progress('\n')
      progressModule = label
      io.progress(`   ${label}: ${renderProgress(tally.applied, tally.total)}`)
    }
    try {
      const result = await executeUpgradeAction(scope.container, {
        actionId: state.id,
        actionVersion: state.version,
        tenantId: args.tenantId,
        organizationId: args.organizationId,
      })
      if (result.status === 'completed') tally.applied += 1
    } catch (error) {
      const committed = error instanceof UpgradeActionPostCommitError
      if (committed) tally.applied += 1
      failure = { state, reason: describeUpgradeActionFailure(error), committed }
    }
    if (io.progress) io.progress(`\r   ${label}: ${renderProgress(tally.applied, tally.total)}`)
    if (failure) break
  }
  if (io.progress && progressModule !== null) io.progress('\n')

  if (!tallies.size) {
    io.line('No pending upgrade actions.')
  } else {
    for (const [label, tally] of tallies) {
      io.line(tally.applied > 0 ? ` ${label}: ${pluralize(tally.applied)} applied` : ` ${label}: no pending upgrade actions`)
    }
  }
  for (const state of skipped) {
    io.line(
      ` ${moduleLabel(state)}: skipped tenant-wide ${state.id}@${state.version} (run it with --action ${state.id} --version ${state.version} --allow-tenant-wide)`,
    )
  }
  if (failure) {
    const { state, reason, committed } = failure
    io.error(
      committed
        ? ` ${moduleLabel(state)}: ${state.id}@${state.version} was applied, but ${reason}. Rerunning will not repeat it.`
        : ` ${moduleLabel(state)}: ${state.id}@${state.version} failed: ${reason}. Later actions were not run.`,
    )
    return false
  }
  return true
}

async function runTargetedUp(
  deps: UpgradeActionsCliDeps,
  scope: UpgradeActionsCliScope,
  args: UpgradeActionsCliArgs,
  states: UpgradeActionState[],
): Promise<boolean> {
  const { io } = deps
  const actionId = args.actionId as string
  const actionVersion = args.actionVersion as string
  const state = states.find((candidate) => candidate.id === actionId && candidate.version === actionVersion && candidate.available)
  const label = state ? moduleLabel(state) : actionId.split('.')[0]
  if (!state) {
    io.error(` ${label}: ${actionId}@${actionVersion} failed: UPGRADE_ACTION_NOT_AVAILABLE`)
    return false
  }
  if (state.scope === 'tenant' && !args.allowTenantWide) {
    io.error(` ${label}: ${actionId}@${actionVersion} affects the whole tenant; pass --allow-tenant-wide to run it.`)
    return false
  }
  try {
    const result = await executeUpgradeAction(scope.container, {
      actionId,
      actionVersion,
      tenantId: args.tenantId,
      organizationId: args.organizationId,
    })
    io.line(result.status === 'completed' ? ` ${label}: 1 upgrade action applied` : ` ${label}: no pending upgrade actions`)
    return true
  } catch (error) {
    if (error instanceof UpgradeActionPostCommitError) {
      io.line(` ${label}: 1 upgrade action applied`)
      io.error(` ${label}: ${actionId}@${actionVersion} was applied, but post-commit step failed. Rerunning will not repeat it.`)
      return false
    }
    io.error(` ${label}: ${actionId}@${actionVersion} failed: ${describeUpgradeActionFailure(error)}`)
    return false
  }
}

async function runDown(
  deps: UpgradeActionsCliDeps,
  scope: UpgradeActionsCliScope,
  args: UpgradeActionsCliArgs,
  states: UpgradeActionState[],
): Promise<boolean> {
  const { io } = deps
  const actionId = args.actionId as string
  const actionVersion = args.actionVersion as string
  const state = states.find((candidate) => candidate.id === actionId && candidate.version === actionVersion)
  const label = state ? moduleLabel(state) : actionId.split('.')[0]
  try {
    await revertUpgradeAction(scope.container, {
      actionId,
      actionVersion,
      tenantId: args.tenantId,
      organizationId: args.organizationId,
    })
    io.line(` ${label}: 1 upgrade action reverted`)
    return true
  } catch (error) {
    if (error instanceof UpgradeActionPostCommitError) {
      io.line(` ${label}: 1 upgrade action reverted`)
      io.error(` ${label}: ${actionId}@${actionVersion} was reverted, but post-commit step failed.`)
      return false
    }
    io.error(` ${label}: ${actionId}@${actionVersion} was not reverted: ${describeUpgradeActionFailure(error)}`)
    return false
  }
}

/** Returns the process exit code. */
export async function runUpgradeActionsCli(tokens: readonly string[], deps: UpgradeActionsCliDeps): Promise<number> {
  const { io } = deps
  if (isUpgradeActionsHelpRequest(tokens)) {
    io.line(UPGRADE_ACTIONS_CLI_HELP)
    return 0
  }
  const parsed = parseUpgradeActionsCliArgs(tokens)
  if ('error' in parsed) {
    io.error(parsed.error)
    io.error('Run "yarn mercato configs upgrade-actions --help" for usage.')
    return 1
  }
  if (!isUpgradeActionsEnabled()) {
    io.error('Upgrade actions are disabled. Set UPGRADE_ACTIONS_ENABLED=true to use this command.')
    return 1
  }
  const { args } = parsed
  const { scope, close } = await deps.openScope()
  try {
    try {
      await validateUpgradeActionScope(scope.em, { tenantId: args.tenantId, organizationId: args.organizationId })
    } catch (error) {
      io.error(
        error instanceof UpgradeActionError
          ? 'The organization is not an active organization of an active tenant.'
          : `Could not validate the scope: ${describeUpgradeActionFailure(error)}`,
      )
      return 1
    }
    const states = await listUpgradeActionStates(scope.em, {
      tenantId: args.tenantId,
      organizationId: args.organizationId,
      version: getCurrentVersion(),
    })
    if (args.subcommand === 'list') {
      printList(io, states)
      return 0
    }
    if (args.subcommand === 'down') return (await runDown(deps, scope, args, states)) ? 0 : 1
    if (args.actionId) return (await runTargetedUp(deps, scope, args, states)) ? 0 : 1
    return (await runBatch(deps, scope, args, states)) ? 0 : 1
  } finally {
    await close()
  }
}
