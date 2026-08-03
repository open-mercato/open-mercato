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

type InjectionExtensionHostDeclarationBase = ExtensionHostDeclarationBase & {
  family: Exclude<ExtensionHostFamily, 'data-table' | 'crud-form' | 'component-handle'>
  supported: readonly ExtensionHostCapability[]
}

export type InjectionExtensionHostDeclaration = InjectionExtensionHostDeclarationBase & (
  | {
      spotId: string
      pattern?: never
      parameters?: never
    }
  | {
      spotId?: never
      pattern: string
      parameters: Readonly<Record<string, ExtensionPointPatternParameter>>
    }
)

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

export function injectionExtensionHost<const TDeclaration extends InjectionExtensionHostDeclaration>(
  declaration: TDeclaration,
): Readonly<TDeclaration> {
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

export function dataTableExtensionHost<
  const TDeclaration extends Omit<DataTableExtensionHostDeclaration, 'family'>,
>(
  declaration: TDeclaration,
): Readonly<TDeclaration & { family: 'data-table' }> {
  return Object.freeze({ family: 'data-table', ...declaration })
}

export function crudFormExtensionHost<
  const TDeclaration extends Omit<CrudFormExtensionHostDeclaration, 'family'>,
>(
  declaration: TDeclaration,
): Readonly<TDeclaration & { family: 'crud-form' }> {
  return Object.freeze({ family: 'crud-form', ...declaration })
}

export function componentExtensionHost<
  const TDeclaration extends Omit<ComponentExtensionHostDeclaration, 'family'>,
>(
  declaration: TDeclaration,
): Readonly<TDeclaration & { family: 'component-handle' }> {
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
  'transformDisplayData',
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

export const CRUD_FORM_OPERATIONS = ['create', 'update', 'delete'] as const

export function dataTableExtensionSpotId(tableId: string, suffix?: string): string {
  return suffix ? `data-table:${tableId}:${suffix}` : `data-table:${tableId}`
}

export function crudFormExtensionSpotId(entityId: string, suffix?: string): string {
  return suffix ? `crud-form:${entityId}:${suffix}` : `crud-form:${entityId}`
}

export function extensionSpotChildId(spotId: string, suffix: string): string {
  return `${spotId}:${suffix}`
}

export function resolveExtensionPointPattern(
  pattern: string,
  parameters: Readonly<Record<string, string>>,
): string {
  return pattern.replace(/\{([^}]+)\}/g, (token, parameterName: string) => parameters[parameterName] ?? token)
}

/**
 * Portable, structural copy of the CLI provenance source reference
 * (`ModuleFactSourceRef` in `packages/cli/.../module-facts.ts`). Redefined here
 * — rather than imported — so `@open-mercato/shared` keeps zero dependency on
 * `@open-mercato/cli`. Field names are kept byte-identical so the two are
 * assignable across the package boundary.
 */
export type ModuleFactSourceRef = {
  sourcePath: string
  exportName?: string
  line?: number
}

/** Portable, structural copy of the CLI provenance fact reference. */
export type ModuleFactRef = {
  factSection: string
  factKey: string
}

export type ModuleExtensionContributionKind = ModuleExtensionContributionFact['kind']

export type ModuleExtensionActivationKind =
  | 'crud-response-enricher'
  | 'query-enricher'
  | 'mutation-guard'
  | 'api-interceptor-bridge'
  | 'command-interceptor-bridge'
  | 'widget-injection-consumer'
  | 'component-extension-consumer'
  | 'dashboard-host-consumer'

export type ModuleExtensionTargetRef = {
  kind:
    | 'module'
    | 'entity'
    | 'api-route'
    | 'command'
    | 'widget-spot'
    | 'component'
    | 'event'
    | 'notification'
    | 'wildcard'
  id: string
  moduleId?: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
}

export type ModuleExtensionActivation = {
  id: string
  kind: ModuleExtensionActivationKind
  host: ModuleExtensionTargetRef
  contributionKinds: ModuleExtensionContributionKind[]
  phases?: string[]
  source: ModuleFactSourceRef
  bridge?: ModuleFactRef
}

export type ModuleExtensionResolution =
  | 'bound'
  | 'capability-only'
  | 'optional-target-missing'
  | 'wildcard'
  | 'unresolved'

export type ModuleIncomingExtensionRef = {
  contributionId: string
  contributionKind: ModuleExtensionContributionKind
  contributorModuleId: string
  target: ModuleExtensionTargetRef
  activationId?: string
  resolution: ModuleExtensionResolution
  source: ModuleFactSourceRef
}

export type ModuleContributionResolution = {
  contributionId: string
  target: ModuleExtensionTargetRef
  resolution: ModuleExtensionResolution
  activationIds: string[]
}

/**
 * Additive, optional bidirectional-topology fields layered on top of the
 * existing extension-surface facts. Every field is optional so legacy consumers
 * and pre-existing generated output remain byte-compatible.
 */
export type ModuleExtensionSurfaceFactsAdditions = {
  activations?: ModuleExtensionActivation[]
  incoming?: ModuleIncomingExtensionRef[]
  contributionResolutions?: ModuleContributionResolution[]
}

export type ModuleExtensionSurfaceFacts = {
  hosts: ModuleExtensionHostFact[]
  contributions: ModuleExtensionContributionFact[]
  unresolved: ModuleExtensionUnresolvedFact[]
} & ModuleExtensionSurfaceFactsAdditions

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

export type ModuleExtensionContributionBase = {
  id: string
  targets: ModuleExtensionTargetFact[]
  phases?: string[]
  operations?: string[]
  features?: string[]
  scopeContract: string
  activation?: ExtensionHostActivation
  placement?: { relativeTo?: string; position?: 'first' | 'last' | 'before' | 'after'; priority?: number }
  roundTripId?: string
  override?: { domain: string; key: string; mode: 'disable-replace' | 'replace' | 'additive' }
  source: { path: string; symbol?: string }
}

export type ModuleExtensionContributionFact = ModuleExtensionContributionBase & (
  | {
      kind: 'widget'
      details: {
        payload: 'render' | 'headless' | 'menu' | 'dashboard' | 'notification' | 'integration'
        registryKey: string
        itemIds?: string[]
        labelKeys?: string[]
        contextContract?: string
        dataContract?: string
        executionGuard: 'host' | 'contribution' | 'both'
      }
    }
  | {
      kind: 'data-table'
      details: {
        payload: 'column' | 'row-action' | 'bulk-action' | 'filter' | 'toolbar' | 'render'
        tableId: string
        executionGuard: 'host' | 'contribution' | 'both'
      }
    }
  | {
      kind: 'crud-form'
      details: {
        payload: 'render' | 'field' | 'lifecycle-handler'
        entityId: string
        fieldIds?: string[]
        groupIds?: string[]
        requestHeaderCapability: boolean
      }
    }
  | {
      kind: 'component-override'
      details: { handle: string; mode: 'replace' | 'wrapper' | 'props'; propsContract: string }
    }
  | {
      kind: 'response-enricher'
      details: {
        targetEntity: string
        surfaces: Array<'list' | 'detail'>
        timeoutMs: number
        fallback: 'none' | 'configured'
        critical: boolean
        cachePosture: 'record-pure' | 'rerun-on-list-cache-hit'
        queryEngine?: {
          engines: string[]
          applyOn: Array<'list' | 'detail'>
          activation: 'caller-opt-in'
        }
      }
    }
  | {
      kind: 'api-interceptor'
      details: {
        route: string
        methods: string[]
        phases: Array<'before' | 'after'>
        activation: 'crud-pipeline' | 'custom-route-bridge'
        timeoutMs: number
        failurePosture: 'fail-closed' | 'fallback'
      }
    }
  | {
      kind: 'command-interceptor'
      details: {
        targetCommand: string
        phases: Array<'before-execute' | 'after-execute' | 'before-undo' | 'after-undo'>
      }
    }
  | {
      kind: 'mutation-guard'
      details: {
        entityId: string
        operations: Array<'create' | 'update' | 'delete'>
        capabilities: Array<'block' | 'rewrite' | 'after-success'>
        optimisticLock: 'preserved'
      }
    }
  | {
      kind: 'entity-extension'
      details: {
        hostEntityId: string
        extensionEntityId: string
        linkId: string
        scopeContract: string
        orphanContract: string
      }
    }
  | {
      kind: 'subscriber'
      details: {
        event: string
        subscriberId: string
        persistent: boolean
        sync: boolean
        priority?: number
      }
    }
  | {
      kind: 'browser-reaction'
      details: {
        transports: Array<'client' | 'portal' | 'notification-effect'>
        hooks: string[]
        audienceScopeContract: string
        maxPayloadBytes?: number
        dedupWindowMs?: number
        /**
         * Statically declared handler id. Runtime keys `notifications.handlers`
         * overrides by it, so it is absent when the module declares no id (such a
         * handler cannot be overridden).
         */
        overrideKey?: string
      }
    }
  | {
      kind: 'specialized-registry'
      details: {
        registry: 'notification' | 'integration' | 'search' | 'vector' | 'ai' | 'payment' | 'shipping' | 'currency' | 'workflow'
        registryId: string
        specialistRoute: string
      }
    }
  | {
      kind: 'module-override'
      details: {
        domain: string
        key: string
        mode: 'disable-replace' | 'replace' | 'additive'
      }
    }
)

export type ModuleExtensionUnresolvedFact = {
  key: string
  source: { path: string; symbol?: string }
  reason:
    | 'unclassified-binding'
    | 'unbound-declaration'
    | 'dynamic-without-pattern'
    | 'unresolved-first-party-target'
}
