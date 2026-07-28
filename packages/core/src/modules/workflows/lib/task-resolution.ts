import type {
  TaskDecision,
  TaskEntityBinding,
  TaskLocalizedString,
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
 */
export function resolveTaskAssignment(
  config: Pick<UserTaskConfig, 'assignedTo' | 'assignedToRoles'>,
  interpolate: TaskInterpolate
): ResolvedTaskAssignment {
  const authoredRoles = config.assignedToRoles?.length ? config.assignedToRoles : null

  if (Array.isArray(config.assignedTo)) {
    return {
      assignedTo: null,
      assignedToRoles: config.assignedTo.length ? config.assignedTo : authoredRoles,
      fellBackToRoles: false,
    }
  }

  if (typeof config.assignedTo !== 'string' || !config.assignedTo.length) {
    return { assignedTo: null, assignedToRoles: authoredRoles, fellBackToRoles: false }
  }

  const resolved = toResolvedString(interpolate(config.assignedTo))
  if (resolved) {
    return { assignedTo: resolved, assignedToRoles: authoredRoles, fellBackToRoles: false }
  }

  return { assignedTo: null, assignedToRoles: authoredRoles, fellBackToRoles: true }
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
