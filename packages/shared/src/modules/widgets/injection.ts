import type { ComponentType } from 'react'

/**
 * Widget injection event handlers for lifecycle management
 */
export type WidgetInjectionEventHandlers<TContext = unknown, TData = unknown> = {
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
}

/**
 * Metadata for an injection widget
 */
export type InjectionWidgetMetadata = {
  id: string
  title: string
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
    }

/**
 * Complete injection widget module definition
 */
export type InjectionWidgetModule<TContext = unknown, TData = unknown> = {
  metadata: InjectionWidgetMetadata
  Widget: ComponentType<InjectionWidgetComponentProps<TContext, TData>>
  eventHandlers?: WidgetInjectionEventHandlers<TContext, TData>
}

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
