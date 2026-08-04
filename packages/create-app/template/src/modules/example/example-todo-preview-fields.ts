/**
 * This module's own contribution to the `example.todo-preview-fields` generator plugin
 * declared in `generators.ts`.
 *
 * The file name is the plugin's `conventionFile`, so it is discovered by convention at
 * the module ROOT — not under `lib/` or `widgets/`. Any other enabled module adds the
 * same file name at its own root to contribute rows here; nothing imports this file
 * directly, `mercato generate` aggregates it.
 *
 * Keep contributions cheap and synchronous: they render inside a message-object
 * preview and every `labelKey` must already exist in the contributing module's locale
 * files.
 */
import type { TodoPreviewField } from './lib/todoPreviewFields'

export const todoPreviewFields: TodoPreviewField[] = [
  {
    id: 'example.owning-organization',
    labelKey: 'example.todos.table.column.organization',
    render: (todo, { translate }) =>
      todo.organizationId ?? translate('example.todos.table.organization.none'),
  },
]

export default todoPreviewFields
