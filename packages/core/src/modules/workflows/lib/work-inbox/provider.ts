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
 */
export type WorkInboxScope = {
  tenantId: string
  organizationIds: string[] | null
  userId: string
  roles: string[]
}

/**
 * Runtime seam. Providers resolve their own services through it rather than
 * importing them, so a provider registered by another module never drags that
 * module's internals into this one. Structural on purpose — no awilix import.
 */
export type WorkInboxSourceContext = {
  scope: WorkInboxScope
  resolve: <T>(name: string) => T
}

export type WorkInboxSourceResult = {
  rows: WorkInboxRow[]
  total: number
}

export type WorkInboxSourceProvider = {
  kind: string
  moduleId: string
  /** Injection spot id the detail view renders for this kind, when any. */
  render?: string
  actions?: WorkInboxAction[]
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
 * Providers that can contribute to this query. Kind and module narrowing is
 * answered here rather than inside each provider so a filtered request does not
 * pay for a query per excluded source.
 */
export function selectWorkInboxSources(query: WorkInboxQuery): WorkInboxSourceEntry[] {
  return getWorkInboxSources().filter((entry) => {
    if (query.kinds && !query.kinds.includes(entry.provider.kind)) return false
    if (query.moduleIds && !query.moduleIds.includes(entry.moduleId)) return false
    return true
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
