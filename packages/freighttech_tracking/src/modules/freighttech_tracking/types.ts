// Shared UI/API types for the Example module

// Item shape returned by the todos list API (via CRUD factory transform)
export type TodoListItem = {
  id: string
  tenant_id?: string | null
  organization_id?: string | null

  
}

