import type { EventArgs, EventSubscriber } from '@mikro-orm/core'
import { getAgentActorScope, isAuditedCommandActive, isRuntimeAuditWriteActive } from './agentWriteScope'

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

export type RuntimeAuditEntityIdentity = { className: string; tableName: string }

function identityKey(identity: RuntimeAuditEntityIdentity): string {
  return `${identity.className}:${identity.tableName}`
}

/**
 * Agent-orchestrator runtime-audit entities admitted under an agent actor while
 * `withRuntimeAuditWrite` is active, keyed by ORM metadata identity (class name
 * AND table name), never by class object: a production Next.js build loads the
 * entity module twice (server and SSR chunk graphs), so after a server render
 * the ORM metadata can carry the other copy of the class. `AgentRun` is
 * admitted only for the narrow trace-field update below. Every other entity
 * keeps failing closed.
 */
export const RUNTIME_AUDIT_ENTITIES: readonly RuntimeAuditEntityIdentity[] = [
  { className: 'AgentGuardrailCheck', tableName: 'agent_guardrail_checks' },
  { className: 'AgentContextBundle', tableName: 'agent_context_bundles' },
  { className: 'AgentSpan', tableName: 'agent_spans' },
  { className: 'AgentToolCall', tableName: 'agent_tool_calls' },
  { className: 'AgentEvalResult', tableName: 'agent_eval_results' },
  { className: 'AgentRunArtifact', tableName: 'agent_run_artifacts' },
  { className: 'AgentRunSession', tableName: 'agent_run_sessions' },
  { className: 'AgentRun', tableName: 'agent_runs' },
]

/**
 * Append-only AO entities the runtime may only INSERT under
 * `withRuntimeAuditWrite`: the integrity guardrail set a run syncs on first use
 * (`agent_guardrail_sets` rows are immutable per `(org, capability, version)`).
 */
export const RUNTIME_AUDIT_CREATE_ONLY_ENTITIES: readonly RuntimeAuditEntityIdentity[] = [
  { className: 'AgentGuardrailSet', tableName: 'agent_guardrail_sets' },
]

const AGENT_RUN_IDENTITY_KEY = identityKey({ className: 'AgentRun', tableName: 'agent_runs' })
const RUNTIME_AUDIT_ENTITY_KEYS: ReadonlySet<string> = new Set(RUNTIME_AUDIT_ENTITIES.map(identityKey))
const RUNTIME_AUDIT_CREATE_ONLY_ENTITY_KEYS: ReadonlySet<string> = new Set(
  RUNTIME_AUDIT_CREATE_ONLY_ENTITIES.map(identityKey),
)

/**
 * `AgentRun` properties the runtime may change on an EXISTING run under
 * `withRuntimeAuditWrite`: the usage/cost/latency stamp native trace capture
 * sends through `ingestTrace` and the online eval verdict `evaluateRun` writes.
 * Status, output, proposal link, routing, workflow binding and identity stay on
 * the audited Command path.
 */
export const RUNTIME_AUDIT_AGENT_RUN_FIELDS: ReadonlySet<string> = new Set([
  'model',
  'inputTokens',
  'outputTokens',
  'costMinor',
  'currency',
  'latencyMs',
  'evalScore',
  'evalPassed',
  'goldenCaseId',
  'goldenPassed',
  'updatedAt',
])

function entityIdentityKeyOf(args: EventArgs<unknown>): string | null {
  const meta = args.meta as { className?: unknown; tableName?: unknown } | undefined
  if (typeof meta?.className !== 'string' || typeof meta.tableName !== 'string') return null
  return identityKey({ className: meta.className, tableName: meta.tableName })
}

export function isRuntimeAuditEntity(args: EventArgs<unknown>): boolean {
  const key = entityIdentityKeyOf(args)
  if (!key) return false
  return RUNTIME_AUDIT_ENTITY_KEYS.has(key) || RUNTIME_AUDIT_CREATE_ONLY_ENTITY_KEYS.has(key)
}

function isRuntimeAuditTraceUpdate(operation: 'create' | 'update' | 'delete', args: EventArgs<unknown>): boolean {
  if (operation !== 'update') return false
  const payload = (args.changeSet as { payload?: unknown } | undefined)?.payload
  if (!payload || typeof payload !== 'object') return false
  return Object.keys(payload).every((field) => RUNTIME_AUDIT_AGENT_RUN_FIELDS.has(field))
}

export function isRuntimeAuditWriteAllowed(
  operation: 'create' | 'update' | 'delete',
  args: EventArgs<unknown>,
): boolean {
  const key = entityIdentityKeyOf(args)
  if (!key) return false
  if (RUNTIME_AUDIT_CREATE_ONLY_ENTITY_KEYS.has(key)) return operation === 'create'
  if (!RUNTIME_AUDIT_ENTITY_KEYS.has(key)) return false
  if (key !== AGENT_RUN_IDENTITY_KEY) return true
  return isRuntimeAuditTraceUpdate(operation, args)
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
    // Inside the runtime's own audit write → only the AO runtime-audit allowlist passes.
    if (isRuntimeAuditWriteActive() && isRuntimeAuditWriteAllowed(operation, args)) return
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

const REGISTERED_EVENT_MANAGERS_KEY = Symbol.for('@open-mercato/agent_orchestrator/agentNoBypassSubscriber')

function resolveRegisteredEventManagers(): WeakSet<object> {
  const registry = globalThis as typeof globalThis & { [REGISTERED_EVENT_MANAGERS_KEY]?: WeakSet<object> }
  const existing = registry[REGISTERED_EVENT_MANAGERS_KEY]
  if (existing) return existing
  const created = new WeakSet<object>()
  registry[REGISTERED_EVENT_MANAGERS_KEY] = created
  return created
}

const registeredEventManagers = resolveRegisteredEventManagers()

/**
 * Register the no-bypass subscriber on an EntityManager's event manager exactly
 * once (mirrors `registerTenantEncryptionSubscriber`'s `registeredEventManagers`
 * WeakSet guard so the subscriber attaches once per EventManager). The WeakSet
 * lives on `globalThis`, so a second copy of this module (the SSR chunk graph of
 * a production build) does not attach a second subscriber.
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
