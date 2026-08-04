// Shared UI/API types for the Example module

// Item shape returned by the todos list API (via CRUD factory transform)
export type TodoListItem = {
  id: string
  title: string
  is_done?: boolean
  tenant_id?: string | null
  organization_id?: string | null
  // Optimistic-lock version token. `CrudForm` auto-derives the expected-version
  // header from `initialValues.updatedAt`; list-row mutations build it directly.
  updatedAt?: string | null
  cf_priority?: number | null
  cf_severity?: string | null
  cf_blocked?: boolean | null
  cf_labels?: string[] | null
  cf_assignee?: string | null
  cf_description?: string | null
}
