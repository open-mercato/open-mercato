/**
 * Work Inbox — source-provider contract and registry (spec §2.3, §6.3).
 *
 * The inbox is a PROJECTION, not a table: phase 1 reads existing rows through
 * providers instead of migrating anything into a new `Task` entity. Core
 * registers the `user_task` provider; `agent_orchestrator` optionally registers
 * `agent_disposition`. Nothing here imports an optional peer — a provider that
 * is not registered simply does not contribute rows, so without enterprise the
 * inbox shows workflow tasks and no error is raised anywhere.
 *
 * The registry is modelled on `@open-mercato/shared/lib/crud/enricher-registry`
 * (many modules contributing to one merged list, HMR-safe `globalThis` storage)
 * with one deliberate difference: there is no generated work-inbox registry to
 * bootstrap from, so `registerWorkInboxSources` MERGES by `moduleId` instead of
 * replacing the whole set. Each module registers its own sources from its `di.ts`
 * at module-DI load time, re-registering the same module is idempotent, and the
 * modules stay independent of each other's load order.
 */

import { hasFeature } from '@open-mercato/shared/security/features'
import type {
  TaskEntityHiddenMarker,
  TaskVisibilityRequestContext,
} from '../task-visibility-request'

/** Mirrors the platform's priority labels (root AGENTS.md → PR Workflow). */
export const WORK_INBOX_PRIORITIES = ['extreme', 'high', 'medium', 'low'] as const

export type WorkInboxPriority = (typeof WORK_INBOX_PRIORITIES)[number]

/**
 * Statuses a work item is still actionable in. Terminal statuses are listed
 * instead of open ones so a provider that introduces its own vocabulary is
 * treated as open rather than silently disappearing from the queue.
 */
export const WORK_INBOX_TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED'] as const

export type WorkInboxEntityBinding = {
  entityType: string
  entityId: string
  label?: string | null
}

/**
 * Declarative action a provider offers on its rows. Kept serializable (an id, a
 * translation key, an endpoint template and a row predicate) so the page renders
 * every provider's actions through one code path and no provider ships UI code
 * into the inbox bundle.
 */
export type WorkInboxAction = {
  id: string
  labelKey: string
  /** POST endpoint; `{id}` is replaced with the row id. */
  endpoint: string
  appliesTo: WorkInboxActionPredicate
}

export type WorkInboxActionPredicate = 'claimable' | 'claimed-by-me' | 'open' | 'always'

export type WorkInboxRow = {
  id: string
  /** Provider discriminator — `user_task`, `agent_disposition`, … */
  kind: string
  moduleId: string
  title: string
  description: string | null
  status: string
  priority: WorkInboxPriority | null
  dueDate: string | null
  overdue: boolean
  createdAt: string
  updatedAt: string
  assignedTo: string | null
  assignedToRoles: string[] | null
  claimedBy: string | null
  entityTypes: string[]
  entityBindings: WorkInboxEntityBinding[]
  detailHref: string | null
  actions: WorkInboxAction[]
  /**
   * Provider-specific payload. The API spreads it UNDER the common fields, so a
   * `user_task` row on the wire stays a strict superset of what
   * `GET /api/workflows/tasks` already returned — which is what keeps the
   * enterprise "Review proposal" row action (it reads `row.proposalId`) working
   * against the new table.
   */
  details: Record<string, unknown>
}

export type WorkInboxQuery = {
  kinds: string[] | null
  moduleIds: string[] | null
  entityTypes: string[] | null
  roles: string[] | null
  priorities: WorkInboxPriority[] | null
  statuses: string[] | null
  overdueOnly: boolean
  myWork: boolean
  assignedTo: string | null
  workflowInstanceId: string | null
  limit: number
  offset: number
  now: Date
}

/**
 * Caller scope every provider MUST filter on. `organizationIds === null` is the
 * wildcard scope the directory helper returns for an unrestricted operator;
 * `tenantId` is never optional (module MUST #10).
 *
 * `visibility` carries the §6.4 rule's per-request inputs — the principal, the
 * tenant policy and the entity-access map — resolved ONCE by the route. It is
 * required rather than optional on purpose: a provider that forgets to apply it
 * would silently serve every row in the organization, and a compile error is the
 * only reliable way to notice that.
 */
export type WorkInboxScope = {
  tenantId: string
  organizationIds: string[] | null
  userId: string
  roles: string[]
  visibility: TaskVisibilityRequestContext
}

/**
 * Runtime seam. Providers resolve their own services through it rather than
 * importing them, so a provider registered by another module never drags that
 * module's internals into this one. Structural on purpose — no awilix import.
 */
export type WorkInboxSourceContext = {
  scope: WorkInboxScope
  resolve: <T>(name: string) => T
  /**
   * The queue feature the source being invoked declared, handed back to it so a
   * provider that serves `UserTask` rows can pass it to the §6.4 predicate
   * (`TaskFacts.administrativeQueueFeature`) without importing the registry it
   * is registered in.
   */
  administrativeQueueFeature?: string | null
}

export type WorkInboxSourceResult = {
  rows: WorkInboxRow[]
  total: number
  /**
   * Rows this source refused on entity access to a caller entitled to know they
   * are there (design §3.6). Optional and additive: a source that omits it
   * reports nothing, which is what every source did before.
   *
   * It carries ids and the blocking entity type, never row content — the point
   * is that an administrator can tell "no such task" from "you cannot see its
   * record", not that they can read the record anyway.
   */
  entityHidden?: TaskEntityHiddenMarker[]
}

export type WorkInboxSourceProvider = {
  kind: string
  moduleId: string
  /** Injection spot id the detail view renders for this kind, when any. */
  render?: string
  actions?: WorkInboxAction[]
  /**
   * ACL feature that admits a principal to this source's UNASSIGNED rows,
   * declaring "this kind is an administrative queue, not personal work".
   *
   * §6.4 makes a row visible to whoever it belongs to, and a queue item belongs
   * to nobody: it carries no assignee, no claimant and no role queue, because
   * the module that raised it cannot know a tenant's routing policy or role
   * vocabulary. Without a declaration such a row falls back to core's own
   * administrative grant (`workflows.tasks.view_all`); with one it is admitted
   * to exactly the population that could already act on that kind of work.
   *
   * It has two consumers, and both must agree or a row is counted in one place
   * and dropped in another:
   *
   * 1. **Source admission** — a source declaring a queue feature contributes
   *    nothing at all to a caller who does not hold it, so the whole kind
   *    disappears rather than answering an expensive query per request.
   * 2. **The §6.4 predicate** — passed back to the provider through
   *    `WorkInboxSourceContext.administrativeQueueFeature` so a provider serving
   *    `UserTask` rows uses it as the unassigned-queue arm instead of
   *    `workflows.tasks.view_all`.
   *
   * Absent (the core `user_task` source) leaves both behaviours exactly as they
   * were: no admission gate, `workflows.tasks.view_all` as the queue feature.
   */
  administrativeQueueFeature?: string
  list: (query: WorkInboxQuery, context: WorkInboxSourceContext) => Promise<WorkInboxSourceResult>
}

export type WorkInboxSourceEntry = {
  moduleId: string
  provider: WorkInboxSourceProvider
}

const GLOBAL_WORK_INBOX_SOURCES_KEY = '__openMercatoWorkInboxSources__'

let localEntries: WorkInboxSourceEntry[] | null = null

function readGlobalEntries(): WorkInboxSourceEntry[] | null {
  try {
    const value = (globalThis as Record<string, unknown>)[GLOBAL_WORK_INBOX_SOURCES_KEY]
    return Array.isArray(value) ? (value as WorkInboxSourceEntry[]) : null
  } catch {
    return null
  }
}

function writeGlobalEntries(entries: WorkInboxSourceEntry[]): void {
  try {
    ;(globalThis as Record<string, unknown>)[GLOBAL_WORK_INBOX_SOURCES_KEY] = entries
  } catch {
    // ignore global assignment failures
  }
}

/**
 * Register (or re-register) one module's work-inbox sources.
 *
 * Additive across modules, replacing within a module: calling it again for the
 * same `moduleId` swaps that module's providers and leaves every other module's
 * untouched. Registration order between modules is therefore irrelevant, which
 * matters because each module registers from its own `di.ts`.
 */
export function registerWorkInboxSources(
  entries: Array<{ moduleId: string; sources: WorkInboxSourceProvider[] }>,
): void {
  const replacedModuleIds = new Set(entries.map((entry) => entry.moduleId))
  const kept = getWorkInboxSources().filter((entry) => !replacedModuleIds.has(entry.moduleId))
  const added: WorkInboxSourceEntry[] = []
  for (const entry of entries) {
    for (const provider of entry.sources) {
      added.push({ moduleId: entry.moduleId, provider })
    }
  }
  const merged = [...kept, ...added]
  localEntries = merged
  writeGlobalEntries(merged)
}

export function getWorkInboxSources(): WorkInboxSourceEntry[] {
  const globalEntries = readGlobalEntries()
  if (globalEntries) return globalEntries
  return localEntries ?? []
}

/** Test seam — drops every registration so a suite starts from a known set. */
export function clearWorkInboxSources(): void {
  localEntries = []
  writeGlobalEntries([])
}

/**
 * The caller facts source admission is decided from — the same principal the
 * §6.4 predicate reads, narrowed to what this decision needs.
 */
export type WorkInboxSourceAdmission = {
  grantedFeatures: readonly string[]
  isSuperAdmin: boolean
}

/**
 * Whether this caller is admitted to an administrative-queue source at all.
 *
 * `hasFeature` rather than an array membership test, because a tenant `admin`
 * holds `agent_orchestrator.*` and not the concrete id — comparing raw strings
 * would lock every real administrator out of the queue the grant exists for.
 * A source that declares no queue feature is open to everyone the rows
 * themselves admit.
 */
export function isWorkInboxSourceAdmitted(
  provider: WorkInboxSourceProvider,
  admission: WorkInboxSourceAdmission | null | undefined,
): boolean {
  const required = provider.administrativeQueueFeature
  if (!required) return true
  if (!admission) return true
  if (admission.isSuperAdmin) return true
  return hasFeature(admission.grantedFeatures, required)
}

/**
 * Providers that can contribute to this query. Kind and module narrowing is
 * answered here rather than inside each provider so a filtered request does not
 * pay for a query per excluded source.
 *
 * `admission` is optional so every existing caller keeps its behaviour; when it
 * is supplied, a source declaring an `administrativeQueueFeature` the caller
 * does not hold is dropped before it is ever asked for rows.
 */
export function selectWorkInboxSources(
  query: WorkInboxQuery,
  admission?: WorkInboxSourceAdmission | null,
): WorkInboxSourceEntry[] {
  return getWorkInboxSources().filter((entry) => {
    if (query.kinds && !query.kinds.includes(entry.provider.kind)) return false
    if (query.moduleIds && !query.moduleIds.includes(entry.moduleId)) return false
    return isWorkInboxSourceAdmitted(entry.provider, admission)
  })
}

export function isWorkInboxOpenStatus(status: string): boolean {
  return !(WORK_INBOX_TERMINAL_STATUSES as readonly string[]).includes(status)
}

/**
 * Overdue is DERIVED, never stored: a due date in the past on an item nobody has
 * finished yet. Terminal items are never overdue however late they were closed.
 */
export function deriveWorkInboxOverdue(
  dueDate: Date | string | null | undefined,
  status: string,
  now: Date,
): boolean {
  if (!dueDate) return false
  if (!isWorkInboxOpenStatus(status)) return false
  const due = dueDate instanceof Date ? dueDate : new Date(dueDate)
  const dueMs = due.getTime()
  if (Number.isNaN(dueMs)) return false
  return dueMs < now.getTime()
}

export function normalizeWorkInboxPriority(value: unknown): WorkInboxPriority | null {
  if (typeof value !== 'string') return null
  const lowered = value.toLowerCase()
  return (WORK_INBOX_PRIORITIES as readonly string[]).includes(lowered)
    ? (lowered as WorkInboxPriority)
    : null
}

/**
 * Unprioritized work sorts with `medium`, not last: an item nobody labelled is
 * ordinary work, and sinking it below every explicit `low` would bury the whole
 * pre-Phase-4 backlog under a handful of deliberately deprioritized rows.
 */
const UNSET_PRIORITY_RANK = WORK_INBOX_PRIORITIES.indexOf('medium')

function priorityRank(priority: WorkInboxPriority | null): number {
  if (!priority) return UNSET_PRIORITY_RANK
  return WORK_INBOX_PRIORITIES.indexOf(priority)
}

function dueRank(dueDate: string | null): number {
  if (!dueDate) return Number.POSITIVE_INFINITY
  const parsed = Date.parse(dueDate)
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed
}

function createdRank(createdAt: string): number {
  const parsed = Date.parse(createdAt)
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed
}

/**
 * Canonical inbox ordering (spec §6.2): priority first, then the nearest due
 * date, then oldest first. Every tier is compared explicitly and the row id
 * breaks the final tie, so the order is total and stable across providers.
 */
export function compareWorkInboxRows(left: WorkInboxRow, right: WorkInboxRow): number {
  const byPriority = priorityRank(left.priority) - priorityRank(right.priority)
  if (byPriority !== 0) return byPriority

  const byDue = dueRank(left.dueDate) - dueRank(right.dueDate)
  if (byDue !== 0) return byDue

  const byCreated = createdRank(left.createdAt) - createdRank(right.createdAt)
  if (byCreated !== 0) return byCreated

  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

export function sortWorkInboxRows(rows: WorkInboxRow[]): WorkInboxRow[] {
  return [...rows].sort(compareWorkInboxRows)
}

/**
 * Flatten a row for the wire: the provider payload first, the common projection
 * on top. Spreading `details` UNDER the common fields is what makes a
 * `user_task` row a strict superset of the row `GET /api/workflows/tasks`
 * already returns — the enterprise "Review proposal" row action reads
 * `row.proposalId`, which lives only in the provider payload, and the common
 * fields still win wherever both define a key.
 */
export type WorkInboxWireRow = Omit<WorkInboxRow, 'details'> & Record<string, unknown>

export function serializeWorkInboxRow(row: WorkInboxRow): WorkInboxWireRow {
  const { details, ...common } = row
  return { ...details, ...common }
}
