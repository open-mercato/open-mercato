# API Data Fetching Tutorial

This tutorial demonstrates how to create data fetching API routes with authorization in the Open Mercato framework. We'll build a complete todo management system with client-side data fetching, filtering, sorting, and pagination.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Step 1: Create the API Route](#step-1-create-the-api-route)
- [Step 2: Implement Data Fetching Logic](#step-2-implement-data-fetching-logic)
- [Step 3: Add Authorization](#step-3-add-authorization)
- [Step 4: Create Client-Side Data Fetching](#step-4-create-client-side-data-fetching)
- [Step 5: Add Filtering and Sorting](#step-5-add-filtering-and-sorting)
- [Step 6: Implement Pagination](#step-6-implement-pagination)
- [Step 7: Handle Organization Names](#step-7-handle-organization-names)
- [Step 8: Create the UI Component](#step-8-create-the-ui-component)
- [Step 9: Add Error Handling](#step-9-add-error-handling)
- [Step 10: Testing](#step-10-testing)
- [Best Practices](#best-practices)

## Overview

In this tutorial, we'll create:

1. **API Route**: `/api/example/todos` with GET, POST, PUT, DELETE methods
2. **Organization API**: `/api/example/organizations` for fetching organization names
3. **Client Component**: React component with TanStack Query for data fetching
4. **Data Table**: Interactive table with filtering, sorting, and pagination
5. **Authorization**: Per-method authentication and role-based access control

## Prerequisites

- Basic understanding of React and TypeScript
- Familiarity with Next.js API routes
- Knowledge of TanStack Query (React Query)
- Understanding of the Open Mercato module system

## Step 1: Create the API Route

Create the main todos API route with per-method metadata:

```typescript
// packages/example/src/modules/example/api/todos/route.ts
import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromCookies } from '@/lib/auth/server'
import { E } from '@open-mercato/example/datamodel/entities'
import { id, title, tenant_id, organization_id, is_done } from '@open-mercato/example/datamodel/entities/todo'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { SortDir } from '@open-mercato/shared/lib/query/types'
import { z } from 'zod'

// Request validation schema
const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.string().default('id'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  title: z.string().optional(),
  severity: z.string().optional(),
  isDone: z.coerce.boolean().optional(),
  isBlocked: z.coerce.boolean().optional(),
  organizationId: z.string().uuid().optional(),
  tenantId: z.string().uuid().optional(),
})

// Per-method authorization metadata
export const metadata = {
  GET: {
    requireAuth: true,
    requireRoles: ['admin', 'user']
  },
  POST: {
    requireAuth: true,
    requireRoles: ['admin', 'superuser']
  },
  PUT: {
    requireAuth: true,
    requireRoles: ['admin']
  },
  DELETE: {
    requireAuth: true,
    requireRoles: ['superuser']
  }
}

export async function GET(request: Request) {
  try {
    const container = await createRequestContainer()
    const queryEngine = container.resolve<QueryEngine>('queryEngine')
    const auth = await getAuthFromCookies()
    
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const queryParams = querySchema.parse({
      page: url.searchParams.get('page'),
      pageSize: url.searchParams.get('pageSize'),
      sortField: url.searchParams.get('sortField'),
      sortDir: url.searchParams.get('sortDir'),
      title: url.searchParams.get('title'),
      severity: url.searchParams.get('severity'),
      isDone: url.searchParams.get('isDone'),
      isBlocked: url.searchParams.get('isBlocked'),
      organizationId: url.searchParams.get('organizationId'),
      tenantId: url.searchParams.get('tenantId'),
    })

    // Build filters
    const filters: any = {
      organization_id: auth.orgId, // Always filter by user's organization
    }

    if (queryParams.title) {
      filters.title = { $ilike: `%${queryParams.title}%` }
    }

    if (queryParams.severity) {
      filters['cf_severity'] = queryParams.severity
    }

    if (queryParams.isDone !== undefined) {
      filters.is_done = queryParams.isDone
    }

    if (queryParams.isBlocked !== undefined) {
      filters['cf_blocked'] = queryParams.isBlocked
    }

    if (queryParams.organizationId) {
      filters.organization_id = queryParams.organizationId
    }

    if (queryParams.tenantId) {
      filters.tenant_id = queryParams.tenantId
    }

    // Build sorting
    const sortField = queryParams.sortField === 'id' ? 'id' : queryParams.sortField
    const sortDir = queryParams.sortDir === 'desc' ? SortDir.DESC : SortDir.ASC

    // Query todos with pagination
    const result = await queryEngine.query('todo', {
      filters,
      sorting: [{ field: sortField, direction: sortDir }],
      pagination: {
        page: queryParams.page,
        pageSize: queryParams.pageSize,
      },
      includeCustomFields: true,
    })

    return NextResponse.json({
      items: result.items,
      total: result.total,
      page: queryParams.page,
      pageSize: queryParams.pageSize,
      totalPages: Math.ceil(result.total / queryParams.pageSize),
    })
  } catch (error) {
    console.error('Error fetching todos:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const container = await createRequestContainer()
    const queryEngine = container.resolve<QueryEngine>('queryEngine')
    const auth = await getAuthFromCookies()
    
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    
    // Validate input
    const createSchema = z.object({
      title: z.string().min(1).max(255),
      is_done: z.boolean().optional(),
      cf_priority: z.number().min(1).max(5).optional(),
      cf_severity: z.enum(['low', 'medium', 'high']).optional(),
      cf_blocked: z.boolean().optional(),
    })

    const validatedData = createSchema.parse(body)

    // Create todo
    const todo = await queryEngine.create('todo', {
      ...validatedData,
      organization_id: auth.orgId,
      tenant_id: auth.tenantId,
    })

    return NextResponse.json({ item: todo }, { status: 201 })
  } catch (error) {
    console.error('Error creating todo:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const container = await createRequestContainer()
    const queryEngine = container.resolve<QueryEngine>('queryEngine')
    const auth = await getAuthFromCookies()
    
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { id, ...updateData } = body

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

    // Update todo
    const todo = await queryEngine.update('todo', id, {
      ...updateData,
      organization_id: auth.orgId, // Ensure user can only update their org's todos
    })

    return NextResponse.json({ item: todo })
  } catch (error) {
    console.error('Error updating todo:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const container = await createRequestContainer()
    const queryEngine = container.resolve<QueryEngine>('queryEngine')
    const auth = await getAuthFromCookies()
    
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const id = url.searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

    // Delete todo
    await queryEngine.delete('todo', id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting todo:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

## Step 2: Create Organization API

Create a separate API for fetching organization names:

```typescript
// packages/example/src/modules/example/api/organizations/route.ts
import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromCookies } from '@/lib/auth/server'
import { E } from '@open-mercato/core/datamodel/entities'
import { id, name } from '@open-mercato/core/datamodel/entities/organization'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'

export const metadata = {
  GET: {
    requireAuth: true,
    requireRoles: ['admin', 'user']
  }
}

export async function GET(request: Request) {
  try {
    const container = await createRequestContainer()
    const queryEngine = container.resolve<QueryEngine>('queryEngine')
    const auth = await getAuthFromCookies()
    
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const ids = url.searchParams.get('ids')

    if (!ids) {
      return NextResponse.json({ error: 'IDs parameter is required' }, { status: 400 })
    }

    const organizationIds = ids.split(',').filter(Boolean)

    if (organizationIds.length === 0) {
      return NextResponse.json({ items: [] })
    }

    // Fetch organizations by IDs
    const organizations = await queryEngine.find('organization', {
      filters: {
        id: { $in: organizationIds }
      },
      fields: ['id', 'name']
    })

    return NextResponse.json({ items: organizations })
  } catch (error) {
    console.error('Error fetching organizations:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

## Step 3: Create Client-Side Data Fetching Component

Create a React component that uses TanStack Query for data fetching:

```typescript
// packages/example/src/modules/example/components/TodosTable.tsx
"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'

// Types
type TodoRow = {
  id: string
  title: string
  is_done?: boolean
  tenant_id?: string | null
  organization_id?: string | null
  organization_name?: string
  cf_priority?: number | null
  cf_severity?: string | null
  cf_blocked?: boolean | null
}

type TodosResponse = {
  items: TodoRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

type OrganizationsResponse = {
  items: Array<{
    id: string
    name: string
  }>
}

// Table columns
const columns: ColumnDef<TodoRow>[] = [
  {
    accessorKey: 'title',
    header: 'Title',
    cell: ({ row }) => (
      <div className="font-medium">{row.getValue('title')}</div>
    ),
  },
  {
    accessorKey: 'is_done',
    header: 'Status',
    cell: ({ row }) => (
      <span className={`px-2 py-1 rounded text-xs ${
        row.getValue('is_done') 
          ? 'bg-green-100 text-green-800' 
          : 'bg-yellow-100 text-yellow-800'
      }`}>
        {row.getValue('is_done') ? 'Done' : 'Pending'}
      </span>
    ),
  },
  {
    accessorKey: 'cf_priority',
    header: 'Priority',
    cell: ({ row }) => {
      const priority = row.getValue('cf_priority') as number | null
      if (!priority) return <span className="text-gray-400">-</span>
      
      const colors = {
        1: 'bg-red-100 text-red-800',
        2: 'bg-orange-100 text-orange-800',
        3: 'bg-yellow-100 text-yellow-800',
        4: 'bg-blue-100 text-blue-800',
        5: 'bg-green-100 text-green-800',
      }
      
      return (
        <span className={`px-2 py-1 rounded text-xs ${colors[priority as keyof typeof colors] || 'bg-gray-100 text-gray-800'}`}>
          {priority}
        </span>
      )
    },
  },
  {
    accessorKey: 'cf_severity',
    header: 'Severity',
    cell: ({ row }) => {
      const severity = row.getValue('cf_severity') as string | null
      if (!severity) return <span className="text-gray-400">-</span>
      
      const colors = {
        low: 'bg-green-100 text-green-800',
        medium: 'bg-yellow-100 text-yellow-800',
        high: 'bg-red-100 text-red-800',
      }
      
      return (
        <span className={`px-2 py-1 rounded text-xs ${colors[severity as keyof typeof colors] || 'bg-gray-100 text-gray-800'}`}>
          {severity}
        </span>
      )
    },
  },
  {
    accessorKey: 'cf_blocked',
    header: 'Blocked',
    cell: ({ row }) => {
      const blocked = row.getValue('cf_blocked') as boolean | null
      if (blocked === null) return <span className="text-gray-400">-</span>
      
      return (
        <span className={`px-2 py-1 rounded text-xs ${
          blocked 
            ? 'bg-red-100 text-red-800' 
            : 'bg-green-100 text-green-800'
        }`}>
          {blocked ? 'Yes' : 'No'}
        </span>
      )
    },
  },
  {
    accessorKey: 'organization_name',
    header: 'Organization',
    cell: ({ row }) => (
      <div className="text-sm text-gray-600">
        {row.getValue('organization_name') || 'Unknown'}
      </div>
    ),
  },
]

export default function TodosTable() {
  // State for filters and pagination
  const [title, setTitle] = React.useState('')
  const [severity, setSeverity] = React.useState('')
  const [done, setDone] = React.useState<boolean | undefined>(undefined)
  const [blocked, setBlocked] = React.useState<boolean | undefined>(undefined)
  const [orgId, setOrgId] = React.useState('')
  const [tenantId, setTenantId] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [page, setPage] = React.useState(1)

  // Build query parameters
  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({
      page: page.toString(),
      pageSize: '50',
      sortField: sorting[0]?.id || 'id',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    })

    if (title) params.set('title', title)
    if (severity) params.set('severity', severity)
    if (done !== undefined) params.set('isDone', done.toString())
    if (blocked !== undefined) params.set('isBlocked', blocked.toString())
    if (orgId) params.set('organizationId', orgId)
    if (tenantId) params.set('tenantId', tenantId)

    return params.toString()
  }, [page, sorting, title, severity, done, blocked, orgId, tenantId])

  // Fetch todos
  const { data: todosData, isLoading, error } = useQuery<TodosResponse>({
    queryKey: ['todos', queryParams],
    queryFn: async () => {
      const response = await fetch(`/api/example/todos?${queryParams}`)
      if (!response.ok) {
        throw new Error('Failed to fetch todos')
      }
      return response.json()
    },
  })

  // Extract unique organization IDs
  const organizationIds = React.useMemo(() => {
    if (!todosData?.items) return []
    return Array.from(new Set(
      todosData.items
        .map(todo => todo.organization_id)
        .filter(Boolean)
    ))
  }, [todosData?.items])

  // Fetch organization names
  const { data: orgsData } = useQuery<OrganizationsResponse>({
    queryKey: ['organizations', organizationIds],
    queryFn: async () => {
      if (organizationIds.length === 0) return { items: [] }
      
      const response = await fetch(`/api/example/organizations?ids=${organizationIds.join(',')}`)
      if (!response.ok) {
        throw new Error('Failed to fetch organizations')
      }
      return response.json()
    },
    enabled: organizationIds.length > 0,
  })

  // Create organization name map
  const orgMap = React.useMemo(() => {
    if (!orgsData?.items) return {}
    return orgsData.items.reduce((acc, org) => {
      acc[org.id] = org.name
      return acc
    }, {} as Record<string, string>)
  }, [orgsData?.items])

  // Merge todos with organization names
  const todosWithOrgNames = React.useMemo(() => {
    if (!todosData?.items) return []
    return todosData.items.map(todo => ({
      ...todo,
      organization_name: todo.organization_id ? orgMap[todo.organization_id] : undefined
    }))
  }, [todosData?.items, orgMap])

  // Handle sorting change
  const handleSortingChange = (updaterOrValue: SortingState | ((old: SortingState) => SortingState)) => {
    setSorting(typeof updaterOrValue === 'function' ? updaterOrValue(sorting) : updaterOrValue)
    setPage(1) // Reset to first page when sorting changes
  }

  // Handle filter reset
  const handleReset = () => {
    setTitle('')
    setSeverity('')
    setDone(undefined)
    setBlocked(undefined)
    setOrgId('')
    setTenantId('')
    setPage(1)
  }

  // Toolbar component
  const toolbar = (
    <div className="flex flex-wrap gap-4 p-4 border-b">
      <div className="flex-1 min-w-64">
        <input
          type="text"
          placeholder="Search by title..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      
      <select
        value={severity}
        onChange={(e) => setSeverity(e.target.value)}
        className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">All Severities</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>

      <select
        value={done === undefined ? '' : done.toString()}
        onChange={(e) => setDone(e.target.value === '' ? undefined : e.target.value === 'true')}
        className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">All Status</option>
        <option value="false">Pending</option>
        <option value="true">Done</option>
      </select>

      <select
        value={blocked === undefined ? '' : blocked.toString()}
        onChange={(e) => setBlocked(e.target.value === '' ? undefined : e.target.value === 'true')}
        className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">All Blocked</option>
        <option value="false">Not Blocked</option>
        <option value="true">Blocked</option>
      </select>

      <Button onClick={handleReset} variant="outline">
        Reset Filters
      </Button>
    </div>
  )

  if (isLoading) {
    return <div className="p-8 text-center">Loading todos...</div>
  }

  if (error) {
    return (
      <div className="p-8 text-center text-red-600">
        Error loading todos: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    )
  }

  return (
    <DataTable
      columns={columns}
      data={todosWithOrgNames}
      toolbar={toolbar}
      sortable
      sorting={sorting}
      onSortingChange={handleSortingChange}
      pagination={{
        page,
        pageSize: 50,
        total: todosData?.total || 0,
        totalPages: todosData?.totalPages || 0,
        onPageChange: setPage,
      }}
    />
  )
}
```

## Step 4: Create the Backend Page

Create the backend page that uses the client component:

```typescript
// packages/example/src/modules/example/backend/todos/page.tsx
import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'
import TodosTable from '../../components/TodosTable'

export default function ExampleTodosPage() {
  return (
    <Page>
      <PageHeader 
        title="Todos" 
        description="Example todos with custom fields (priority, severity, blocked)" 
      />
      <PageBody>
        <TodosTable />
      </PageBody>
    </Page>
  )
}
```

## Step 5: Add Page Metadata

Create metadata for the page:

```typescript
// packages/example/src/modules/example/backend/todos/page.meta.ts
export const metadata = {
  requireAuth: true,
  requireRoles: ['admin'] as const,
  pageTitle: 'Todos',
  pageGroup: 'Example',
  pageOrder: 20,
  icon: 'CheckSquare',
}
```

## Step 6: Add Navigation Link

Add a link to the todos page in your backend navigation:

```typescript
// packages/example/src/modules/example/backend/page.tsx
import Link from 'next/link'

export default function ExampleBackendPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Example Module</h1>
      <p className="text-gray-600 mb-6">
        This is an example backend page demonstrating various features.
      </p>
      
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Available Pages:</h2>
        <ul className="list-disc list-inside text-sm">
          <li>
            <Link className="underline" href="/backend/products">
              Products list
            </Link>
          </li>
          <li>
            <Link className="underline" href="/backend/todos">
              Todos list
            </Link>
          </li>
        </ul>
      </div>
    </div>
  )
}
```

## Step 7: Set Up TanStack Query Provider

Make sure your app has the TanStack Query provider set up:

```typescript
// src/app/layout.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

const queryClient = new QueryClient()

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <QueryClientProvider client={queryClient}>
          {children}
          <ReactQueryDevtools initialIsOpen={false} />
        </QueryClientProvider>
      </body>
    </html>
  )
}
```

## Step 8: Testing

### Test the API Endpoints

```bash
# Test GET todos (should return 401 without auth)
curl -X GET "http://localhost:3001/api/example/todos?page=1&pageSize=10"

# Test with authentication (after logging in)
curl -X GET "http://localhost:3001/api/example/todos?page=1&pageSize=10" \
  -H "Cookie: auth_token=your_jwt_token"

# Test POST (should require superuser role)
curl -X POST "http://localhost:3001/api/example/todos" \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_token=your_jwt_token" \
  -d '{"title": "New Todo", "cf_priority": 3}'
```

### Test the Frontend

1. Navigate to `/backend/todos`
2. Verify authentication is required
3. Test filtering by title, severity, status, and blocked status
4. Test sorting by different columns
5. Test pagination
6. Verify organization names are displayed instead of IDs

## Best Practices

### 1. Error Handling

Always handle errors gracefully in both API routes and client components:

```typescript
// API Route
try {
  // Your logic here
  return NextResponse.json({ data: result })
} catch (error) {
  console.error('API Error:', error)
  return NextResponse.json(
    { error: 'Internal Server Error' }, 
    { status: 500 }
  )
}

// Client Component
const { data, error, isLoading } = useQuery({
  queryKey: ['todos'],
  queryFn: fetchTodos,
  onError: (error) => {
    console.error('Query Error:', error)
    // Show user-friendly error message
  }
})
```

### 2. Input Validation

Always validate input data:

```typescript
const schema = z.object({
  title: z.string().min(1).max(255),
  priority: z.number().min(1).max(5).optional(),
})

const validatedData = schema.parse(body)
```

### 3. Authorization

Use per-method metadata for fine-grained control:

```typescript
export const metadata = {
  GET: { requireAuth: true, requireRoles: ['admin', 'user'] },
  POST: { requireAuth: true, requireRoles: ['admin'] },
  DELETE: { requireAuth: true, requireRoles: ['superuser'] }
}
```

### 4. Performance

- Use pagination for large datasets
- Implement proper caching with TanStack Query
- Use `useMemo` and `useCallback` for expensive operations
- Consider virtual scrolling for very large lists

### 5. Type Safety

Define proper TypeScript types:

```typescript
interface TodoResponse {
  items: Todo[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

interface Todo {
  id: string
  title: string
  is_done: boolean
  organization_id: string
  cf_priority?: number
  cf_severity?: 'low' | 'medium' | 'high'
  cf_blocked?: boolean
}
```

### 6. Security

- Always filter by user's organization
- Validate all input data
- Use proper authentication and authorization
- Never expose sensitive data in API responses

This tutorial provides a complete example of creating data fetching API routes with authorization in the Open Mercato framework. The system supports filtering, sorting, pagination, and per-method authentication, making it suitable for production use.
