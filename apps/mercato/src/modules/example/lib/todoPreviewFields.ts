/**
 * Registry behind the `example.todo-preview-fields` generator plugin.
 *
 * A generator plugin is the module-level extension point for cases where the
 * contribution has to be *statically aggregated at build time* rather than resolved
 * through DI: any enabled module drops `example-todo-preview-fields.ts` at its own
 * module root, `generators.ts` teaches `mercato generate` how to collect them, and
 * the generated `bootstrap-registrations.generated.ts` calls
 * `registerTodoPreviewFieldEntries` here. No module edits another module's source and
 * `bootstrap.ts` never learns about the contributors.
 *
 * State lives on `globalThis` for the same reason the shared nav-order override does:
 * the writer is generated app code and the reader is module source, and a standalone
 * build can hold more than one instance of this module's compiled output. A
 * module-local `let` would be invisible across those instances.
 *
 * Registration happens in `src/bootstrap.ts` (`runBootstrapRegistrations()`), which
 * the Next.js server runtime runs. The worker/CLI bootstrap
 * (`bootstrapFromAppRoot`) does NOT run it, so only consumers on the request path may
 * depend on this registry — here that is the message-object preview loader, which is
 * server-render-only by construction.
 */
import type { Todo } from '../data/entities'

const TODO_PREVIEW_FIELDS_KEY = '__exampleTodoPreviewFields__'

export type TodoPreviewSubject = Pick<Todo, 'id' | 'title' | 'isDone' | 'organizationId'>

export type TodoPreviewFieldContext = {
  translate: (key: string) => string
}

export type TodoPreviewField = {
  id: string
  labelKey: string
  render: (todo: TodoPreviewSubject, context: TodoPreviewFieldContext) => string | null
}

export type TodoPreviewFieldModuleEntry = {
  moduleId: string
  fields: TodoPreviewField[]
}

type GlobalState = typeof globalThis & {
  [TODO_PREVIEW_FIELDS_KEY]?: TodoPreviewFieldModuleEntry[]
}

/**
 * Replaces rather than appends: `runBootstrapRegistrations()` can run more than once
 * per process (module reload in dev), and appending would duplicate every row.
 */
export function registerTodoPreviewFieldEntries(entries: TodoPreviewFieldModuleEntry[]): void {
  const globalState = globalThis as GlobalState
  globalState[TODO_PREVIEW_FIELDS_KEY] = entries.map((entry) => ({
    moduleId: entry.moduleId,
    fields: [...(entry.fields ?? [])],
  }))
}

export function listTodoPreviewFields(): TodoPreviewField[] {
  const globalState = globalThis as GlobalState
  return (globalState[TODO_PREVIEW_FIELDS_KEY] ?? []).flatMap((entry) => entry.fields)
}

export function clearTodoPreviewFieldEntries(): void {
  const globalState = globalThis as GlobalState
  delete globalState[TODO_PREVIEW_FIELDS_KEY]
}

/**
 * Renders the registered contributions into the `metadata` map a message-object
 * preview shows. A contribution that returns `null` is omitted, and the first
 * contribution to claim a label wins so a later module cannot silently overwrite an
 * earlier row.
 */
export function buildTodoPreviewMetadata(
  todo: TodoPreviewSubject,
  context: TodoPreviewFieldContext,
): Record<string, string> {
  const metadata: Record<string, string> = {}
  for (const field of listTodoPreviewFields()) {
    const value = field.render(todo, context)
    if (value === null) continue
    const label = context.translate(field.labelKey)
    if (Object.hasOwn(metadata, label)) continue
    metadata[label] = value
  }
  return metadata
}
