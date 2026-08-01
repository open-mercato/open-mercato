export type ExtensionHostFamily =
  | 'generic'
  | 'menu'
  | 'data-table'
  | 'crud-form'
  | 'detail'
  | 'portal-page'
  | 'component-handle'
  | 'entity'
  | 'api-route'
  | 'command'
  | 'event'
  | 'query-lifecycle'
  | 'dashboard'
  | 'notification'
  | 'integration'
  | 'specialized-registry'
  | 'module-override'

export type ExtensionHostCapability =
  | 'render-widget'
  | 'headless-widget'
  | 'menu-item'
  | 'column-widget'
  | 'row-action'
  | 'bulk-action'
  | 'filter-widget'
  | 'toolbar-widget'
  | 'field-widget'
  | 'lifecycle-handler'
  | 'component-replacement'
  | 'response-enricher'
  | 'query-enricher'
  | 'api-interceptor'
  | 'command-interceptor'
  | 'mutation-guard'
  | 'entity-extension'
  | 'async-subscriber'
  | 'sync-subscriber'
  | 'browser-client'
  | 'browser-portal'
  | 'registry-contribution'
  | 'module-override'

export type ExtensionHostActivation = 'always' | 'host-opt-in' | 'caller-opt-in' | 'feature-gated'

export type ExtensionPointPatternParameter = {
  source: string
  pattern?: string
}

type ExtensionHostDeclarationBase = {
  source: string
  contextContract?: string
  dataContract?: string
  scopeContract?: string
  runtimeContract?: string
  activation?: ExtensionHostActivation
  aliases?: readonly string[]
  fallbacks?: readonly string[]
}

export type InjectionExtensionHostDeclaration = ExtensionHostDeclarationBase & {
  family: Exclude<ExtensionHostFamily, 'data-table' | 'crud-form' | 'component-handle'>
  spotId?: string
  pattern?: string
  parameters?: Readonly<Record<string, ExtensionPointPatternParameter>>
  supported: readonly ExtensionHostCapability[]
}

export type DataTableExtensionHostDeclaration = ExtensionHostDeclarationBase & {
  family: 'data-table'
  tableId: string
  baseSpotId?: string
}

export type CrudFormExtensionHostDeclaration = ExtensionHostDeclarationBase & {
  family: 'crud-form'
  entityId: string
  spotId?: string
}

export type ComponentExtensionHostDeclaration = ExtensionHostDeclarationBase & {
  family: 'component-handle'
  componentId: string
  propsContract?: string
}

export type ModuleExtensionHostDeclaration =
  | InjectionExtensionHostDeclaration
  | DataTableExtensionHostDeclaration
  | CrudFormExtensionHostDeclaration
  | ComponentExtensionHostDeclaration

export type ModuleExtensionPoints<
  TModuleId extends string = string,
  THosts extends Readonly<Record<string, ModuleExtensionHostDeclaration>> = Readonly<Record<string, ModuleExtensionHostDeclaration>>,
> = {
  moduleId: TModuleId
  hosts: THosts
}

export function defineModuleExtensionPoints<
  const TModuleId extends string,
  const THosts extends Readonly<Record<string, ModuleExtensionHostDeclaration>>,
>(declaration: ModuleExtensionPoints<TModuleId, THosts>): ModuleExtensionPoints<TModuleId, THosts> {
  return Object.freeze({
    ...declaration,
    hosts: Object.freeze({ ...declaration.hosts }),
  })
}

export function injectionExtensionHost(
  declaration: Omit<InjectionExtensionHostDeclaration, 'family'> & {
    family: InjectionExtensionHostDeclaration['family']
  },
): InjectionExtensionHostDeclaration {
  const hasExactId = typeof declaration.spotId === 'string' && declaration.spotId.length > 0
  const hasPattern = typeof declaration.pattern === 'string' && declaration.pattern.length > 0
  if (hasExactId === hasPattern) {
    throw new Error('[internal] injection extension hosts require exactly one of spotId or pattern')
  }
  if (hasPattern && (!declaration.parameters || Object.keys(declaration.parameters).length === 0)) {
    throw new Error('[internal] patterned injection extension hosts require named parameters')
  }
  return Object.freeze({ ...declaration })
}

export function dataTableExtensionHost(
  declaration: Omit<DataTableExtensionHostDeclaration, 'family'>,
): DataTableExtensionHostDeclaration {
  return Object.freeze({ family: 'data-table', ...declaration })
}

export function crudFormExtensionHost(
  declaration: Omit<CrudFormExtensionHostDeclaration, 'family'>,
): CrudFormExtensionHostDeclaration {
  return Object.freeze({ family: 'crud-form', ...declaration })
}

export function componentExtensionHost(
  declaration: Omit<ComponentExtensionHostDeclaration, 'family'>,
): ComponentExtensionHostDeclaration {
  return Object.freeze({ family: 'component-handle', ...declaration })
}

export type BoundExtensionSurface = {
  key: string
  suffix: string | null
  capabilities: readonly ExtensionHostCapability[]
  bound: boolean
  phases?: readonly string[]
  operations?: readonly string[]
}

export const DATA_TABLE_EXTENSION_SURFACES = [
  { key: 'header', suffix: 'header', capabilities: ['render-widget'], bound: true },
  { key: 'footer', suffix: 'footer', capabilities: ['render-widget'], bound: true },
  { key: 'toolbar', suffix: 'toolbar', capabilities: ['toolbar-widget'], bound: true },
  { key: 'searchTrailing', suffix: 'search-trailing', capabilities: ['render-widget'], bound: true },
  { key: 'columns', suffix: 'columns', capabilities: ['column-widget'], bound: true },
  { key: 'rowActions', suffix: 'row-actions', capabilities: ['row-action'], bound: true },
  { key: 'bulkActions', suffix: 'bulk-actions', capabilities: ['bulk-action'], bound: true },
  { key: 'filters', suffix: 'filters', capabilities: ['filter-widget'], bound: true },
  { key: 'replacement', suffix: null, capabilities: ['component-replacement'], bound: true },
  { key: 'emptyState', suffix: 'empty-state', capabilities: ['render-widget'], bound: false },
] as const satisfies readonly BoundExtensionSurface[]

export const CRUD_FORM_EXTENSION_SURFACES = [
  { key: 'base', suffix: null, capabilities: ['render-widget', 'lifecycle-handler'], bound: true },
  { key: 'header', suffix: 'header', capabilities: ['render-widget'], bound: true },
  { key: 'fields', suffix: 'fields', capabilities: ['field-widget'], bound: true },
  { key: 'replacement', suffix: null, capabilities: ['component-replacement'], bound: true },
  { key: 'beforeFields', suffix: 'before-fields', capabilities: ['render-widget'], bound: false },
  { key: 'afterFields', suffix: 'after-fields', capabilities: ['render-widget'], bound: false },
  { key: 'footer', suffix: 'footer', capabilities: ['render-widget'], bound: false },
  { key: 'sidebar', suffix: 'sidebar', capabilities: ['render-widget'], bound: false },
  { key: 'group', suffix: 'group:{groupId}', capabilities: ['render-widget'], bound: false },
  { key: 'fieldBefore', suffix: 'field:{fieldId}:before', capabilities: ['render-widget'], bound: false },
  { key: 'fieldAfter', suffix: 'field:{fieldId}:after', capabilities: ['render-widget'], bound: false },
] as const satisfies readonly BoundExtensionSurface[]

export const CRUD_FORM_LIFECYCLE_PHASES = [
  'transformValidation',
  'onBeforeNavigate',
  'onAppEvent',
  'onVisibilityChange',
  'onBeforeDelete',
  'onDelete',
  'onAfterDelete',
  'onDeleteError',
  'onFieldChange',
  'transformFormData',
  'onBeforeSave',
  'onSave',
  'onAfterSave',
] as const

export function dataTableExtensionSpotId(tableId: string, suffix?: string): string {
  return suffix ? `data-table:${tableId}:${suffix}` : `data-table:${tableId}`
}

export function crudFormExtensionSpotId(entityId: string, suffix?: string): string {
  return suffix ? `crud-form:${entityId}:${suffix}` : `crud-form:${entityId}`
}

export function extensionSpotChildId(spotId: string, suffix: string): string {
  return `${spotId}:${suffix}`
}

export type ModuleExtensionSurfaceFacts = {
  hosts: ModuleExtensionHostFact[]
  contributions: ModuleExtensionContributionFact[]
  unresolved: ModuleExtensionUnresolvedFact[]
}

export type ModuleExtensionHostFact = {
  key: string
  id: string
  resolution: 'exact' | 'pattern' | 'framework' | 'fact-ref'
  family: ExtensionHostFamily
  ownerModule: string
  capabilities: ExtensionHostCapability[]
  phases?: string[]
  operations?: string[]
  contextContract?: string
  dataContract?: string
  scopeContract?: string
  runtimeContract?: string
  activation?: ExtensionHostActivation
  bound: boolean
  stability: 'frozen' | 'stable'
  source:
    | { kind: 'declaration'; path: string; symbol: string }
    | { kind: 'fact-ref'; factSection: string; factKey: string }
    | { kind: 'framework'; path: string; symbol: string }
  aliases?: string[]
  patternParameters?: Record<string, ExtensionPointPatternParameter>
  fallbacks?: string[]
}

export type ModuleExtensionTargetFact = {
  id: string
  resolution: 'exact' | 'pattern' | 'framework' | 'fact-ref' | 'optional-external' | 'unresolved'
  factRef?: { factSection: string; factKey: string }
  optionalOwnerPackage?: string
}

export type ModuleExtensionContributionFact = {
  id: string
  kind: string
  targets: ModuleExtensionTargetFact[]
  phases?: string[]
  operations?: string[]
  features?: string[]
  scopeContract: string
  activation?: ExtensionHostActivation
  placement?: { relativeTo?: string; position?: 'first' | 'last' | 'before' | 'after'; priority?: number }
  roundTripId?: string
  override?: { domain: string; key: string; mode: 'disable-replace' | 'replace' | 'additive' }
  details: Record<string, string | number | boolean | string[] | undefined>
  source: { path: string; symbol?: string }
}

export type ModuleExtensionUnresolvedFact = {
  key: string
  source: { path: string; symbol?: string }
  reason:
    | 'unclassified-binding'
    | 'unbound-declaration'
    | 'dynamic-without-pattern'
    | 'unresolved-first-party-target'
}
