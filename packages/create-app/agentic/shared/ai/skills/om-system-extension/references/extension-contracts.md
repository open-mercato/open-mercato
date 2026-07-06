# UMES Extension Contracts — Type Reference

Complete TypeScript type definitions for all extension mechanisms.

## ResponseEnricher

```typescript
interface ResponseEnricher<TRecord = any, TEnriched = any> {
  id: string
  targetEntity: string
  features?: string[]
  priority?: number            // Higher = runs first. Default: 0
  timeout?: number             // Max ms before skip. Default: 2000
  fallback?: Record<string, unknown>
  critical?: boolean           // Propagate errors? Default: false
  disabledTenantIds?: string[]
  cache?: {
    strategy: 'read-through'
    ttl: number
    tags?: string[]
    invalidateOn?: string[]
  }
  queryEngine?: {
    enabled: boolean
    engines?: Array<'basic' | 'hybrid'>
    applyOn?: Array<'list' | 'detail'>
  }

  enrichOne(record: TRecord, context: EnricherContext): Promise<TRecord & TEnriched>
  enrichMany?(records: TRecord[], context: EnricherContext): Promise<(TRecord & TEnriched)[]>
}

interface EnricherContext {
  organizationId: string
  tenantId: string
  userId: string
  em: EntityManager
  container: AwilixContainer
  requestedFields?: string[]
  userFeatures?: string[]
}
```

## ApiInterceptor

```typescript
type ApiInterceptorMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

type InterceptorRequest = {
  method: ApiInterceptorMethod
  url: string
  body?: Record<string, unknown>
  query?: Record<string, unknown>
  headers: Record<string, string>
}

type InterceptorResponse = {
  statusCode: number
  body: Record<string, unknown>
  headers: Record<string, string>
}

type InterceptorContext = {
  userId: string
  organizationId: string
  tenantId: string
  em: EntityManager
  container: AwilixContainer
  userFeatures?: string[]
  metadata?: Record<string, unknown>
}

type InterceptorBeforeResult = {
  ok: boolean
  body?: Record<string, unknown>
  query?: Record<string, unknown>
  headers?: Record<string, string>
  message?: string
  statusCode?: number
  metadata?: Record<string, unknown>
}

type InterceptorAfterResult = {
  merge?: Record<string, unknown>
  replace?: Record<string, unknown>
}

type ApiInterceptor = {
  id: string
  targetRoute: string
  methods: ApiInterceptorMethod[]
  priority?: number          // Lower = earlier. Default: 50
  features?: string[]
  timeoutMs?: number         // Default: 5000
  before?: (request: InterceptorRequest, context: InterceptorContext) => Promise<InterceptorBeforeResult>
  after?: (request: InterceptorRequest, response: InterceptorResponse, context: InterceptorContext) => Promise<InterceptorAfterResult>
}
```

## MutationGuard

```typescript
interface MutationGuard {
  id: string
  targetEntity: string | '*'
  operations: ('create' | 'update' | 'delete')[]
  priority?: number          // Lower = earlier. Default: 50
  features?: string[]

  validate(input: MutationGuardInput): Promise<MutationGuardResult>
  afterSuccess?(input: MutationGuardAfterInput): Promise<void>
}

interface MutationGuardInput {
  tenantId: string
  organizationId: string | null
  userId: string
  resourceKind: string
  resourceId: string | null    // null for create
  operation: 'create' | 'update' | 'delete'
  requestMethod: string
  requestHeaders: Headers
  mutationPayload?: Record<string, unknown> | null
}

interface MutationGuardResult {
  ok: boolean
  status?: number              // Default: 422
  message?: string
  body?: Record<string, unknown>
  modifiedPayload?: Record<string, unknown>
  shouldRunAfterSuccess?: boolean
  metadata?: Record<string, unknown>
}

interface MutationGuardAfterInput {
  tenantId: string
  organizationId: string | null
  userId: string
  resourceKind: string
  resourceId: string
  operation: 'create' | 'update' | 'delete'
  requestMethod: string
  requestHeaders: Headers
  metadata?: Record<string, unknown> | null
}
```

## InjectionPosition

```typescript
enum InjectionPosition {
  Before = 'before',
  After = 'after',
  First = 'first',
  Last = 'last',
}

type InjectionPlacement = {
  position?: InjectionPosition
  relativeTo?: string
}
```

## ComponentOverride

```typescript
type ComponentOverride<TProps = unknown> = {
  target: { componentId: string }
  priority: number
  features?: string[]
  metadata?: { module?: string }
} & (
  | { replacement: LazyExoticComponent<ComponentType<TProps>> | ComponentType<TProps>; propsSchema: ZodType<TProps> }
  | { wrapper: (Original: ComponentType<TProps>) => ComponentType<TProps> }
  | { propsTransform: (props: TProps) => TProps }
)

// Handle constructors
ComponentReplacementHandles.page(path)         // → 'page:<path>'
ComponentReplacementHandles.dataTable(tableId) // → 'data-table:<tableId>'
ComponentReplacementHandles.crudForm(entityId) // → 'crud-form:<entityId>'
ComponentReplacementHandles.section(scope, id) // → 'section:<scope>.<id>'
```

## Widget Event Handlers

```typescript
type WidgetInjectionEventHandlers<TContext = unknown, TData = unknown> = {
  filter?: WidgetInjectionEventFilter
  onLoad?: (context: TContext) => void | Promise<void>
  onBeforeSave?: (data: TData, context: TContext) => WidgetBeforeSaveResult | Promise<WidgetBeforeSaveResult>
  onSave?: (data: TData, context: TContext) => void | Promise<void>
  onAfterSave?: (data: TData, context: TContext) => void | Promise<void>
  onBeforeDelete?: (data: TData, context: TContext) => WidgetBeforeDeleteResult | Promise<WidgetBeforeDeleteResult>
  onDelete?: (data: TData, context: TContext) => void | Promise<void>
  onAfterDelete?: (data: TData, context: TContext) => void | Promise<void>
  onFieldChange?: (fieldId: string, value: unknown, data: TData, context: TContext) => Promise<FieldChangeResult | void>
  onBeforeNavigate?: (target: string, context: TContext) => Promise<NavigateGuardResult>
  onVisibilityChange?: (visible: boolean, context: TContext) => Promise<void>
  onAppEvent?: (event: AppEventPayload, context: TContext) => Promise<void>
  transformFormData?: (data: TData, context: TContext) => Promise<TData | { data: TData; applyToForm: true }>
  transformDisplayData?: (data: TData, context: TContext) => Promise<TData>
  transformValidation?: (errors: Record<string, string>, data: TData, context: TContext) => Promise<Record<string, string>>
}

type FieldChangeResult = {
  value?: unknown
  sideEffects?: Record<string, unknown>
  message?: { text: string; severity: 'info' | 'warning' | 'error' }
}
```

## Widget Injection Spot IDs

### CrudForm Spots

```
crud-form:<entityId>:fields
```

Examples: `crud-form:customers.person:fields`, `crud-form:catalog.product:fields`

### DataTable Spots

```
data-table:<tableId>:columns
data-table:<tableId>:row-actions
data-table:<tableId>:bulk-actions
data-table:<tableId>:filters
```

Examples: `data-table:customers.people:columns`, `data-table:sales.orders:row-actions`

### Menu Spots

```
menu:sidebar:main
menu:sidebar:settings
menu:sidebar:profile
menu:topbar:profile-dropdown
menu:topbar:actions
```

### Detail Page Spots

```
<module>.<entity>:detail:tabs
<module>.<entity>:detail:sections
```

## Execution Pipeline Order

```
Request arrives
  ↓
1. Zod schema validation
2. API Interceptor before hooks
3. Sync before-event subscribers (*.creating)
4. CrudHooks.beforeCreate/Update/Delete (module-local)
5. Mutation Guard Registry validate
6. Entity mutation + ORM flush
7. CrudHooks.afterCreate/Update/Delete
8. Mutation Guard Registry afterSuccess
9. Sync after-event subscribers (*.created)
10. Async event subscribers (persistent, queued)
11. Response Enrichers (list/detail endpoints only)
12. API Interceptor after hooks
  ↓
Response returned
```
