import type {
  TaskDecision,
  TaskEntityBinding,
  TaskLocalizedString,
  UserTaskAssigneeKind,
  UserTaskConfig,
} from '../data/validators'

/**
 * Resolving what a task author wrote into what a task actually says.
 *
 * PURE by construction (no ORM, DI, React or registry imports): the caller
 * supplies an `interpolate` function, which in the engine is the Phase-2b
 * `interpolateVariables` bound to the instance context. That keeps every rule
 * here unit-testable without a workflow, and lets the task surfaces re-resolve
 * copy with the same code the engine used at creation time.
 *
 * Interpolation is deliberately LENIENT here, never strict. A dynamic assignee
 * that resolves to nothing is not an error — it is exactly the case the spec's
 * mandatory fallback role exists for, and failing the step instead would strand
 * the run over a piece of copy.
 */

export type TaskInterpolate = (value: unknown) => unknown

export interface ResolvedTaskEntityBinding {
  entityType: string
  entityId: string
  label?: TaskLocalizedString
}

export interface ResolvedTaskAssignment {
  assignedTo: string | null
  assignedToRoles: string[] | null
  /** True when a dynamic assignee was authored and resolved to nothing. */
  fellBackToRoles: boolean
  /**
   * Which principal namespace `assignedTo` names — the `user_tasks.assignee_kind`
   * discriminator, decided here so every creation site gets the same answer.
   *
   * `'customer'` requires BOTH that the author asked for it AND that an
   * individual assignee actually resolved. A customer-addressed task with no
   * assignee is unaddressable: portal principals cannot claim from a queue, and
   * the portal branch of the visibility predicate has no arm that would ever
   * admit it.
   */
  assigneeKind: UserTaskAssigneeKind
  /**
   * True when the author asked for a portal assignee and the dynamic id resolved
   * to nothing, so the task fell back to the authored backoffice role queue.
   * Worth a log line: the work is still reachable, but by a different audience
   * than the author intended.
   */
  fellBackFromCustomer: boolean
}

export interface ResolvedTaskDecision {
  id: string
  label: TaskLocalizedString
  transitionId: string
  style?: TaskDecision['style']
}

const TOKEN_PATTERN = /\{\{[^}]+\}\}/

function isUnresolved(value: unknown): boolean {
  return typeof value === 'string' && TOKEN_PATTERN.test(value)
}

function toResolvedString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed.length || isUnresolved(trimmed)) return null
    return trimmed
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

/**
 * Resolve author copy that may be a plain string or a per-locale map. Every
 * leaf goes through the interpolator, so a pill works in either shape.
 */
export function resolveTaskText(
  value: TaskLocalizedString | undefined | null,
  interpolate: TaskInterpolate
): TaskLocalizedString | null {
  if (value == null) return null
  if (typeof value === 'string') {
    const resolved = interpolate(value)
    return typeof resolved === 'string' ? resolved : String(resolved ?? '')
  }
  const resolved: Record<string, string> = {}
  for (const [locale, text] of Object.entries(value)) {
    const localeValue = interpolate(text)
    resolved[locale] = typeof localeValue === 'string' ? localeValue : String(localeValue ?? '')
  }
  return resolved
}

/**
 * Flatten localized copy onto the single text column a `UserTask` has. Prefers
 * the requested locale, then the first declared one — a task must never render
 * blank because its author wrote only one locale.
 */
export function flattenTaskText(
  value: TaskLocalizedString | null | undefined,
  locale?: string
): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value.length ? value : null
  if (locale && typeof value[locale] === 'string' && value[locale].length) return value[locale]
  for (const text of Object.values(value)) {
    if (typeof text === 'string' && text.length) return text
  }
  return null
}

/**
 * Resolve the assignment the author configured.
 *
 * A `Dynamic` assignment is a pill in `assignedTo` (`{{context.deal.ownerId}}`).
 * When it resolves to nothing — the path is missing, the value is empty, or the
 * token survived interpolation unchanged — the task falls to the authored role
 * queue rather than being created with nobody able to see it. That queue IS the
 * spec's mandatory fallback role; the inspector is what makes it mandatory.
 *
 * The legacy array form of `assignedTo` keeps meaning "these are roles".
 *
 * ## `assigneeKind`
 *
 * `userTaskConfig.assigneeKind: 'customer'` is what addresses a task to a PORTAL
 * principal — the id in `assignedTo` is then a `CustomerUser.id`, not a
 * backoffice user id, and only the portal routes can see or complete it. It is
 * honoured only when an individual assignee actually resolves, and it forces
 * `assignedToRoles` to null: portal roles are a different namespace
 * (`CustomerRole`), a backoffice role queue on a customer-addressed row would
 * offer the work to an audience that can never reach it, and design §7.1 makes
 * that combination an invariant rather than a preference.
 *
 * Absent (every definition authored before this existed), the answer is `'user'`
 * — which is exactly what those rows have always meant.
 */
export function resolveTaskAssignment(
  config: Pick<UserTaskConfig, 'assignedTo' | 'assignedToRoles' | 'assigneeKind'>,
  interpolate: TaskInterpolate
): ResolvedTaskAssignment {
  const authoredRoles = config.assignedToRoles?.length ? config.assignedToRoles : null
  const wantsCustomer = config.assigneeKind === 'customer'

  if (Array.isArray(config.assignedTo)) {
    return {
      assignedTo: null,
      assignedToRoles: config.assignedTo.length ? config.assignedTo : authoredRoles,
      fellBackToRoles: false,
      assigneeKind: 'user',
      fellBackFromCustomer: wantsCustomer,
    }
  }

  if (typeof config.assignedTo !== 'string' || !config.assignedTo.length) {
    return {
      assignedTo: null,
      assignedToRoles: authoredRoles,
      fellBackToRoles: false,
      assigneeKind: 'user',
      fellBackFromCustomer: wantsCustomer,
    }
  }

  const resolved = toResolvedString(interpolate(config.assignedTo))
  if (resolved) {
    return {
      assignedTo: resolved,
      assignedToRoles: wantsCustomer ? null : authoredRoles,
      fellBackToRoles: false,
      assigneeKind: wantsCustomer ? 'customer' : 'user',
      fellBackFromCustomer: false,
    }
  }

  return {
    assignedTo: null,
    assignedToRoles: authoredRoles,
    fellBackToRoles: true,
    assigneeKind: 'user',
    fellBackFromCustomer: wantsCustomer,
  }
}

/**
 * Resolve each binding's `idPath` against the run context.
 *
 * A binding whose id does not resolve is DROPPED, not carried as a dangling
 * reference: the ledger marks plenty of paths `maybe`-presence, so an absent
 * record is an ordinary outcome and a task about "order #undefined" is worse
 * than a task about nothing. `unresolved` names what was dropped so the caller
 * can log it.
 */
export function resolveTaskEntityBindings(
  bindings: TaskEntityBinding[] | undefined | null,
  interpolate: TaskInterpolate
): { bindings: ResolvedTaskEntityBinding[]; unresolved: string[] } {
  if (!bindings?.length) return { bindings: [], unresolved: [] }

  const resolvedBindings: ResolvedTaskEntityBinding[] = []
  const unresolved: string[] = []

  for (const binding of bindings) {
    const expression = TOKEN_PATTERN.test(binding.idPath) ? binding.idPath : `{{${binding.idPath}}}`
    const entityId = toResolvedString(interpolate(expression))
    if (!entityId) {
      unresolved.push(binding.idPath)
      continue
    }
    const label = resolveTaskText(binding.label, interpolate)
    resolvedBindings.push({
      entityType: binding.entityType,
      entityId,
      ...(label != null ? { label } : {}),
    })
  }

  return { bindings: resolvedBindings, unresolved }
}

/**
 * The distinct AUTHORED entity types across a task's resolved bindings, for the
 * denormalized `user_tasks.entity_types` column the §6.4 entity gate filters on.
 *
 * Verbatim, deduped, order-preserving. Verbatim because the visibility
 * predicate's per-request access map is keyed on exactly the string the binding
 * carries — normalizing here would give the SQL filter and the JS predicate two
 * different notions of "the same type".
 *
 * Empty in, empty out: the caller stores NULL for a task about nothing, which is
 * what the vacuous-pass rule reads. Same expression the work-inbox projection
 * already computes per row, so a row's stored column and its projected
 * `entityTypes` cannot disagree.
 */
export function collectResolvedEntityTypes(
  bindings: readonly ResolvedTaskEntityBinding[],
): string[] {
  return [...new Set(bindings.map((binding) => binding.entityType))]
}

/** Resolve decision-button copy; the route binding itself is already durable. */
export function resolveTaskDecisions(
  decisions: TaskDecision[] | undefined | null,
  interpolate: TaskInterpolate
): ResolvedTaskDecision[] {
  if (!decisions?.length) return []
  return decisions.map((decision) => ({
    id: decision.id,
    label: resolveTaskText(decision.label, interpolate) ?? decision.id,
    transitionId: decision.transitionId,
    ...(decision.style ? { style: decision.style } : {}),
  }))
}

/**
 * The authored deadline duration. `deadline` is the business-word superset;
 * `slaDuration` is the original bare-duration form and keeps working forever.
 */
export function resolveTaskDeadlineDuration(
  config: Pick<UserTaskConfig, 'deadline' | 'slaDuration'>
): string | null {
  const duration = config.deadline?.duration ?? config.slaDuration
  return typeof duration === 'string' && duration.length ? duration : null
}
