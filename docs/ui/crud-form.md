# CrudForm

A lightweight, extensible form component for admin CRUD pages. It supports validation via Zod, mobile-first fullscreen UX, inline help, a header with back navigation, and richer editors like tags, rich text, and relations. You can also embed fully custom React components per field.

## Basic usage

```tsx
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { z } from 'zod'

const schema = z.object({
  title: z.string().min(1, 'Title is required'),
  is_done: z.boolean().optional(),
})

const fields: CrudField[] = [
  { id: 'title', label: 'Title', type: 'text', required: true, description: 'A clear summary of the task' },
  { id: 'is_done', label: 'Done', type: 'checkbox' },
]

<CrudForm
  title="Create Todo"
  backHref="/backend/todos"
  schema={schema}
  fields={fields}
  submitLabel="Create"
  cancelHref="/backend/todos"
  successRedirect="/backend/todos"
  onSubmit={async (values) => { /* ... */ }}
/>
```

## Props
- `schema`: Zod schema for validation.
- `fields`: Array of field descriptors (see below).
- `initialValues`: Initial values map.
- `submitLabel`: Submit button label.
- `cancelHref`: Optional cancel link.
- `successRedirect`: Navigate on success.
- `onSubmit(values)`: Submit handler (sync or async).
- `twoColumn`: When `true`, uses a two-column grid on desktop.
- `title`: Header title (shown on all breakpoints).
- `backHref`: Back link URL in the header.

## Field types
Built-in `type` values:
- `text`, `number`, `date`, `textarea`, `checkbox`
- `select` (with `options` or async `loadOptions`)
- `tags` (simple tags input; press Enter or comma to add)
- `richtext` (basic contenteditable runtime with HTML value)
- `relation` (searchable list; client-side filter)
- `custom` (render custom React component)

Common field properties:
- `id`: Field key in values map.
- `label`: Human-readable label.
- `required`: When `true`, renders an asterisk and validate via `schema`.
- `placeholder`: Optional placeholder.
- `description`: Inline field help below the input.

Select/relation properties:
- `options: { value: string; label: string }[]`
- `loadOptions?: () => Promise<{ value: string; label: string }[]>` (merged with `options` when loaded)

## Custom field renderer
Use `type: 'custom'` to embed your own React component:

```tsx
const fields: CrudField[] = [
  {
    id: 'assignee',
    label: 'Assignee',
    type: 'custom',
    component: ({ value, setValue, error, autoFocus }) => (
      <MyUserPicker value={value} onChange={setValue} autoFocus={autoFocus} error={error} />
    ),
  },
]
```

The component receives `{ id, value, setValue, error, autoFocus }`.

## Mobile UX
- On small screens the form is fullscreen with a sticky header that shows the `title` and a `backHref` link.
- On desktop it renders as a standard card with border and padding.
- The first field is auto-focused on mount for fast entry.

## Validation
Provide a Zod schema via `schema`. Field-level errors are displayed under each field; a general form error (from `onSubmit`) shows above actions.

## Notes
- Keep field validation in Zod; mark `required: true` for labels only (the schema drives actual validation).
- Prefer simple value shapes for portability (e.g., tags as `string[]`, relations as a single foreign key `string`).
