import {
  defineSimulateConfig,
  SIMULATION_CRUD_ACTION_TYPES,
  type SimulationAuditEntry,
  type SimulationCrudEventAction,
  type SimulationEventAdapter,
  type SimulationEventAdapterContext,
  type SimulationEventPayload,
} from '@open-mercato/shared/modules/insights/simulate'
import './events'

type CrudCommandRole = 'create' | 'update' | 'delete'

type DealClosureOutcome = 'won' | 'lost'

type CustomerCrudEventSpec = {
  eventPrefix: string
  resourceKind: string
  requiredFeatures: string[]
  commandIds: Record<CrudCommandRole, string>
  undoEmits: Record<CrudCommandRole, SimulationCrudEventAction | null>
  profileIdentity: boolean
  syncOrigin: boolean
}

type ClosureValueResolution = { known: true; value: string | null } | { known: false }

const CRUD_COMMAND_ROLES: CrudCommandRole[] = ['create', 'update', 'delete']

const CRUD_EVENT_ACTIONS: SimulationCrudEventAction[] = ['created', 'updated', 'deleted']

const COMMAND_ROLE_EVENTS: Record<CrudCommandRole, SimulationCrudEventAction> = {
  create: 'created',
  update: 'updated',
  delete: 'deleted',
}

const SYNC_CAPABLE_CAUSE_KINDS: ReadonlySet<string> = new Set(['sync_run', 'subscriber', 'schedule', 'system', 'unknown'])

const DEAL_RESOURCE_KIND = 'customers.deal'

const DEAL_UPDATE_COMMAND_ID = 'customers.deals.update'

const DEAL_VIEW_FEATURE = 'customers.deals.view'

const DEAL_CLOSURE_VALUE_FIELDS = ['ownerUserId', 'title', 'valueAmount', 'valueCurrency'] as const

const PERSON_EVENTS: CustomerCrudEventSpec = {
  eventPrefix: 'customers.person',
  resourceKind: 'customers.person',
  requiredFeatures: ['customers.people.view'],
  commandIds: {
    create: 'customers.people.create',
    update: 'customers.people.update',
    delete: 'customers.people.delete',
  },
  undoEmits: { create: 'deleted', update: 'updated', delete: 'created' },
  profileIdentity: true,
  syncOrigin: true,
}

const COMPANY_EVENTS: CustomerCrudEventSpec = {
  eventPrefix: 'customers.company',
  resourceKind: 'customers.company',
  requiredFeatures: ['customers.companies.view'],
  commandIds: {
    create: 'customers.companies.create',
    update: 'customers.companies.update',
    delete: 'customers.companies.delete',
  },
  undoEmits: { create: 'deleted', update: 'updated', delete: 'created' },
  profileIdentity: true,
  syncOrigin: false,
}

const DEAL_EVENTS: CustomerCrudEventSpec = {
  eventPrefix: 'customers.deal',
  resourceKind: DEAL_RESOURCE_KIND,
  requiredFeatures: [DEAL_VIEW_FEATURE],
  commandIds: {
    create: 'customers.deals.create',
    update: DEAL_UPDATE_COMMAND_ID,
    delete: 'customers.deals.delete',
  },
  undoEmits: { create: null, update: 'updated', delete: 'created' },
  profileIdentity: false,
  syncOrigin: false,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function withPaths(payload: Record<string, unknown>, unknownPaths: string[], valuePaths: string[]): SimulationEventPayload {
  return {
    payload,
    ...(unknownPaths.length > 0 ? { unknownPaths } : {}),
    ...(valuePaths.length > 0 ? { valuePaths } : {}),
  }
}

function resolveCommandRole(spec: CustomerCrudEventSpec, commandId: string | null): CrudCommandRole | null {
  return CRUD_COMMAND_ROLES.find((role) => spec.commandIds[role] === commandId) ?? null
}

function isUndoTrace(entry: SimulationAuditEntry, role: CrudCommandRole): boolean {
  if (entry.causeKind === 'undo') return true
  if (entry.causeKind !== null) return false
  if (role === 'create') return !isRecord(entry.snapshotAfter) && isRecord(entry.snapshotBefore)
  if (role === 'delete') return !isRecord(entry.snapshotBefore) && isRecord(entry.snapshotAfter)
  return false
}

function resolveEmittedCrudAction(spec: CustomerCrudEventSpec, entry: SimulationAuditEntry): SimulationCrudEventAction | null {
  if (entry.executionState === 'failed') return null
  const role = resolveCommandRole(spec, entry.commandId)
  if (!role) return null
  return isUndoTrace(entry, role) ? spec.undoEmits[role] : COMMAND_ROLE_EVENTS[role]
}

function readProfileId(entry: SimulationAuditEntry): string | null {
  for (const snapshot of [entry.snapshotAfter, entry.snapshotBefore]) {
    if (!isRecord(snapshot) || !isRecord(snapshot.profile)) continue
    const profileId = readNonEmptyString(snapshot.profile.id)
    if (profileId) return profileId
  }
  return null
}

function isSyncOriginUnknown(entry: SimulationAuditEntry): boolean {
  return entry.causeKind === null || SYNC_CAPABLE_CAUSE_KINDS.has(entry.causeKind)
}

function buildCrudPayload(
  spec: CustomerCrudEventSpec,
  entry: SimulationAuditEntry,
  ctx: SimulationEventAdapterContext,
): SimulationEventPayload | null {
  const recordId = readNonEmptyString(entry.resourceId)
  if (!recordId) return null
  const payload: Record<string, unknown> = {}
  const unknownPaths: string[] = []
  if (spec.profileIdentity) {
    const profileId = readProfileId(entry)
    if (profileId) payload.id = profileId
    else unknownPaths.push('id')
    payload.entityId = recordId
  } else {
    payload.id = recordId
  }
  payload.organizationId = entry.organizationId ?? ctx.scope.organizationId
  payload.tenantId = ctx.scope.tenantId
  if (spec.syncOrigin && isSyncOriginUnknown(entry)) unknownPaths.push('syncOrigin')
  return withPaths(payload, unknownPaths, [])
}

function createCustomerCrudAdapters(spec: CustomerCrudEventSpec): SimulationEventAdapter[] {
  return CRUD_EVENT_ACTIONS.map((action): SimulationEventAdapter => {
    const roles = CRUD_COMMAND_ROLES.filter(
      (role) => COMMAND_ROLE_EVENTS[role] === action || spec.undoEmits[role] === action,
    )
    const actionTypes = roles.flatMap((role) => SIMULATION_CRUD_ACTION_TYPES[COMMAND_ROLE_EVENTS[role]])
    return {
      eventId: `${spec.eventPrefix}.${action}`,
      logResourceKinds: [spec.resourceKind],
      actionTypes: Array.from(new Set(actionTypes)),
      requiredFeatures: [...spec.requiredFeatures],
      commandIds: roles.map((role) => spec.commandIds[role]),
      payloadFrom(entry, ctx) {
        if (resolveEmittedCrudAction(spec, entry) !== action) return null
        return buildCrudPayload(spec, entry, ctx)
      },
    }
  })
}

function readDealRecord(snapshot: unknown): Record<string, unknown> | null {
  return isRecord(snapshot) && isRecord(snapshot.deal) ? snapshot.deal : null
}

function normalizeClosureStatus(status: string): string {
  if (status === 'win') return 'won'
  if (status === 'loose') return 'lost'
  return status
}

function resolveClosedDealAmount(before: unknown, after: unknown): ClosureValueResolution {
  if (after === null) return { known: true, value: null }
  if (typeof after !== 'string' || after.trim().length === 0) return { known: false }
  const amount = Number(after)
  if (!Number.isFinite(amount)) return { known: false }
  const inputForm = String(amount)
  const beforeReadable = before === null || typeof before === 'string'
  if (beforeReadable && before !== after) return { known: true, value: inputForm }
  if (inputForm === after) return { known: true, value: after }
  return { known: false }
}

function resolveClosureValue(
  field: (typeof DEAL_CLOSURE_VALUE_FIELDS)[number],
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): ClosureValueResolution {
  if (field === 'valueAmount') return resolveClosedDealAmount(before.valueAmount, after.valueAmount)
  const value = after[field]
  return value === null || typeof value === 'string' ? { known: true, value } : { known: false }
}

function createDealClosureAdapter(outcome: DealClosureOutcome): SimulationEventAdapter {
  return {
    eventId: `customers.deal.${outcome}`,
    logResourceKinds: [DEAL_RESOURCE_KIND],
    actionTypes: [...SIMULATION_CRUD_ACTION_TYPES.updated],
    requiredFeatures: [DEAL_VIEW_FEATURE],
    commandIds: [DEAL_UPDATE_COMMAND_ID],
    payloadFrom(entry, ctx) {
      if (entry.executionState === 'failed' || entry.causeKind === 'undo') return null
      if (entry.commandId !== DEAL_UPDATE_COMMAND_ID) return null
      const dealId = readNonEmptyString(entry.resourceId)
      const before = readDealRecord(entry.snapshotBefore)
      const after = readDealRecord(entry.snapshotAfter)
      if (!dealId || !before || !after) return null
      if (typeof before.status !== 'string' || typeof after.status !== 'string') return null
      if (before.status === after.status || normalizeClosureStatus(after.status) !== outcome) return null
      const payload: Record<string, unknown> = {
        id: dealId,
        tenantId: ctx.scope.tenantId,
        organizationId: entry.organizationId ?? ctx.scope.organizationId,
      }
      const unknownPaths: string[] = []
      const valuePaths: string[] = []
      for (const field of DEAL_CLOSURE_VALUE_FIELDS) {
        const resolution = resolveClosureValue(field, before, after)
        if (resolution.known) {
          payload[field] = resolution.value
          valuePaths.push(field)
        } else {
          unknownPaths.push(field)
        }
      }
      return withPaths(payload, unknownPaths, valuePaths)
    },
  }
}

/**
 * Change simulator event adapters for the person, company and deal events the customers
 * commands emit (`commands/people.ts`, `commands/companies.ts`, `commands/deals.ts`).
 *
 * Person and company payloads carry the profile id as `id` and the customer entity id (the audit
 * `resourceId`) as `entityId`. The profile id comes from the audit snapshot but is an immutable
 * identifier, not a past value, so it is not a value path: rule executions are keyed by it. Only
 * person events carry `syncOrigin`, which is unknown for entries a sync bridge, subscriber,
 * schedule or system job may have written. An undo writes a trace entry with the source command
 * id: undoing a person or company create emits `deleted`, undoing any delete emits `created`,
 * undoing an update emits `updated`, and undoing a deal create emits nothing. `customers.deal.won` / `.lost` are emitted
 * by `customers.deals.update` when the raw status changes and the new status normalizes to the
 * outcome (`win` → won, `loose` → lost); the payload values come from the after snapshot. The
 * amount is unknown when it cannot tell whether the update re-sent an unchanged amount (the
 * emitted string keeps the input form, the snapshot keeps the stored form).
 *
 * The module's events are imported here so the declared event catalog is complete wherever the
 * simulator runs (worker processes do not load the app's event registry); the trigger backtest
 * relies on it to tell whether a pattern selects events these adapters do not rebuild.
 */
export const simulateConfig = defineSimulateConfig({
  version: 1,
  eventAdapters: [
    ...createCustomerCrudAdapters(PERSON_EVENTS),
    ...createCustomerCrudAdapters(COMPANY_EVENTS),
    ...createCustomerCrudAdapters(DEAL_EVENTS),
    createDealClosureAdapter('won'),
    createDealClosureAdapter('lost'),
  ],
})

export default simulateConfig
