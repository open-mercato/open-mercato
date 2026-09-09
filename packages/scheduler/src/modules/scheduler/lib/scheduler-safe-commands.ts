export type SchedulerSafeCommandDefinition = {
  commandId: string
  requiredFeatures: readonly [string, ...string[]]
}

export type SchedulerCommandRbacService = {
  userHasAllFeatures?: (
    userId: string,
    required: readonly string[],
    scope: { tenantId: string | null; organizationId: string | null }
  ) => Promise<boolean>
}

/**
 * A scheduled command run was refused, and no retry can change that.
 *
 * Every rejection `assertSchedulerSafeCommandAuthorized` raises is a decision
 * about the actor and the command, not a transient failure: the command is off
 * the allowlist, there is no actor to authorize, the RBAC service is missing, or
 * the actor lacks the required features. A `userHasAllFeatures` implementation
 * whose store is down throws straight through instead, so callers can tell a
 * refusal from an outage.
 *
 * Branch on this type, never on the message text: the wording is diagnostic and
 * changes with the code — this release alone renamed `creator` to `actor` in two
 * of the four — which is the fragility this type exists to remove.
 */
export class SchedulerCommandAuthorizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SchedulerCommandAuthorizationError'
  }
}

const schedulerSafeCommands = new Map<string, SchedulerSafeCommandDefinition>()

function normalizeCommandId(commandId: unknown): string | null {
  if (typeof commandId !== 'string') return null
  const trimmed = commandId.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeFeatures(features: readonly string[]): [string, ...string[]] | null {
  const normalized = features
    .map((feature) => feature.trim())
    .filter((feature) => feature.length > 0)
  return normalized.length > 0 ? (normalized as [string, ...string[]]) : null
}

export function registerSchedulerSafeCommands(commands: readonly SchedulerSafeCommandDefinition[]): void {
  for (const command of commands) {
    const commandId = normalizeCommandId(command.commandId)
    const requiredFeatures = normalizeFeatures(command.requiredFeatures)
    if (!commandId || !requiredFeatures) {
      throw new Error('[internal] Scheduler-safe commands require a commandId and requiredFeatures')
    }
    schedulerSafeCommands.set(commandId, { commandId, requiredFeatures })
  }
}

export function getSchedulerSafeCommand(commandId: unknown): SchedulerSafeCommandDefinition | null {
  const normalized = normalizeCommandId(commandId)
  if (!normalized) return null
  return schedulerSafeCommands.get(normalized) ?? null
}

export function isSchedulerSafeCommandId(commandId: unknown): boolean {
  return getSchedulerSafeCommand(commandId) !== null
}

export function listSchedulerSafeCommands(): SchedulerSafeCommandDefinition[] {
  return Array.from(schedulerSafeCommands.values()).sort((a, b) => a.commandId.localeCompare(b.commandId))
}

export async function assertSchedulerSafeCommandAuthorized(params: {
  commandId: unknown
  actorUserId: string | null | undefined
  tenantId: string | null | undefined
  organizationId: string | null | undefined
  rbacService: SchedulerCommandRbacService
}): Promise<SchedulerSafeCommandDefinition> {
  const command = getSchedulerSafeCommand(params.commandId)
  if (!command) {
    throw new SchedulerCommandAuthorizationError('Scheduled command is not allowed')
  }

  const actorUserId = normalizeCommandId(params.actorUserId)
  if (!actorUserId) {
    throw new SchedulerCommandAuthorizationError('Scheduled command requires an authenticated actor')
  }

  if (typeof params.rbacService.userHasAllFeatures !== 'function') {
    throw new SchedulerCommandAuthorizationError('Scheduled command authorization is unavailable')
  }

  const authorized = await params.rbacService.userHasAllFeatures(actorUserId, command.requiredFeatures, {
    tenantId: params.tenantId ?? null,
    organizationId: params.organizationId ?? null,
  })
  if (!authorized) {
    throw new SchedulerCommandAuthorizationError('Scheduled command actor is not authorized')
  }

  return command
}

export function clearSchedulerSafeCommandsForTests(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('[internal] clearSchedulerSafeCommandsForTests is test-only')
  }
  schedulerSafeCommands.clear()
}

registerSchedulerSafeCommands([
  {
    commandId: 'scheduler.test.echo',
    requiredFeatures: ['scheduler.jobs.manage'],
  },
])
