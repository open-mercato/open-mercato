/**
 * Workflows Module - External task form renderer registry (#4243)
 *
 * Spec §6.1 §6: *"**External form** […] completed as a **renderer registry**
 * keyed by formKey, receiving/returning typed context — the same mechanism
 * portal rendering (§6.4) and record-page widgets use."*
 *
 * Modeled on `registerActivityType` (`lib/activity-registry.ts`), including its
 * purity contract: no React, no MikroORM/EntityManager and no Awilix imports at
 * module scope — TYPE-ONLY imports — so the worker and the browser can both
 * load this module. `Renderer` is a component TYPE, which is a type-level
 * reference and never drags React into a server bundle.
 *
 * The registry is a lookup, never a gate: an unknown `formKey` resolves to
 * `null` and the caller degrades to the built-in form with a visible notice.
 * A blank screen is the one outcome this must never produce, so nothing here
 * throws on a miss.
 */

import type { ComponentType } from 'react'
import type { ZodTypeAny } from 'zod'

/**
 * What a renderer receives. Everything a task form could need to render itself
 * without reaching back into the workflows module — which is what makes the
 * same registry usable from the backoffice, the portal and a record-page
 * widget.
 */
export interface TaskFormRendererContext<TValues = Record<string, unknown>> {
  taskId: string
  taskName: string
  /** The key this renderer was resolved under. */
  formKey: string
  /** The authored schema, in whichever of the two accepted shapes it was written. */
  formSchema: unknown
  /** Records the task is about, as resolved at task-creation time. */
  entityBindings: unknown[] | null
  /** Decision buttons the surface will render beside the form. */
  decisions: { id: string }[]
  /** Current form values. */
  values: TValues
  /** True while a completion is in flight. */
  disabled: boolean
  /** Locale of the surrounding surface, for renderers that localize themselves. */
  locale?: string
}

/**
 * What a renderer returns: the values the task will be completed with. Called
 * on every change so the host owns the state, exactly as the built-in form does.
 */
export type TaskFormRendererChange<TValues = Record<string, unknown>> = (values: TValues) => void

export interface TaskFormRendererProps<TValues = Record<string, unknown>> {
  context: TaskFormRendererContext<TValues>
  onChange: TaskFormRendererChange<TValues>
}

export interface TaskFormRendererEntry<TValues = Record<string, unknown>> {
  formKey: string
  /** i18n key for the section heading the host renders above the form. */
  titleKey?: string
  Renderer: ComponentType<TaskFormRendererProps<TValues>>
  /** Optional shape of the values handed IN (prefill). */
  inputSchema?: ZodTypeAny
  /** Optional shape of the values handed OUT (completion payload). */
  outputSchema?: ZodTypeAny
}

const registry = new Map<string, TaskFormRendererEntry>()

/**
 * Register a renderer for one `formKey`.
 *
 * Duplicate registration throws, mirroring `registerActivityType`: two modules
 * silently fighting over one key is a bug that must surface at load time, not a
 * race whose winner depends on import order.
 */
export function registerTaskFormRenderer<TValues>(entry: TaskFormRendererEntry<TValues>): void {
  if (!entry.formKey) {
    throw new Error('[internal] Task form renderer requires a formKey')
  }
  if (registry.has(entry.formKey)) {
    throw new Error(`[internal] Task form renderer already registered: ${entry.formKey}`)
  }
  registry.set(entry.formKey, entry as TaskFormRendererEntry)
}

/** Resolve a renderer, or `null` when the key is unknown. Never throws. */
export function getTaskFormRenderer(
  formKey: string | null | undefined
): TaskFormRendererEntry | null {
  if (!formKey) return null
  return registry.get(formKey) ?? null
}

export function listTaskFormRenderers(): TaskFormRendererEntry[] {
  return Array.from(registry.values())
}

/** Test seam; not part of the module's runtime contract. */
export function clearTaskFormRenderers(): void {
  registry.clear()
}

export type TaskFormResolution =
  | { kind: 'registered'; entry: TaskFormRendererEntry }
  | { kind: 'builtin' }
  | { kind: 'missing'; formKey: string }

/**
 * What a task surface should render.
 *
 * `missing` is deliberately distinct from `builtin`: both fall back to the
 * built-in form, but only `missing` means the author asked for a renderer that
 * is not loaded — which the surface MUST say out loud instead of quietly
 * rendering something else.
 */
export function resolveTaskForm(formKey: string | null | undefined): TaskFormResolution {
  if (!formKey) return { kind: 'builtin' }
  const entry = getTaskFormRenderer(formKey)
  return entry ? { kind: 'registered', entry } : { kind: 'missing', formKey }
}
