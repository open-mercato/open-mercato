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
- `entityId`: When set, CrudForm fetches module custom field definitions for this entity and auto-appends fields marked `formEditable`. This keeps forms in sync with dynamic custom fields without hardcoding them.
- `onDelete()`: Optional delete handler; when provided, a Delete button appears at the top and bottom of the form.
- `twoColumn`: When `true`, uses a two-column grid on desktop. Prefer `groups` for richer two-column layouts.
- `groups`: Optional grouped layout rendered as two responsive columns (1 on mobile). Each group can target column 1 or 2, have a title, own field list, and embed a custom component. A special `kind: 'customFields'` group renders module-defined custom fields for the `entityId`.
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

## Grouped layout (two columns)

```tsx
import type { CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'

const groups: CrudFormGroup[] = [
  { id: 'details', title: 'Details', column: 1, fields: ['title'] },
  { id: 'status', title: 'Status', column: 2, fields: ['is_done'] },
  { id: 'attributes', title: 'Attributes', column: 2, kind: 'customFields' },
  {
    id: 'info',
    title: 'Info',
    column: 2,
    component: ({ values }) => <pre className="text-xs">{JSON.stringify(values, null, 2)}</pre>,
  },
]

<CrudForm
  entityId="example:todo"
  fields={[ /* base fields */ ]}
  groups={groups}
  onDelete={async () => {
    // await DELETE; then redirect with flash message
    router.push('/backend/todos?flash=' + encodeURIComponent('Record has been removed') + '&type=success')
  }}
/>
```

Behavior:
- Renders two columns on large screens, and one stacked column on mobile.
- A group may contain `fields` as ids referencing the `fields` prop, inline field configs, or a mix.
- `kind: 'customFields'` includes the module-defined custom fields and respects an optional group `title`.
- `component` lets you inject custom React content into the group (e.g., action buttons, previews).

## Mobile UX
- On small screens the form is fullscreen with a sticky header that shows the `title` and a `backHref` link.
- On desktop it renders as a standard card with border and padding.
- Focus is not auto-forced; the browser manages focus normally.

## Validation
Provide a Zod schema via `schema`. Field-level errors are displayed under each field; a general form error (from `onSubmit`) shows above actions.

## Notes
- Keep field validation in Zod; mark `required: true` for labels only (the schema drives actual validation).
- Prefer simple value shapes for portability (e.g., tags as `string[]`, relations as a single foreign key `string`).

## Custom Fields → Editors and Inputs
When `entityId` is provided, custom fields are fetched from `/api/custom_fields/definitions` and rendered automatically:

- `kind: 'boolean'` → checkbox
- `kind: 'integer'|'float'` → number input
- `kind: 'select'` → select; `multi: true` renders multi-select checkboxes
- `kind: 'text'` + `multi: true` → tags input (free-form tagging)
- `kind: 'multiline'` → rich text area; you can choose the editor via definition `configJson.editor`:
  - `markdown` → UIW Markdown editor
  - `simpleMarkdown` → Simple toolbar markdown textarea
  - `htmlRichText` → ContentEditable rich text (HTML value)

Declare these hints via the DSL in your module:

```ts
defineFields(E.example.todo, [
  cf.text('labels', { label: 'Labels', multi: true, input: 'tags' }),
  cf.multiline('description', { label: 'Description', editor: 'markdown' }),
])
```
