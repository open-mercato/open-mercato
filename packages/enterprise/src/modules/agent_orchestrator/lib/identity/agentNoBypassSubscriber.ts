import type { EventArgs, EventSubscriber } from '@mikro-orm/core'
import { getAgentActorScope, isAuditedCommandActive } from './agentWriteScope'

/**
 * Thrown by the flush-time write-interceptor when a `kind='agent'` actor attempts
 * a write outside the audited Command path. Fail-closed: it aborts the flush, so
 * the un-audited agent write never reaches the database. (Agent identity &
 * on-behalf-of, Wave 4 Phase 3, layer B-b.)
 */
export class AgentWriteBypassError extends Error {
  readonly code = 'agent_write_bypass'
  constructor(operation: 'create' | 'update' | 'delete', entityName: string) {
    super(
      `[internal] agent-actor write bypassed the audited Command path ` +
        `(operation=${operation}, entity=${entityName}); writes by a kind='agent' ` +
        `principal must flow through the audited Command path`,
    )
    this.name = 'AgentWriteBypassError'
  }
}

function entityNameOf(args: EventArgs<unknown>): string {
  const meta = args.meta as { className?: string; tableName?: string } | undefined
  if (meta?.className) return meta.className
  if (meta?.tableName) return meta.tableName
  const ctorName = (args.entity as { constructor?: { name?: string } })?.constructor?.name
  return ctorName ?? 'unknown'
}

/**
 * The PRIMARY runtime no-bypass control (layer B-b). A global MikroORM
 * `EventSubscriber` (all entities, mirroring `TenantEncryptionSubscriber`) that
 * fails closed on any create/update/delete whose actor is a `kind='agent'`
 * principal AND that is NOT executing inside the audited Command path.
 *
 * It keys off the async-scoped agent-actor context (`getAgentActorScope`), which
 * the runtime binds around a principal-bound agent run, and the audited-command
 * scope (`isAuditedCommandActive`), which the agent's own AgentRun/AgentProposal
 * Command writes set. Therefore:
 *
 *   - HUMAN writes pass unaffected — no agent-actor scope is active, so the guard
 *     never fires.
 *   - PROPERLY-ATTRIBUTED agent writes pass — the agent's audited Command writes
 *     run inside `withAuditedCommand`, so `isAuditedCommandActive()` is true.
 *   - A RAW `em.flush()` reached under an agent actor (a bypass) throws — the
 *     agent-actor scope is active but no audited-command scope wraps the write.
 *
 * Structural propose-only (layer B-c) means an orchestrated agent holds no
 * mutating tools, so under normal operation there is nothing to bypass; this
 * guard is the fail-closed backstop for the token-bearing external case and for
 * any future code path that reaches a flush under an agent actor.
 */
export class AgentKindNoBypassSubscriber implements EventSubscriber<unknown> {
  getSubscribedEntities() {
    return [] // listen to all entities
  }

  private assertAllowed(operation: 'create' | 'update' | 'delete', args: EventArgs<unknown>): void {
    // Not inside a principal-bound agent run → nothing to guard (human path).
    if (!getAgentActorScope()) return
    // Inside the agent's own audited Command write → legitimate, attributed write.
    if (isAuditedCommandActive()) return
    // Agent actor active + no audited-command context → fail closed.
    throw new AgentWriteBypassError(operation, entityNameOf(args))
  }

  beforeCreate(args: EventArgs<unknown>): void {
    this.assertAllowed('create', args)
  }

  beforeUpdate(args: EventArgs<unknown>): void {
    this.assertAllowed('update', args)
  }

  beforeDelete(args: EventArgs<unknown>): void {
    this.assertAllowed('delete', args)
  }
}

const registeredEventManagers = new WeakSet<object>()

/**
 * Register the no-bypass subscriber on an EntityManager's event manager exactly
 * once (mirrors `registerTenantEncryptionSubscriber`'s `registeredEventManagers`
 * WeakSet guard so the subscriber attaches once per EventManager).
 */
export function registerAgentKindNoBypassSubscriber(
  em:
    | { getEventManager?: () => { registerSubscriber?: (subscriber: EventSubscriber<unknown>) => void } }
    | null
    | undefined,
): void {
  const eventManager = em?.getEventManager?.()
  if (!eventManager || typeof eventManager.registerSubscriber !== 'function') return
  if (registeredEventManagers.has(eventManager)) return
  eventManager.registerSubscriber(new AgentKindNoBypassSubscriber())
  registeredEventManagers.add(eventManager)
}
