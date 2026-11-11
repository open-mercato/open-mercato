/**
 * Workflows Module - Completion-surface declaration (pure, issue #7179)
 *
 * Some tasks can only be finished inside a host module's own UI flow. A step
 * declares that with `userTaskConfig.completion = { surface: 'host', href? }`,
 * and this file is the one place that decides what such a task looks like:
 *
 *  - **Resolved once, at task creation**, like every other authored task value
 *    (`lib/step-handler.ts`), and stored on `user_tasks.completion`. Resolving
 *    later would let a definition edit retro-change where a running task's links
 *    point, and the Work Inbox would need the definition per row to render one.
 *  - **Fail-closed to the task page.** An `href` that is not a same-origin
 *    relative path, or that still carries an unresolved `{{…}}` token after
 *    interpolation, is dropped — the task then deep-links to
 *    `/backend/tasks/<id>`, where the host renders through the
 *    `workflows.task.detail:context` injection spot. A link in a notification
 *    email therefore never leaves the panel origin.
 *  - **Presentation only.** The declaration removes core's generic completion
 *    affordances; it does not change who may complete the task or how. A host
 *    flow completes through the same task API and command, so the server-side
 *    completion path (and any completion guard) stays the single authority.
 *  - **`'core'` and an absent key are the same thing** and both resolve to
 *    `null`, so a definition that never declares the key behaves exactly as it
 *    did before.
 *
 * PURE: no ORM, DI, React or registry imports.
 */

export const TASK_COMPLETION_SURFACE_HOST = 'host'

/** The resolved declaration as stored on the task row and sent on the wire. */
export type TaskCompletion = {
  surface: typeof TASK_COMPLETION_SURFACE_HOST
  /** Same-origin backend path the work happens on; null renders in the injection spot. */
  href: string | null
}

const SAFE_RELATIVE_HREF = /^\/(?![/\\])\S*$/

/** A same-origin relative path with every template token resolved. */
export function isSafeTaskCompletionHref(value: unknown): value is string {
  return typeof value === 'string' && SAFE_RELATIVE_HREF.test(value) && !value.includes('{{')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/**
 * Resolve the authored declaration against the run's context.
 *
 * `interpolate` is the step handler's own resolver, so `{{context.*}}` and
 * `{{workflow.*}}` mean exactly what they mean everywhere else on a task.
 * Code-registry definitions never pass through zod, so the authored value is
 * narrowed structurally here rather than trusted.
 */
export function resolveTaskCompletion(
  authored: unknown,
  interpolate: (value: unknown) => unknown,
): TaskCompletion | null {
  const record = asRecord(authored)
  if (!record || record.surface !== TASK_COMPLETION_SURFACE_HOST) return null
  const rawHref = typeof record.href === 'string' && record.href.length > 0 ? record.href : null
  const resolved = rawHref === null ? null : interpolate(rawHref)
  return {
    surface: TASK_COMPLETION_SURFACE_HOST,
    href: isSafeTaskCompletionHref(resolved) ? resolved : null,
  }
}

/** Narrow a stored or wire value; anything that is not a host declaration is null. */
export function readTaskCompletion(value: unknown): TaskCompletion | null {
  const record = asRecord(value)
  if (!record || record.surface !== TASK_COMPLETION_SURFACE_HOST) return null
  return {
    surface: TASK_COMPLETION_SURFACE_HOST,
    href: isSafeTaskCompletionHref(record.href) ? record.href : null,
  }
}

/** Whether a host module, not core, owns this task's completion. */
export function isHostCompletedTask(completion: unknown): boolean {
  return readTaskCompletion(completion) !== null
}

/** The declared host href, when there is a usable one. */
export function resolveTaskCompletionHref(completion: unknown): string | null {
  return readTaskCompletion(completion)?.href ?? null
}
