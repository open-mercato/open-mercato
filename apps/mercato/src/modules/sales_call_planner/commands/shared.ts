/**
 * Pure helpers behind the idempotent ensure-task command.
 *
 * The file is named `shared.ts` deliberately: the command generator scans
 * `commands/*.ts` and emits a lazy loader per file, skipping exactly the
 * basenames `index`, `shared` and `factory`
 * (`packages/cli/src/lib/generators/module-registry.ts`). A helper module that
 * registers no command belongs in one of those names, or `yarn generate` mints
 * a loader that imports it for nothing.
 */

import { createHash } from 'node:crypto'
import { taskPriorities } from '../data/validators'

/**
 * Derived here rather than added to `data/validators.ts`: that file already
 * exports the `taskPriorities` tuple this reads, so the alias costs nothing and
 * keeps B3 out of a file two other tasks are reading.
 */
export type TaskPriority = (typeof taskPriorities)[number]

/**
 * Fixed namespace for every id this module derives. A v5 uuid is
 * `sha1(namespace || name)`, so the namespace is what keeps these ids from
 * colliding with anybody else's derivation of the same name — and it MUST NOT
 * change: rotating it re-points every future retry at fresh rows and the
 * idempotency guarantee evaporates for runs already in flight.
 */
export const SALES_CALL_PLANNER_ID_NAMESPACE = '6f3a1c8e-2d4b-4f7a-9c15-3b8e0d5a7f42'

/**
 * RFC 4122 §4.3 name-based uuid, SHA-1 flavour.
 *
 * Hand-rolled over `node:crypto` rather than pulled from `uuid`: no workspace
 * in this repo depends on that package (the root `package.json` only pins
 * resolutions for transitive copies), and adding a production dependency is an
 * Ask-First surface. The algorithm is twelve lines and fully specified, so the
 * dependency would buy nothing but its own upgrade surface.
 */
export function deriveUuidV5(name: string, namespace: string): string {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex')
  if (namespaceBytes.length !== 16) {
    throw new Error(`[internal] uuid namespace must be a uuid, received: ${namespace}`)
  }
  const digest = createHash('sha1').update(namespaceBytes).update(Buffer.from(name, 'utf8')).digest()
  const bytes = Buffer.from(digest.subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

/**
 * The idempotency key. All three halves are load-bearing:
 *
 *  - `workflowInstanceId` — two runs of the same workflow over the same company
 *    are two genuinely different briefings and must not overwrite each other.
 *  - `stepId` — two `UPDATE_ENTITY` nodes in one definition must not collide.
 *  - `index` — the element's position in the batch, because a transition
 *    activity runs ONCE for the whole `tasks` array.
 *
 * The separator is `:` and the parts never contain one that would be ambiguous:
 * the first two are a uuid and a step id, the third an integer.
 */
export function buildEnsureTaskIdName(workflowInstanceId: string, stepId: string, index: number): string {
  return `${workflowInstanceId}:${stepId}:${index}`
}

export function deriveEnsureTaskId(workflowInstanceId: string, stepId: string, index: number): string {
  return deriveUuidV5(
    buildEnsureTaskIdName(workflowInstanceId, stepId, index),
    SALES_CALL_PLANNER_ID_NAMESPACE,
  )
}

/**
 * The agent speaks `low | medium | high | urgent` because that is what a model
 * answers reliably and what can be read aloud; `customer_interactions.priority`
 * is `int` constrained to 0-100 by `interactionCreateSchema`. Higher is more
 * urgent — the direction the CRM's own priority fields already use (the example
 * module documents its scale as "1 (low) to 5 (high)").
 *
 * The four anchors are evenly spaced across the band rather than crowded at the
 * top, so a human editing the number afterwards can sit a task between two
 * spoken levels without leaving the range, and `urgent` still reads as the
 * ceiling. A task whose priority the agent did not state stays `null` —
 * "unspecified" and "low" are different facts and defaulting would invent one.
 */
export const TASK_PRIORITY_SCORES: Record<TaskPriority, number> = {
  low: 25,
  medium: 50,
  high: 75,
  urgent: 100,
}

export function toInteractionPriority(priority: TaskPriority | undefined): number | null {
  return priority ? TASK_PRIORITY_SCORES[priority] : null
}
