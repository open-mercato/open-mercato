// Declare module-level custom entities (virtual) for discovery
export const entities = [
  {
    id: 'example:calendar_entity',
    label: 'Calendar Entity',
    description: 'Example virtual entity defined from module root',
    // Make it visible in the sidebar by default
    showInSidebar: true,
    // Define default fields for this custom entity; these will be installed by
    // `yarn mercato entities install` via the generator (ce.ts → customFieldSets)
    fields: [
      { key: 'title', kind: 'text', label: 'Title', required: true, indexed: true, filterable: true, formEditable: true },
      { key: 'when', kind: 'text', label: 'When', description: 'YYYY-MM-DD or free text', filterable: true, formEditable: true },
      { key: 'location', kind: 'text', label: 'Location', filterable: true, formEditable: true },
      { key: 'notes', kind: 'multiline', label: 'Notes', editor: 'markdown', formEditable: true },
    ],
  },
  // Fields previously defined in data/fields.ts are now declared here so they
  // are registered from ce.ts during `yarn mercato entities install`.
  {
    id: 'example:todo',
    label: 'Todo',
    description: 'Example Todo with custom fields',
    showInSidebar: false,
    fields: [
      // Priority value with validation and defaults
      {
        key: 'priority',
        kind: 'integer',
        label: 'Priority',
        description: '1 (low) to 5 (high)',
        defaultValue: 3,
        filterable: true,
        formEditable: true,
        validation: [
          { rule: 'required', message: 'Priority is required' },
          { rule: 'integer', message: 'Priority must be an integer' },
          { rule: 'gte', param: 1, message: 'Priority must be >= 1' },
          { rule: 'lte', param: 5, message: 'Priority must be <= 5' },
        ],
      },
      {
        key: 'severity',
        kind: 'select',
        label: 'Severity',
        options: ['low', 'medium', 'high'],
        defaultValue: 'medium',
        filterable: true,
        formEditable: true,
        validation: [
          { rule: 'required', message: 'Severity is required' },
        ],
      },
      {
        key: 'blocked',
        kind: 'boolean',
        label: 'Blocked',
        defaultValue: false,
        filterable: true,
        formEditable: true,
      },
      // Free-form labels as tags input (multi text)
      {
        key: 'labels',
        kind: 'text',
        label: 'Labels',
        multi: true,
        filterable: true,
        formEditable: true,
        input: 'tags',
        options: ['frontend', 'backend', 'ops', 'bug', 'feature'],
        optionsUrl: '/api/example/tags',
        validation: [
          { rule: 'regex', param: '^[a-z0-9_-]+$', message: 'Labels must be slug-like' },
        ],
      },
      // Rich description (markdown editor by default)
      { key: 'description', kind: 'multiline', label: 'Description', formEditable: true, editor: 'markdown' },
      // Assignees selection (multi-select) with dynamic options; render as listbox
      { key: 'assignee', kind: 'select', label: 'Assignees', multi: true, options: ['alice', 'bob', 'charlie', 'diana'], optionsUrl: '/api/example/assignees', input: 'listbox', formEditable: true },
      {
        key: 'attachments',
        kind: 'attachment',
        label: 'Attachments',
        maxAttachmentSizeMb: 10,
        acceptExtensions: ['pdf', 'jpg', 'png'],
        formEditable: true,
      },
    ],
  },
]

export default entities
