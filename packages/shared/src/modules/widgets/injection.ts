import type { ComponentType, LazyExoticComponent, ReactNode } from 'react'
import type { InjectionPlacement } from './injection-position'

/**
 * Result returned by `onFieldChange` handlers.
 */
export type FieldChangeResult = {
  /** Override the field value */
  value?: unknown
  /** Set other fields as side effects */
  sideEffects?: Record<string, unknown>
  /** Display a message to the user near the field */
  message?: { text: string; severity: 'info' | 'warning' | 'error' }
}

/**
 * Result returned by `onBeforeNavigate` handlers.
 */
export type NavigateGuardResult = {
  /** Whether navigation should proceed */
  ok: boolean
  /** Reason shown to the user when navigation is blocked */
  message?: string
}

/**
 * Payload delivered by the DOM Event Bridge for server-side app events.
 */
export type AppEventPayload = {
  /** Event identifier (e.g., 'example.todo.created') */
  id: string
  /** Event-specific payload data */
  payload: Record<string, unknown>
  /** Server timestamp when the event was emitted */
  timestamp: number
  /** Organization the event belongs to */
  organizationId: string
}

/**
 * Widget injection event handlers for lifecycle management.
 *
 * Handlers are classified into two categories:
 * - **Action events**: Fire-and-forget or gate handlers (accumulate requestHeaders, check ok boolean)
 * - **Transformer events**: Pipeline handlers where output of widget N becomes input of widget N+1
 */
export type WidgetInjectionEventHandlers<TContext = unknown, TData = unknown> = {
  // === Existing: Lifecycle Actions ===

  /**
   * Called when the widget is first loaded/mounted
   */
  onLoad?: (context: TContext) => void | Promise<void>

  /**
   * Called before save action is executed
   * Return false or throw to prevent save. Optionally return an object with
   * `ok`, `message`, and `fieldErrors` to surface a user-facing reason.
   */
  onBeforeSave?: (data: TData, context: TContext) => WidgetBeforeSaveResult | Promise<WidgetBeforeSaveResult>

  /**
   * Called when save action is triggered
   */
  onSave?: (data: TData, context: TContext) => void | Promise<void>

  /**
   * Called after save action completes successfully
   */
  onAfterSave?: (data: TData, context: TContext) => void | Promise<void>

  /**
   * Called before delete action is executed.
   * Return false or throw to prevent delete. Optionally return an object with
   * `ok`, `message`, and `fieldErrors` to surface a user-facing reason.
   */
  onBeforeDelete?: (data: TData, context: TContext) => WidgetBeforeDeleteResult | Promise<WidgetBeforeDeleteResult>

  /**
   * Called when delete action is triggered.
   */
  onDelete?: (data: TData, context: TContext) => void | Promise<void>

  /**
   * Called after delete action completes successfully.
   */
  onAfterDelete?: (data: TData, context: TContext) => void | Promise<void>

  /**
   * Called when delete action fails.
   */
  onDeleteError?: (data: TData, context: TContext, error: unknown) => void | Promise<void>

  // === New: DOM-Inspired Lifecycle (Phase C) ===

  /**
   * Called when a form field value changes. Can return side-effects and user messages.
   * Action event — called for each widget independently.
   */
  onFieldChange?: (fieldId: string, value: unknown, data: TData, context: TContext) => Promise<FieldChangeResult | void>

  /**
   * Called before navigating away from the current page. Can block navigation.
   * Action event — first widget returning `ok: false` stops navigation.
   */
  onBeforeNavigate?: (target: string, context: TContext) => Promise<NavigateGuardResult>

  /**
   * Called when the widget's visibility changes (e.g., tab switches).
   * Action event — fire-and-forget.
   */
  onVisibilityChange?: (visible: boolean, context: TContext) => Promise<void>

  /**
   * Called when an app event matching the widget's subscription arrives via the DOM Event Bridge.
   * Action event — fire-and-forget.
   */
  onAppEvent?: (event: AppEventPayload, context: TContext) => Promise<void>

  // === New: Data Transformation Pipelines (Phase C) ===

  /**
   * Transform form data before submission. Output of widget N becomes input of widget N+1.
   * Transformer event — pipeline dispatch.
   *
   * Return `{ data, applyToForm: true }` to also reflect the transformed values back into
   * the visible form fields (opt-in). Default behavior (returning plain `TData`) only
   * modifies the submit payload and leaves the visible form unchanged.
   */
  transformFormData?: (data: TData, context: TContext) => Promise<TData | { data: TData; applyToForm: true }>

  /**
   * Transform data for display purposes. Output of widget N becomes input of widget N+1.
   * Transformer event — pipeline dispatch.
   */
  transformDisplayData?: (data: TData, context: TContext) => Promise<TData>

  /**
   * Transform validation errors. Output of widget N becomes input of widget N+1.
   * Transformer event — pipeline dispatch.
   */
  transformValidation?: (errors: Record<string, string>, data: TData, context: TContext) => Promise<Record<string, string>>
}

/**
 * Metadata for an injection widget
 */
export type InjectionWidgetMetadata = {
  id: string
  title?: string
  description?: string
  features?: string[]
  priority?: number
  enabled?: boolean
}

/**
 * Optional placement metadata declared per injection spot entry.
 * Lets hosts render widgets in tabs, grouped cards, or plain stacks.
 */
export type InjectionWidgetPlacement = {
  /**
   * Optional stable identifier for grouping (e.g., tab id or card id)
   */
  groupId?: string
  /**
   * Display label for the group or tab. Falls back to widget title.
   */
  groupLabel?: string
  /**
   * Optional helper text shown with the widget when rendered as a group.
   */
  groupDescription?: string
  /**
   * Preferred column for grouped layouts (1 = left, 2 = right)
   */
  column?: 1 | 2
  /**
   * Rendering hint for hosts that support categorized widgets.
   * - 'tab'   → render as a tab with the widget as tab content
   * - 'group' → render inside a grouped card/section
   * - 'stack' → render inline (default)
   */
  kind?: 'tab' | 'group' | 'stack'
}

/**
 * Props passed to injection widget components
 */
export type InjectionWidgetComponentProps<TContext = unknown, TData = unknown> = {
  context: TContext
  data?: TData
  onDataChange?: (data: TData) => void
  disabled?: boolean
}

export type WidgetBeforeSaveResult =
  | boolean
  | void
  | {
      ok?: boolean
      message?: string
      fieldErrors?: Record<string, string>
      requestHeaders?: Record<string, string>
      details?: unknown
    }

export type WidgetBeforeDeleteResult = WidgetBeforeSaveResult

/**
 * Complete injection widget module definition
 */
export type InjectionWidgetModule<TContext = unknown, TData = unknown> = {
  metadata: InjectionWidgetMetadata
  Widget: ComponentType<InjectionWidgetComponentProps<TContext, TData>>
  eventHandlers?: WidgetInjectionEventHandlers<TContext, TData>
}

export type InjectionColumnDefinition = {
  id: string
  header: string
  accessorKey: string
  cell?: (props: { getValue: () => unknown }) => ReactNode
  size?: number
  sortable?: boolean
  placement?: InjectionPlacement
}

export type InjectionRowActionDefinition = {
  id: string
  label: string
  icon?: string
  onSelect: (row: unknown, context: unknown) => void
  placement?: InjectionPlacement
}

export type InjectionBulkActionDefinition = {
  id: string
  label: string
  icon?: string
  onExecute: (selectedRows: unknown[], context: unknown) => Promise<void>
}

export type InjectionFilterDefinition = {
  id: string
  label: string
  type: 'select' | 'text' | 'date-range' | 'boolean'
  options?: { value: string; label: string }[]
  strategy: 'server' | 'client'
  queryParam?: string
  enrichedField?: string
}

export type FieldVisibilityCondition<TContext = unknown> = (
  values: Record<string, unknown>,
  context: TContext,
) => boolean

export type CustomFieldProps<TContext = unknown> = {
  value: unknown
  onChange: (value: unknown) => void
  context: TContext
  disabled?: boolean
}

export type FieldContext = {
  organizationId?: string | null
  tenantId?: string | null
  userId?: string | null
  record?: Record<string, unknown>
}

export type InjectionFieldDefinition = {
  id: string
  label: string
  type: 'text' | 'select' | 'number' | 'date' | 'boolean' | 'textarea' | 'custom'
  options?: { value: string; label: string }[]
  optionsLoader?: (context: FieldContext) => Promise<{ value: string; label: string }[]>
  optionsCacheTtl?: number
  customComponent?: LazyExoticComponent<ComponentType<CustomFieldProps>>
  group: string
  placement?: InjectionPlacement
  readOnly?: boolean
  visibleWhen?: FieldVisibilityCondition
}

export type WizardStepProps<TContext = unknown> = {
  data: Record<string, unknown>
  setData: (next: Record<string, unknown>) => void
  context: TContext
}

export type InjectionContext = {
  organizationId?: string | null
  tenantId?: string | null
  userId?: string | null
  path?: string
  [k: string]: unknown
}

export type InjectionWizardStep = {
  id: string
  label: string
  fields?: InjectionFieldDefinition[]
  customComponent?: LazyExoticComponent<ComponentType<WizardStepProps>>
  validate?: (
    data: Record<string, unknown>,
    context: InjectionContext,
  ) => Promise<{ ok: boolean; message?: string }>
}

export type InjectionWizardWidget = {
  metadata: InjectionWidgetMetadata
  kind: 'wizard'
  steps: InjectionWizardStep[]
  onComplete?: (stepData: Record<string, unknown>, context: InjectionContext) => Promise<void>
  eventHandlers?: WidgetInjectionEventHandlers<InjectionContext, Record<string, unknown>>
}

export type StatusBadgeResult = {
  status: 'healthy' | 'warning' | 'error' | 'unknown'
  tooltip?: string
  count?: number
}

export type StatusBadgeContext = {
  organizationId: string
  tenantId: string
  userId: string
}

export type InjectionStatusBadgeWidget = {
  metadata: InjectionWidgetMetadata
  kind: 'status-badge'
  badge: {
    label: string
    statusLoader: (context: StatusBadgeContext) => Promise<StatusBadgeResult>
    href?: string
    pollInterval?: number
  }
}

export type InjectionMenuItem = {
  id: string
  label: string
  labelKey?: string
  icon?: string
  href?: string
  onClick?: () => void
  separator?: boolean
  placement?: InjectionPlacement
  features?: string[]
  roles?: string[]
  badge?: string | number
  children?: Omit<InjectionMenuItem, 'children'>[]
  groupId?: string
  groupLabel?: string
  groupLabelKey?: string
  groupOrder?: number
}

export type InjectionMenuItemWidget = {
  metadata: InjectionWidgetMetadata
  menuItems: InjectionMenuItem[]
}

export type InjectionColumnWidget = {
  metadata: InjectionWidgetMetadata
  columns: InjectionColumnDefinition[]
}

export type InjectionRowActionWidget = {
  metadata: InjectionWidgetMetadata
  rowActions: InjectionRowActionDefinition[]
}

export type InjectionBulkActionWidget = {
  metadata: InjectionWidgetMetadata
  bulkActions: InjectionBulkActionDefinition[]
}

export type InjectionFilterWidget = {
  metadata: InjectionWidgetMetadata
  filters: InjectionFilterDefinition[]
}

export type InjectionFieldWidget = {
  metadata: InjectionWidgetMetadata
  fields: InjectionFieldDefinition[]
  eventHandlers?: WidgetInjectionEventHandlers<InjectionContext, Record<string, unknown>>
}

export type InjectionDataWidgetModule =
  | InjectionColumnWidget
  | InjectionRowActionWidget
  | InjectionBulkActionWidget
  | InjectionFilterWidget
  | InjectionFieldWidget
  | InjectionWizardWidget
  | InjectionStatusBadgeWidget
  | InjectionMenuItemWidget

export type InjectionAnyWidgetModule<TContext = unknown, TData = unknown> =
  | InjectionWidgetModule<TContext, TData>
  | InjectionDataWidgetModule

/**
 * Injection spot identifier - uniquely identifies where widgets can be injected
 */
export type InjectionSpotId = string

/**
 * Injection table entry mapping spot to widget
 */
export type InjectionTableEntry = {
  spotId: InjectionSpotId
  widgetId: string
  priority?: number
  placement?: InjectionWidgetPlacement
}

export type ModuleInjectionSlot = string | (InjectionWidgetPlacement & { widgetId: string; priority?: number })

/**
 * Module's injection table - maps spots to widgets
 */
export type ModuleInjectionTable = Record<InjectionSpotId, ModuleInjectionSlot | ModuleInjectionSlot[]>
