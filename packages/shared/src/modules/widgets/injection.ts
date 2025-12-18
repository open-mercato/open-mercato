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
   * Return false or throw to prevent save
   */
  onBeforeSave?: (data: TData, context: TContext) => boolean | void | Promise<boolean | void>

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
 * Props passed to injection widget components
 */
export type InjectionWidgetComponentProps<TContext = unknown, TData = unknown> = {
  context: TContext
  data?: TData
  onDataChange?: (data: TData) => void
  disabled?: boolean
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
}

/**
 * Module's injection table - maps spots to widgets
 */
export type ModuleInjectionTable = Record<InjectionSpotId, string | string[]>
