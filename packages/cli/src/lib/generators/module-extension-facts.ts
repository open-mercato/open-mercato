import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript-js'
import {
  CRUD_FORM_EXTENSION_SURFACES,
  CRUD_FORM_LIFECYCLE_PHASES,
  DATA_TABLE_EXTENSION_SURFACES,
} from '@open-mercato/shared/modules/widgets/extension-points'
import type {
  ExtensionHostCapability,
  ExtensionHostFamily,
  ModuleContributionResolution,
  ModuleExtensionActivation,
  ModuleExtensionActivationKind,
  ModuleExtensionContributionFact,
  ModuleExtensionContributionBase,
  ModuleExtensionContributionKind,
  ModuleExtensionHostFact,
  ModuleExtensionResolution,
  ModuleExtensionSurfaceFacts,
  ModuleExtensionTargetFact,
  ModuleExtensionTargetRef,
  ModuleExtensionUnresolvedFact,
  ModuleFactSourceRef,
  ModuleIncomingExtensionRef,
} from '@open-mercato/shared/modules/widgets/extension-points'
import { extractCommandIdsFromSource } from './module-registry'
import { scanModuleDir, SCAN_CONFIGS } from './scanner'

type StaticScalar = string | number | boolean | null
type StaticValue = StaticScalar | StaticValue[] | { [key: string]: StaticValue }
type StaticObject = { [key: string]: StaticValue }
type SpecializedRegistry = Extract<ModuleExtensionContributionFact, {
  kind: 'specialized-registry'
}>['details']['registry']

export interface ExtensionFactEntityRef {
  id: string
}

export interface ExtensionFactEventRef {
  id: string
  clientBroadcast?: boolean
  portalBroadcast?: boolean
}

export interface ExtensionFactApiRouteRef {
  path: string
  methods: string[]
}

export interface ExtractModuleExtensionFactsOptions {
  moduleId: string
  moduleRoot: string
  sourceRoot: string
  entities: readonly ExtensionFactEntityRef[]
  events: readonly ExtensionFactEventRef[]
  apiRoutes: readonly ExtensionFactApiRouteRef[]
  searchEntities: readonly string[]
  notifications?: readonly string[]
  aiTools?: ReadonlyArray<{ name: string; sourcePath: string }>
  aiAgents?: ReadonlyArray<{ id: string; sourcePath: string }>
}

export interface CorrelateExtensionFactsOptions {
  surfacesByModule: Readonly<Record<string, ModuleExtensionSurfaceFacts>>
  entityIds: ReadonlySet<string>
  eventIds: ReadonlySet<string>
  apiRoutes: ReadonlySet<string>
  commandIds?: ReadonlySet<string>
  contributingModuleId?: string
}

type StaticContext = {
  initializers: Map<string, ts.Expression | ts.FunctionDeclaration>
  sourceFile: ts.SourceFile
  resolving: Set<string>
}

type ApiExtensionHostIds = {
  entityIds: string[]
  /** Declaring `api/**` file per entity host id, so the host links to a real source. */
  entitySourceFiles: Record<string, string>
  commandIds: string[]
  routeIds: string[]
}

type ModuleExtensionFactExtractionCache = {
  sourceFiles: Map<string, ts.SourceFile | null>
  sourceFilesBelow: Map<string, string[]>
  apiExtensionHostIds: Map<string, ApiExtensionHostIds>
}

let activeExtractionCache: ModuleExtensionFactExtractionCache | null = null

/** @internal */
export function withModuleExtensionFactExtractionCache<Result>(operation: () => Result): Result {
  if (activeExtractionCache) return operation()
  activeExtractionCache = {
    sourceFiles: new Map(),
    sourceFilesBelow: new Map(),
    apiExtensionHostIds: new Map(),
  }
  try {
    return operation()
  } finally {
    activeExtractionCache = null
  }
}

const FRAMEWORK_PREFIXES = [
  'dashboard:',
  'menu:',
  'notification:',
  'integration:',
  'integrations.detail:',
  'system-status:',
  'topbar:',
]

const FRAMEWORK_HOSTS: ModuleExtensionHostFact[] = [
  frameworkHost('framework.backend.sidebar', 'menu:backend.sidebar', 'menu', ['menu-item']),
  frameworkHost('framework.settings.sidebar', 'menu:settings.sidebar', 'menu', ['menu-item']),
  frameworkHost('framework.profile.sidebar', 'menu:profile.sidebar', 'menu', ['menu-item']),
  frameworkHost('framework.portal.sidebar', 'menu:portal.sidebar', 'menu', ['menu-item']),
  frameworkHost('framework.dashboard', 'dashboard:*', 'dashboard', ['registry-contribution']),
  frameworkHost('framework.notifications', 'notification:*', 'notification', ['registry-contribution']),
  frameworkHost('framework.integration-detail', 'integrations.detail:{integrationId}', 'integration', ['render-widget']),
  frameworkHost('framework.integration-detail-fallback', 'integrations.detail:tabs', 'integration', ['render-widget']),
  frameworkHost('framework.backend-mutation', 'backend-mutation:global', 'generic', ['headless-widget']),
  frameworkHost('framework.crud-form-wildcard', 'crud-form:*', 'crud-form', ['field-widget', 'lifecycle-handler']),
]

function frameworkHost(
  key: string,
  id: string,
  family: ExtensionHostFamily,
  capabilities: ExtensionHostCapability[],
): ModuleExtensionHostFact {
  return {
    key,
    id,
    resolution: id.includes('*') || id.includes('{') ? 'pattern' : 'framework',
    family,
    ownerModule: 'framework',
    capabilities,
    bound: true,
    stability: 'frozen',
    source: { kind: 'framework', path: 'packages/ui/src', symbol: key },
  }
}

function frameworkOverrideHost(
  key: string,
  mode: 'disable-replace' | 'replace' | 'additive',
): ModuleExtensionHostFact {
  return {
    key: `framework.module-override.${key}`,
    id: `module-override:${key}`,
    resolution: 'framework',
    family: 'module-override',
    ownerModule: 'framework',
    capabilities: ['module-override'],
    operations: [mode],
    bound: true,
    stability: 'stable',
    source: {
      kind: 'framework',
      path: 'packages/shared/src/modules/overrides.ts',
      symbol: `ModuleOverrides.${key}`,
    },
  }
}

const FRAMEWORK_OVERRIDE_HOSTS = [
  frameworkOverrideHost('ai.agents', 'disable-replace'),
  frameworkOverrideHost('ai.tools', 'disable-replace'),
  frameworkOverrideHost('ai.extensions', 'additive'),
  frameworkOverrideHost('routes.api', 'disable-replace'),
  frameworkOverrideHost('routes.pages', 'disable-replace'),
  frameworkOverrideHost('events.subscribers', 'disable-replace'),
  frameworkOverrideHost('workers', 'disable-replace'),
  frameworkOverrideHost('widgets.injection', 'disable-replace'),
  frameworkOverrideHost('widgets.components', 'disable-replace'),
  frameworkOverrideHost('widgets.dashboard', 'disable-replace'),
  frameworkOverrideHost('notifications.types', 'disable-replace'),
  frameworkOverrideHost('notifications.handlers', 'disable-replace'),
  frameworkOverrideHost('interceptors', 'disable-replace'),
  frameworkOverrideHost('commandInterceptors', 'disable-replace'),
  frameworkOverrideHost('enrichers', 'disable-replace'),
  frameworkOverrideHost('guards', 'disable-replace'),
  frameworkOverrideHost('cli', 'disable-replace'),
  frameworkOverrideHost('setup', 'replace'),
  frameworkOverrideHost('acl.features', 'disable-replace'),
  frameworkOverrideHost('di', 'disable-replace'),
  frameworkOverrideHost('encryption.maps', 'disable-replace'),
  frameworkOverrideHost('nav.groupOrder', 'additive'),
] as const

function allFrameworkHosts(): ModuleExtensionHostFact[] {
  return [...FRAMEWORK_HOSTS, ...FRAMEWORK_OVERRIDE_HOSTS]
}

function sourceFile(filePath: string): ts.SourceFile | null {
  const cached = activeExtractionCache?.sourceFiles.get(filePath)
  if (cached !== undefined) return cached
  if (!fs.existsSync(filePath)) return null
  const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const parsed = ts.createSourceFile(filePath, fs.readFileSync(filePath, 'utf8'), ts.ScriptTarget.ES2020, true, scriptKind)
  activeExtractionCache?.sourceFiles.set(filePath, parsed)
  return parsed
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression
  while (
    ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isParenthesizedExpression(current)
    || ts.isSatisfiesExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function propertyName(node: ts.PropertyName): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text
  return null
}

function buildStaticContext(file: ts.SourceFile): StaticContext {
  const initializers = new Map<string, ts.Expression | ts.FunctionDeclaration>()
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      initializers.set(node.name.text, node.initializer)
    }
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      initializers.set(node.name.text, node)
    }
    node.forEachChild(visit)
  }
  file.forEachChild(visit)
  return { initializers, sourceFile: file, resolving: new Set() }
}

function entityRegistryValue(expression: ts.PropertyAccessExpression): string | null {
  const parts: string[] = []
  let current: ts.Expression = expression
  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text)
    current = current.expression
  }
  return ts.isIdentifier(current) && current.text === 'E' && parts.length === 2
    ? `${parts[0]}:${parts[1]}`
    : null
}

function staticTemplate(expression: ts.TemplateExpression, context: StaticContext): string | null {
  let value = expression.head.text
  for (const span of expression.templateSpans) {
    const substitution = staticValue(span.expression, context)
    if (typeof substitution !== 'string' && typeof substitution !== 'number') return null
    value += `${substitution}${span.literal.text}`
  }
  return value
}

/**
 * A function-valued property carries no statically readable value, but its
 * PRESENCE is the discriminant several conventions are keyed on (a
 * `ComponentOverride` is a wrapper/props-transform/replacement depending on
 * which callable it declares; an enricher declares `enrichOne`/`enrichMany`).
 * Method shorthand (`enrichOne() {}`) is already recorded as `true`, so an
 * arrow/function-expression property — or an identifier bound to one — records
 * the same marker instead of vanishing from the object.
 */
function isFunctionLikeInitializer(expression: ts.Expression, context: StaticContext): boolean {
  const current = unwrap(expression)
  if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) return true
  if (!ts.isIdentifier(current)) return false
  const initializer = context.initializers.get(current.text)
  if (!initializer) return false
  if (ts.isFunctionDeclaration(initializer)) return true
  const resolved = unwrap(initializer)
  return ts.isArrowFunction(resolved) || ts.isFunctionExpression(resolved)
}

function staticObject(expression: ts.ObjectLiteralExpression, context: StaticContext): StaticObject {
  const result: StaticObject = {}
  for (const property of expression.properties) {
    if (ts.isPropertyAssignment(property)) {
      const name = propertyName(property.name)
      if (!name) continue
      const value = staticValue(property.initializer, context)
      if (value !== undefined) result[name] = value
      else if (isFunctionLikeInitializer(property.initializer, context)) result[name] = true
      continue
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      const value = staticValue(property.name, context)
      if (value !== undefined) result[property.name.text] = value
      continue
    }
    if (ts.isMethodDeclaration(property)) {
      const name = propertyName(property.name)
      if (name) result[name] = true
      continue
    }
    if (ts.isSpreadAssignment(property)) {
      const value = staticValue(property.expression, context)
      if (isStaticObject(value)) Object.assign(result, value)
    }
  }
  return result
}

function staticValue(expression: ts.Expression, context: StaticContext): StaticValue | undefined {
  const current = unwrap(expression)
  if (ts.isStringLiteralLike(current) || ts.isNumericLiteral(current)) return current.text
  if (current.kind === ts.SyntaxKind.TrueKeyword) return true
  if (current.kind === ts.SyntaxKind.FalseKeyword) return false
  if (current.kind === ts.SyntaxKind.NullKeyword) return null
  if (ts.isNoSubstitutionTemplateLiteral(current)) return current.text
  if (ts.isTemplateExpression(current)) return staticTemplate(current, context) ?? undefined
  if (ts.isArrayLiteralExpression(current)) {
    return current.elements.flatMap((element) => {
      if (ts.isSpreadElement(element)) {
        const spread = staticValue(element.expression, context)
        return Array.isArray(spread) ? spread : []
      }
      const value = staticValue(element, context)
      return value === undefined ? [] : [value]
    })
  }
  if (ts.isObjectLiteralExpression(current)) return staticObject(current, context)
  if (ts.isPropertyAccessExpression(current)) {
    return entityRegistryValue(current) ?? undefined
  }
  if (ts.isIdentifier(current)) {
    if (context.resolving.has(current.text)) return undefined
    const initializer = context.initializers.get(current.text)
    if (!initializer) return undefined
    context.resolving.add(current.text)
    const value = ts.isFunctionDeclaration(initializer) ? undefined : staticValue(initializer, context)
    context.resolving.delete(current.text)
    return value
  }
  if (ts.isCallExpression(current)) {
    const handle = componentReplacementHandle(current, context)
    if (handle) return handle.resolved
    if (ts.isIdentifier(current.expression)) {
      const callable = context.initializers.get(current.expression.text)
      if (callable && (ts.isArrowFunction(callable) || ts.isFunctionExpression(callable) || ts.isFunctionDeclaration(callable))) {
        const initializers = new Map(context.initializers)
        callable.parameters.forEach((parameter, index) => {
          if (ts.isIdentifier(parameter.name) && current.arguments[index]) {
            initializers.set(parameter.name.text, current.arguments[index])
          }
        })
        const childContext: StaticContext = {
          initializers,
          sourceFile: context.sourceFile,
          resolving: new Set(context.resolving),
        }
        if (callable.body && ts.isExpression(callable.body)) return staticValue(callable.body, childContext)
        const returnStatement = callable.body?.statements.find(ts.isReturnStatement)
        if (returnStatement?.expression) return staticValue(returnStatement.expression, childContext)
      }
    }
    // Factory-style `defineThing({ … })` calls forward their configuration object,
    // but a member call (`Handles.section('a', 'b')`) computes a value from its
    // arguments — forwarding the first one there invents a wrong id, so it stays
    // unresolved unless a formula above knows the builder.
    const firstArgument = current.arguments[0]
    if (firstArgument && ts.isIdentifier(current.expression)) {
      const value = staticValue(firstArgument, context)
      if (!isStaticObject(value)) return value
      if (current.expression.text === 'dataTableExtensionHost') return { family: 'data-table', ...value }
      if (current.expression.text === 'crudFormExtensionHost') return { family: 'crud-form', ...value }
      if (current.expression.text === 'componentExtensionHost') return { family: 'component-handle', ...value }
      return value
    }
  }
  if (ts.isConditionalExpression(current)) {
    const left = staticValue(current.whenTrue, context)
    const right = staticValue(current.whenFalse, context)
    return left !== undefined && JSON.stringify(left) === JSON.stringify(right) ? left : undefined
  }
  return undefined
}

/**
 * `ComponentReplacementHandles` (packages/shared/src/modules/widgets/component-registry.ts)
 * is the framework-owned builder every `widgets/components.ts` uses to name a
 * replacement handle. Without these formulas the generic call fallback would read
 * `ComponentReplacementHandles.section('ui.detail', 'NotesSection')` as its first
 * argument and publish `ui.detail` as the handle — a target id that exists nowhere.
 */
const COMPONENT_REPLACEMENT_HANDLE_BUILDERS: Record<string, (args: Array<string | undefined>) => string | undefined> = {
  page: ([routePath]) => routePath ? `page:${routePath}` : undefined,
  dataTable: ([tableId]) => tableId ? `data-table:${tableId}` : undefined,
  crudForm: ([entityId]) => entityId ? `crud-form:${entityId}` : undefined,
  section: ([scope, sectionId]) => scope && sectionId ? `section:${scope}.${sectionId}` : undefined,
}

function componentReplacementHandle(
  expression: ts.CallExpression,
  context: StaticContext,
): { resolved: string | undefined } | null {
  if (!ts.isPropertyAccessExpression(expression.expression)) return null
  const callee = expression.expression
  if (!ts.isIdentifier(callee.expression) || callee.expression.text !== 'ComponentReplacementHandles') return null
  const builder = COMPONENT_REPLACEMENT_HANDLE_BUILDERS[callee.name.text]
  if (!builder) return { resolved: undefined }
  const args = expression.arguments.map((argument) => stringValue(staticValue(argument, context)))
  return { resolved: builder(args) }
}

function isStaticObject(value: StaticValue | undefined): value is StaticObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function strings(value: StaticValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function stringValue(value: StaticValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberValue(value: StaticValue | undefined): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  return undefined
}

function booleanValue(value: StaticValue | undefined): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function portablePath(moduleRoot: string, sourceRoot: string, filePath: string): string {
  return path.posix.join(sourceRoot, path.relative(moduleRoot, filePath).split(path.sep).join('/'))
}

function conventionPath(moduleRoot: string, relativePath: string): string | null {
  const direct = path.join(moduleRoot, relativePath)
  if (fs.existsSync(direct)) return direct
  if (relativePath.endsWith('.ts')) {
    const tsx = `${direct.slice(0, -3)}.tsx`
    if (fs.existsSync(tsx)) return tsx
  }
  return null
}

export function readConventionObjectArray(filePath: string, exportName: string): StaticObject[] {
  const file = sourceFile(filePath)
  if (!file) return []
  const context = buildStaticContext(file)
  const initializer = context.initializers.get(exportName)
  if (!initializer || ts.isFunctionDeclaration(initializer)) return []
  const value = staticValue(initializer, context)
  return Array.isArray(value) ? value.filter(isStaticObject) : []
}

function readRootObject(filePath: string, variableName: string): StaticObject | null {
  const file = sourceFile(filePath)
  if (!file) return null
  const context = buildStaticContext(file)
  const initializer = context.initializers.get(variableName)
  if (!initializer || ts.isFunctionDeclaration(initializer)) return null
  const value = staticValue(initializer, context)
  return isStaticObject(value) ? value : null
}

function readCallObjectArguments(filePath: string, calleeNames: ReadonlySet<string>): Array<{
  callee: string
  value: StaticObject
}> {
  const file = sourceFile(filePath)
  if (!file) return []
  const context = buildStaticContext(file)
  const result: Array<{ callee: string; value: StaticObject }> = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && calleeNames.has(node.expression.text)) {
      const firstArgument = node.arguments[0]
      const value = firstArgument ? staticValue(firstArgument, context) : undefined
      if (isStaticObject(value)) result.push({ callee: node.expression.text, value })
    }
    node.forEachChild(visit)
  }
  file.forEachChild(visit)
  return result
}

function sortHosts(hosts: ModuleExtensionHostFact[]): ModuleExtensionHostFact[] {
  const sourceKey = (host: ModuleExtensionHostFact): string => host.source.kind === 'fact-ref'
    ? `${host.source.factSection}:${host.source.factKey}`
    : `${host.source.path}:${host.source.symbol}`
  return hosts.sort((left, right) =>
    left.family.localeCompare(right.family)
    || left.id.localeCompare(right.id)
    || sourceKey(left).localeCompare(sourceKey(right))
    || left.key.localeCompare(right.key))
}

function sortContributions(contributions: ModuleExtensionContributionFact[]): ModuleExtensionContributionFact[] {
  const targetKey = (contribution: ModuleExtensionContributionFact): string => contribution.targets
    .map((entry) => entry.id)
    .join('\u0000')
  const sourceKey = (contribution: ModuleExtensionContributionFact): string =>
    `${contribution.source.path}:${contribution.source.symbol ?? ''}`
  return contributions.sort((left, right) =>
    left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id)
    || targetKey(left).localeCompare(targetKey(right))
    || sourceKey(left).localeCompare(sourceKey(right)))
}

function target(id: string, resolution: ModuleExtensionTargetFact['resolution'] = 'unresolved'): ModuleExtensionTargetFact {
  return { id, resolution }
}

function factTarget(id: string, factSection: string, factKey = id): ModuleExtensionTargetFact {
  return { id, resolution: 'fact-ref', factRef: { factSection, factKey } }
}

function openTarget(id: string): ModuleExtensionTargetFact {
  return target(id)
}

function declarationSource(sourceRoot: string, symbol: string): ModuleExtensionHostFact['source'] {
  return { kind: 'declaration', path: path.posix.join(sourceRoot, 'extension-points.ts'), symbol }
}

function hasDeclarationBinding(
  moduleRoot: string,
  hostKey: string,
  declaration: StaticObject,
): boolean {
  const relativeSource = stringValue(declaration.source)
  if (!relativeSource) return false
  const bindingFile = sourceFile(path.join(moduleRoot, relativeSource))
  if (!bindingFile) return false
  const escapedHostKey = hostKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const bindingPattern = new RegExp(
    `extensionPoints\\s*\\.\\s*hosts(?:\\s*\\.\\s*${escapedHostKey}|\\s*\\[\\s*['\"]${escapedHostKey}['\"]\\s*\\])`,
  )
  if (bindingPattern.test(bindingFile.text)) return true
  return declaration.family === 'integration'
    && typeof declaration.pattern === 'string'
    && /resolveIntegrationDetailWidgetSpotId\s*\(/.test(bindingFile.text)
}

function baseHost(options: {
  key: string
  id: string
  moduleId: string
  family: ExtensionHostFamily
  capabilities: ExtensionHostCapability[]
  sourceRoot: string
  declaration: StaticObject
  bound?: boolean
  resolution?: ModuleExtensionHostFact['resolution']
}): ModuleExtensionHostFact {
  const { declaration } = options
  const aliases = strings(declaration.aliases)
  const fallbacks = strings(declaration.fallbacks)
  const fact: ModuleExtensionHostFact = {
    key: options.key,
    id: options.id,
    resolution: options.resolution ?? (options.id.includes('{') || options.id.includes('*') ? 'pattern' : 'exact'),
    family: options.family,
    ownerModule: options.moduleId,
    capabilities: options.capabilities,
    bound: options.bound ?? true,
    stability: 'frozen',
    source: declarationSource(options.sourceRoot, `extensionPoints.hosts.${options.key.split('.')[0]}`),
  }
  const contextContract = stringValue(declaration.contextContract)
  const dataContract = stringValue(declaration.dataContract)
  const scopeContract = stringValue(declaration.scopeContract)
  const runtimeContract = stringValue(declaration.runtimeContract)
  const activation = stringValue(declaration.activation) as ModuleExtensionHostFact['activation']
  if (contextContract) fact.contextContract = contextContract
  if (dataContract) fact.dataContract = dataContract
  if (scopeContract) fact.scopeContract = scopeContract
  if (runtimeContract) fact.runtimeContract = runtimeContract
  if (activation) fact.activation = activation
  if (aliases.length > 0) fact.aliases = aliases
  if (fallbacks.length > 0) fact.fallbacks = fallbacks
  return fact
}

function extractDeclaredHosts(options: ExtractModuleExtensionFactsOptions): {
  hosts: ModuleExtensionHostFact[]
  unresolved: ModuleExtensionUnresolvedFact[]
} {
  const filePath = conventionPath(options.moduleRoot, 'extension-points.ts')
  if (!filePath) return { hosts: [], unresolved: [] }
  const declaration = readRootObject(filePath, 'extensionPoints')
  const hostsObject = declaration && isStaticObject(declaration.hosts) ? declaration.hosts : null
  if (!hostsObject) {
    return {
      hosts: [],
      unresolved: [{
        key: `${options.moduleId}.extension-points`,
        source: { path: portablePath(options.moduleRoot, options.sourceRoot, filePath), symbol: 'extensionPoints' },
        reason: 'unclassified-binding',
      }],
    }
  }

  const hosts: ModuleExtensionHostFact[] = []
  const unresolved: ModuleExtensionUnresolvedFact[] = []
  for (const hostKey of Object.keys(hostsObject).sort((left, right) => left.localeCompare(right))) {
    const host = hostsObject[hostKey]
    if (!isStaticObject(host)) continue
    const family = stringValue(host.family) as ExtensionHostFamily | undefined
    if (!family) continue
    const declarationBound = hasDeclarationBinding(options.moduleRoot, hostKey, host)
    if (!declarationBound) {
      unresolved.push({
        key: `${options.moduleId}.${hostKey}`,
        source: {
          path: stringValue(host.source) ?? portablePath(options.moduleRoot, options.sourceRoot, filePath),
          symbol: `extensionPoints.hosts.${hostKey}`,
        },
        reason: 'unbound-declaration',
      })
    }
    if (family === 'data-table') {
      const tableId = stringValue(host.tableId)
      if (!tableId) continue
      const baseSpotId = stringValue(host.baseSpotId) ?? `data-table:${tableId}`
      for (const surface of DATA_TABLE_EXTENSION_SURFACES) {
        const usesBase = ['header', 'footer', 'toolbar', 'searchTrailing', 'emptyState'].includes(surface.key)
        const id = surface.key === 'replacement'
          ? `data-table:${tableId}`
          : `${usesBase ? baseSpotId : `data-table:${tableId}`}:${surface.suffix}`
        hosts.push(baseHost({
          key: `${hostKey}.${surface.key}`,
          id,
          moduleId: options.moduleId,
          family,
          capabilities: [...surface.capabilities],
          sourceRoot: options.sourceRoot,
          declaration: host,
          bound: surface.bound && declarationBound,
        }))
      }
      continue
    }
    if (family === 'crud-form') {
      const entityId = stringValue(host.entityId)
      if (!entityId) continue
      const spotId = stringValue(host.spotId) ?? `crud-form:${entityId}`
      for (const surface of CRUD_FORM_EXTENSION_SURFACES) {
        const id = surface.suffix ? `${spotId}:${surface.suffix}` : spotId
        const fact = baseHost({
          key: `${hostKey}.${surface.key}`,
          id,
          moduleId: options.moduleId,
          family,
          capabilities: [...surface.capabilities],
          sourceRoot: options.sourceRoot,
          declaration: host,
          bound: surface.bound && declarationBound,
        })
        if (surface.key === 'base') fact.phases = [...CRUD_FORM_LIFECYCLE_PHASES]
        hosts.push(fact)
      }
      continue
    }
    const id = stringValue(host.spotId) ?? stringValue(host.pattern) ?? stringValue(host.componentId)
    if (!id) {
      unresolved.push({
        key: `${options.moduleId}.${hostKey}`,
        source: { path: portablePath(options.moduleRoot, options.sourceRoot, filePath), symbol: hostKey },
        reason: 'dynamic-without-pattern',
      })
      continue
    }
    const capabilities = family === 'component-handle'
      ? ['component-replacement'] as ExtensionHostCapability[]
      : strings(host.supported) as ExtensionHostCapability[]
    const fact = baseHost({
      key: hostKey,
      id,
      moduleId: options.moduleId,
      family,
      capabilities,
      sourceRoot: options.sourceRoot,
      declaration: host,
      bound: declarationBound,
    })
    if (isStaticObject(host.parameters)) {
      fact.patternParameters = Object.fromEntries(Object.entries(host.parameters).flatMap(([key, value]) => {
        if (!isStaticObject(value) || typeof value.source !== 'string') return []
        return [[key, {
          source: value.source,
          ...(typeof value.pattern === 'string' ? { pattern: value.pattern } : {}),
        }]]
      }))
    }
    hosts.push(fact)
  }
  return { hosts: sortHosts(hosts), unresolved }
}

function factRefHost(options: {
  key: string
  id: string
  moduleId: string
  family: ExtensionHostFamily
  capabilities: ExtensionHostCapability[]
  factSection: string
  /** Key inside `factSection`; defaults to the host id when the two coincide. */
  factKey?: string
  phases?: string[]
  activation?: ModuleExtensionHostFact['activation']
  scopeContract?: string
}): ModuleExtensionHostFact {
  return {
    key: options.key,
    id: options.id,
    resolution: 'fact-ref',
    family: options.family,
    ownerModule: options.moduleId,
    capabilities: options.capabilities,
    ...(options.phases ? { phases: options.phases } : {}),
    ...(options.activation ? { activation: options.activation } : {}),
    ...(options.scopeContract ? { scopeContract: options.scopeContract } : {}),
    bound: true,
    stability: 'stable',
    source: { kind: 'fact-ref', factSection: options.factSection, factKey: options.factKey ?? options.id },
  }
}

function sourceFilesBelow(directory: string): string[] {
  const cached = activeExtractionCache?.sourceFilesBelow.get(directory)
  if (cached) return cached
  if (!fs.existsSync(directory)) return []
  const files: string[] = []
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== '__integration__') visit(entryPath)
        continue
      }
      if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) files.push(entryPath)
    }
  }
  visit(directory)
  activeExtractionCache?.sourceFilesBelow.set(directory, files)
  return files
}

function apiRouteId(moduleId: string, moduleRoot: string, filePath: string): string | null {
  const relative = path.relative(path.join(moduleRoot, 'api'), filePath).split(path.sep).join('/')
  if (relative === 'interceptors.ts' || relative === 'openapi.ts') return null
  const withoutExtension = relative.replace(/\.tsx?$/, '')
  const suffix = withoutExtension.endsWith('/route') ? withoutExtension.slice(0, -6) : withoutExtension
  return suffix && !suffix.includes('__tests__') ? `${moduleId.replace(/_/g, '-')}/${suffix}` : null
}

function apiExtensionHostIds(moduleId: string, moduleRoot: string): ApiExtensionHostIds {
  const cacheKey = `${moduleId}\0${moduleRoot}`
  const cached = activeExtractionCache?.apiExtensionHostIds.get(cacheKey)
  if (cached) return cached
  const entityIds = new Set<string>()
  const entitySourceFiles: Record<string, string> = {}
  const commandIds = new Set<string>()
  const routeIds = new Set<string>()
  for (const filePath of sourceFilesBelow(path.join(moduleRoot, 'api'))) {
    const routeId = apiRouteId(moduleId, moduleRoot, filePath)
    if (routeId) routeIds.add(routeId)
    const file = sourceFile(filePath)
    if (!file) continue
    const context = buildStaticContext(file)
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node)) {
        const name = propertyName(node.name)
        if (name === 'commandId') {
          const id = stringValue(staticValue(node.initializer, context))
          if (id) commandIds.add(id)
        }
        if (name === 'enrichers') {
          const config = staticValue(node.initializer, context)
          const entityId = isStaticObject(config) ? stringValue(config.entityId) : undefined
          if (entityId) {
            entityIds.add(entityId)
            if (!entitySourceFiles[entityId]) entitySourceFiles[entityId] = filePath
          }
        }
      }
      if (
        ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === 'validateCrudMutationGuard'
      ) {
        const input = node.arguments[1] ? staticValue(node.arguments[1], context) : undefined
        const entityId = isStaticObject(input) ? stringValue(input.resourceKind) : undefined
        if (entityId) {
          entityIds.add(entityId)
          if (!entitySourceFiles[entityId]) entitySourceFiles[entityId] = filePath
        }
      }
      node.forEachChild(visit)
    }
    file.forEachChild(visit)
  }
  const result = {
    entityIds: [...entityIds].sort((left, right) => left.localeCompare(right)),
    entitySourceFiles,
    commandIds: [...commandIds].sort((left, right) => left.localeCompare(right)),
    routeIds: [...routeIds].sort((left, right) => left.localeCompare(right)),
  }
  activeExtractionCache?.apiExtensionHostIds.set(cacheKey, result)
  return result
}

function moduleCommandIds(moduleRoot: string, apiCommandIds: readonly string[]): string[] {
  const commandIds = new Set(apiCommandIds)
  for (const filePath of sourceFilesBelow(path.join(moduleRoot, 'commands'))) {
    if (path.basename(filePath).replace(/\.(?:ts|tsx)$/, '') === 'interceptors') continue
    for (const id of extractCommandIdsFromSource(filePath)) commandIds.add(id)
  }
  return [...commandIds].sort((left, right) => left.localeCompare(right))
}

export function extractKnownApiRouteIds(moduleId: string, moduleRoot: string): string[] {
  return apiExtensionHostIds(moduleId, moduleRoot).routeIds
}

export function extractKnownCommandIds(moduleId: string, moduleRoot: string): string[] {
  const apiHosts = apiExtensionHostIds(moduleId, moduleRoot)
  return moduleCommandIds(moduleRoot, apiHosts.commandIds)
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export type ApiInterceptorPhase = 'before' | 'after'
export type ApiRouteInterceptorBridge = {
  method: (typeof HTTP_METHODS)[number]
  phases: ApiInterceptorPhase[]
}

const API_INTERCEPTOR_BRIDGE_CALLS: Record<string, ApiInterceptorPhase> = {
  runApiInterceptorsBefore: 'before',
  runApiInterceptorsAfter: 'after',
}

function isHttpMethodName(value: string): value is (typeof HTTP_METHODS)[number] {
  return (HTTP_METHODS as readonly string[]).includes(value)
}

/** HTTP method handlers a route file actually exports. */
function exportedHttpMethods(file: ts.SourceFile): Array<(typeof HTTP_METHODS)[number]> {
  const methods = new Set<(typeof HTTP_METHODS)[number]>()
  const consider = (name: string | undefined): void => {
    if (name && isHttpMethodName(name)) methods.add(name)
  }
  const considerBindingName = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) {
      consider(name.text)
      return
    }
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) considerBindingName(element.name)
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node) && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of node.declarationList.declarations) {
        considerBindingName(declaration.name)
      }
    }
    if (
      ts.isFunctionDeclaration(node)
      && node.name
      && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      consider(node.name.text)
    }
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) consider(element.name.text)
    }
    node.forEachChild(visit)
  }
  file.forEachChild(visit)
  return [...methods].sort((left, right) => left.localeCompare(right))
}

/**
 * The interceptor pipeline runs only where a route wires it: `makeCrudRoute` runs
 * both phases for every method it handles, and a hand-written route runs whichever
 * of `runApiInterceptorsBefore` / `runApiInterceptorsAfter` it calls. A custom route
 * that calls neither has no bridge, so an interceptor targeting it is never bound.
 */
function extractApiRouteInterceptorBridges(file: ts.SourceFile, context: StaticContext): ApiRouteInterceptorBridge[] {
  const exportedMethods = exportedHttpMethods(file)
  const phasesByMethod = new Map<(typeof HTTP_METHODS)[number], Set<ApiInterceptorPhase>>()
  const addPhase = (method: (typeof HTTP_METHODS)[number], phase: ApiInterceptorPhase): void => {
    const phases = phasesByMethod.get(method) ?? new Set<ApiInterceptorPhase>()
    phases.add(phase)
    phasesByMethod.set(method, phases)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const calleeName = node.expression.text
      if (calleeName === 'makeCrudRoute') {
        for (const method of exportedMethods) {
          addPhase(method, 'before')
          addPhase(method, 'after')
        }
      }
      const phase = API_INTERCEPTOR_BRIDGE_CALLS[calleeName]
      if (phase) {
        const callOptions = node.arguments[0] ? staticValue(node.arguments[0], context) : undefined
        const declaredMethod = isStaticObject(callOptions) ? stringValue(callOptions.method) : undefined
        const methods = declaredMethod && isHttpMethodName(declaredMethod) ? [declaredMethod] : exportedMethods
        for (const method of methods) addPhase(method, phase)
      }
    }
    node.forEachChild(visit)
  }
  file.forEachChild(visit)
  return [...phasesByMethod.entries()]
    .map(([method, phases]) => ({
      method,
      phases: [...phases].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.method.localeCompare(right.method))
}

/**
 * Concrete runtime-id owners a module contributes as activation targets: its real
 * `api/**` route ids (with the interceptor bridges each route actually wires) and
 * its `commands/**` command ids (dispatched through the command bus). Used
 * post-selection to synthesize `host-reference`/`owner-reference` bindings with a
 * portable source.
 */
export function extractActivationTargetOwners(options: {
  moduleId: string
  moduleRoot: string
  sourceRoot: string
}): {
  apiRoutes: Array<{ id: string; source: ModuleFactSourceRef; bridges: ApiRouteInterceptorBridge[] }>
  commands: Array<{ id: string; source: ModuleFactSourceRef }>
} {
  const apiRoutes: Array<{ id: string; source: ModuleFactSourceRef; bridges: ApiRouteInterceptorBridge[] }> = []
  for (const filePath of sourceFilesBelow(path.join(options.moduleRoot, 'api'))) {
    const routeId = apiRouteId(options.moduleId, options.moduleRoot, filePath)
    if (!routeId) continue
    const file = sourceFile(filePath)
    const bridges = file ? extractApiRouteInterceptorBridges(file, buildStaticContext(file)) : []
    apiRoutes.push({
      id: routeId,
      source: { sourcePath: portablePath(options.moduleRoot, options.sourceRoot, filePath) },
      bridges,
    })
  }
  const commands: Array<{ id: string; source: ModuleFactSourceRef }> = []
  const seenCommands = new Set<string>()
  for (const filePath of sourceFilesBelow(path.join(options.moduleRoot, 'commands'))) {
    if (path.basename(filePath).replace(/\.(?:ts|tsx)$/, '') === 'interceptors') continue
    const source: ModuleFactSourceRef = { sourcePath: portablePath(options.moduleRoot, options.sourceRoot, filePath) }
    for (const id of extractCommandIdsFromSource(filePath)) {
      if (seenCommands.has(id)) continue
      seenCommands.add(id)
      commands.push({ id, source })
    }
  }
  return { apiRoutes, commands }
}

function extractFactRefHosts(options: ExtractModuleExtensionFactsOptions): ModuleExtensionHostFact[] {
  const hosts: ModuleExtensionHostFact[] = []
  for (const entity of options.entities) {
    hosts.push(factRefHost({
      key: `entity.${entity.id}`,
      id: entity.id,
      moduleId: options.moduleId,
      family: 'entity',
      capabilities: ['response-enricher', 'query-enricher', 'mutation-guard', 'entity-extension'],
      factSection: 'entities',
      activation: 'host-opt-in',
      scopeContract: 'tenant-and-organization',
    }))
  }
  for (const route of options.apiRoutes) {
    hosts.push(factRefHost({
      key: `api-route.${route.path}`,
      id: route.path,
      moduleId: options.moduleId,
      family: 'api-route',
      capabilities: ['api-interceptor', 'mutation-guard'],
      factSection: 'apiRoutes',
      phases: ['before', 'after'],
      activation: 'host-opt-in',
      scopeContract: 'request-auth-scope',
    }))
  }
  for (const event of options.events) {
    const capabilities: ExtensionHostCapability[] = ['async-subscriber', 'sync-subscriber']
    if (event.clientBroadcast) capabilities.push('browser-client')
    if (event.portalBroadcast) capabilities.push('browser-portal')
    hosts.push(factRefHost({
      key: `event.${event.id}`,
      id: event.id,
      moduleId: options.moduleId,
      family: 'event',
      capabilities,
      factSection: 'events',
      scopeContract: 'tenant-organization-and-audience',
    }))
  }
  for (const entityId of options.searchEntities) {
    const eventStem = entityId.replace(':', '.')
    for (const phase of ['querying', 'queried'] as const) {
      hosts.push(factRefHost({
        key: `query-lifecycle.${eventStem}.${phase}`,
        id: `${eventStem}.${phase}`,
        moduleId: options.moduleId,
        family: 'query-lifecycle',
        capabilities: ['sync-subscriber'],
        factSection: 'searchEntities',
        factKey: entityId,
        phases: phase === 'querying' ? ['block', 'query-transform'] : ['result-transform', 'scope-reapply'],
        activation: 'caller-opt-in',
        scopeContract: 'tenant-and-organization-reapplied-after-result',
      }))
    }
  }
  const apiHosts = apiExtensionHostIds(options.moduleId, options.moduleRoot)
  for (const entityId of apiHosts.entityIds) {
    const declaringFile = apiHosts.entitySourceFiles[entityId]
    const host = factRefHost({
      key: `api-entity.${entityId}`,
      id: entityId,
      moduleId: options.moduleId,
      family: 'entity',
      capabilities: ['response-enricher', 'query-enricher', 'mutation-guard'],
      factSection: 'apiRoutes',
      activation: 'host-opt-in',
      scopeContract: 'tenant-and-organization',
    })
    hosts.push(declaringFile
      ? {
          ...host,
          source: {
            kind: 'declaration',
            path: portablePath(options.moduleRoot, options.sourceRoot, declaringFile),
            symbol: entityId,
          },
        }
      : host)
  }
  return sortHosts([...new Map(hosts.map((host) => [`${host.family}:${host.id}`, host])).values()])
}

function contributionBase(
  id: string,
  sourcePath: string,
  sourceSymbol?: string,
): ModuleExtensionContributionBase {
  return {
    id,
    targets: [],
    scopeContract: 'tenant-and-organization',
    source: { path: sourcePath, ...(sourceSymbol ? { symbol: sourceSymbol } : {}) },
  }
}

/**
 * `ModuleInjectionTable` maps a spot to `ModuleInjectionSlot | ModuleInjectionSlot[]`,
 * and a slot is either a bare widget-id string or a placement object. The runtime
 * loader normalizes all three shapes (`injection-loader.ts` → `loadInjectionTable`);
 * reading only the array form here silently dropped every string and single-object
 * slot from the generated contribution facts.
 */
function injectionTableSlots(value: StaticValue | undefined): StaticValue[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function extractInjectionTable(options: ExtractModuleExtensionFactsOptions): ModuleExtensionContributionFact[] {
  const filePath = conventionPath(options.moduleRoot, 'widgets/injection-table.ts')
  if (!filePath) return []
  const table = readRootObject(filePath, 'injectionTable')
  if (!table) return []
  const sourcePath = portablePath(options.moduleRoot, options.sourceRoot, filePath)
  const facts: ModuleExtensionContributionFact[] = []
  for (const targetId of Object.keys(table).sort((left, right) => left.localeCompare(right))) {
    for (const entry of injectionTableSlots(table[targetId])) {
      const slot = isStaticObject(entry) ? entry : null
      const widgetId = typeof entry === 'string' ? entry : slot ? stringValue(slot.widgetId) : undefined
      if (!widgetId) continue
      const features = slot ? strings(slot.features) : []
      const priority = slot ? numberValue(slot.priority) : undefined
      const payload = targetId.endsWith(':columns') ? 'column'
        : targetId.endsWith(':row-actions') ? 'row-action'
          : targetId.endsWith(':bulk-actions') ? 'bulk-action'
            : targetId.endsWith(':filters') ? 'filter'
              : targetId.endsWith(':fields') ? 'field'
                : 'render'
      const base = contributionBase(`${widgetId}@${targetId}`, sourcePath, 'injectionTable')
      const shared = {
        ...base,
        targets: [target(targetId)],
        features,
        placement: priority !== undefined ? { priority } : undefined,
      }
      if (targetId.startsWith('data-table:')) {
        facts.push({
          ...shared,
          kind: 'data-table',
          details: {
            payload: payload === 'field' ? 'render' : payload,
            tableId: targetId.replace(/^data-table:/, '').replace(/:(?:columns|row-actions|bulk-actions|filters|toolbar|header|footer|search-trailing)$/, ''),
            executionGuard: features.length > 0 ? 'both' : 'host',
          },
        })
      } else if (targetId.startsWith('crud-form:')) {
        facts.push({
          ...shared,
          kind: 'crud-form',
          details: {
            payload: payload === 'field' ? 'field' : 'render',
            entityId: targetId.replace(/^crud-form:/, '').replace(/:(?:fields|header)$/, ''),
            requestHeaderCapability: payload === 'field',
          },
        })
      } else {
        facts.push({
          ...shared,
          kind: 'widget',
          details: {
            payload: 'render',
            registryKey: widgetId,
            executionGuard: features.length > 0 ? 'both' : 'host',
          },
        })
      }
    }
  }
  return facts
}

function extractObjectConvention(options: {
  module: ExtractModuleExtensionFactsOptions
  relativePath: string
  exportName: string
  exportAliases?: string[]
  build: (entry: StaticObject, sourcePath: string, index: number) => ModuleExtensionContributionFact | null
}): ModuleExtensionContributionFact[] {
  const filePath = conventionPath(options.module.moduleRoot, options.relativePath)
  if (!filePath) return []
  const exportNames = [options.exportName, ...(options.exportAliases ?? [])]
  const entries = exportNames.reduce<StaticObject[]>((found, exportName) =>
    found.length > 0 ? found : readConventionObjectArray(filePath, exportName), [])
  const sourcePath = portablePath(options.module.moduleRoot, options.module.sourceRoot, filePath)
  return entries.flatMap((entry, index) => options.build(entry, sourcePath, index) ?? [])
}

function methodPhases(entry: StaticObject, map: ReadonlyArray<[string, string]>): string[] {
  return map.flatMap(([property, phase]) => entry[property] === true ? [phase] : [])
}

function extractEnrichers(options: ExtractModuleExtensionFactsOptions): ModuleExtensionContributionFact[] {
  return extractObjectConvention({
    module: options,
    relativePath: 'data/enrichers.ts',
    exportName: 'enrichers',
    build(entry, sourcePath, index) {
      const id = stringValue(entry.id) ?? `${options.moduleId}.enricher.${index}`
      const targetEntity = stringValue(entry.targetEntity)
      if (!targetEntity) return null
      const timeoutMs = numberValue(entry.timeout) ?? 2000
      const queryEngineConfig = isStaticObject(entry.queryEngine) ? entry.queryEngine : null
      // `enricher-registry` selects query-engine enrichers by `queryEngine.enabled === true`,
      // so a config object that omits it (or sets it false) is NOT query-enabled.
      const queryEngine = queryEngineConfig && booleanValue(queryEngineConfig.enabled) === true
        ? queryEngineConfig
        : null
      const surfaces = [entry.enrichMany === true ? 'list' : null, entry.enrichOne === true ? 'detail' : null]
        .filter((value): value is 'list' | 'detail' => value !== null)
      const base = contributionBase(id, sourcePath, id)
      return {
        ...base,
        kind: 'response-enricher',
        targets: [openTarget(targetEntity)],
        features: strings(entry.features),
        phases: surfaces,
        activation: queryEngine ? 'caller-opt-in' : 'host-opt-in',
        roundTripId: `${targetEntity}:read`,
        details: {
          targetEntity,
          surfaces,
          timeoutMs,
          fallback: entry.fallback === undefined ? 'none' : 'configured',
          critical: booleanValue(entry.critical) ?? false,
          cachePosture: 'rerun-on-list-cache-hit',
          ...(queryEngine ? { queryEngine: {
            engines: strings(queryEngine.engines),
            applyOn: (strings(queryEngine.applyOn).length > 0 ? strings(queryEngine.applyOn) : ['list', 'detail'])
              .filter((value): value is 'list' | 'detail' => value === 'list' || value === 'detail'),
            activation: 'caller-opt-in' as const,
          } } : {}),
        },
      }
    },
  })
}

function extractApiInterceptors(options: ExtractModuleExtensionFactsOptions): ModuleExtensionContributionFact[] {
  return extractObjectConvention({
    module: options,
    relativePath: 'api/interceptors.ts',
    exportName: 'interceptors',
    build(entry, sourcePath, index) {
      const id = stringValue(entry.id) ?? `${options.moduleId}.api-interceptor.${index}`
      const targetRoute = stringValue(entry.targetRoute)
      if (!targetRoute) return null
      const phases = methodPhases(entry, [['before', 'before'], ['after', 'after']])
        .filter((phase): phase is 'before' | 'after' => phase === 'before' || phase === 'after')
      const methods = strings(entry.methods)
      const base = contributionBase(id, sourcePath, id)
      return {
        ...base,
        kind: 'api-interceptor',
        targets: [openTarget(targetRoute)],
        phases,
        features: strings(entry.features),
        details: {
          route: targetRoute,
          methods,
          phases,
          activation: targetRoute.startsWith('/') ? 'custom-route-bridge' : 'crud-pipeline',
          timeoutMs: numberValue(entry.timeout) ?? 2000,
          failurePosture: booleanValue(entry.critical) ? 'fail-closed' : 'fallback',
        },
      }
    },
  })
}

function extractCommandInterceptors(options: ExtractModuleExtensionFactsOptions): ModuleExtensionContributionFact[] {
  return extractObjectConvention({
    module: options,
    relativePath: 'commands/interceptors.ts',
    exportName: 'interceptors',
    build(entry, sourcePath, index) {
      const id = stringValue(entry.id) ?? `${options.moduleId}.command-interceptor.${index}`
      const targetCommand = stringValue(entry.targetCommand)
      if (!targetCommand) return null
      const phases = methodPhases(entry, [
        ['beforeExecute', 'before-execute'],
        ['afterExecute', 'after-execute'],
        ['beforeUndo', 'before-undo'],
        ['afterUndo', 'after-undo'],
      ]).filter((phase): phase is 'before-execute' | 'after-execute' | 'before-undo' | 'after-undo' =>
        phase === 'before-execute' || phase === 'after-execute' || phase === 'before-undo' || phase === 'after-undo')
      const base = contributionBase(id, sourcePath, id)
      return {
        ...base,
        kind: 'command-interceptor',
        targets: [openTarget(targetCommand)],
        phases,
        features: strings(entry.features),
        details: { targetCommand, phases },
      }
    },
  })
}

function extractGuards(options: ExtractModuleExtensionFactsOptions): ModuleExtensionContributionFact[] {
  return extractObjectConvention({
    module: options,
    relativePath: 'data/guards.ts',
    exportName: 'guards',
    build(entry, sourcePath, index) {
      const id = stringValue(entry.id) ?? `${options.moduleId}.guard.${index}`
      const targetEntity = stringValue(entry.targetEntity)
      if (!targetEntity) return null
      const operations = strings(entry.operations)
        .filter((operation): operation is 'create' | 'update' | 'delete' =>
          operation === 'create' || operation === 'update' || operation === 'delete')
      const capabilities = [entry.validate === true ? 'block' : null, entry.validate === true ? 'rewrite' : null, entry.afterSuccess === true ? 'after-success' : null]
        .filter((value): value is 'block' | 'rewrite' | 'after-success' => value !== null)
      const base = contributionBase(id, sourcePath, id)
      return {
        ...base,
        kind: 'mutation-guard',
        targets: [openTarget(targetEntity)],
        operations,
        features: strings(entry.features),
        roundTripId: `${targetEntity}:write`,
        details: { entityId: targetEntity, operations, capabilities, optimisticLock: 'preserved' },
      }
    },
  })
}

function extractEntityExtensions(options: ExtractModuleExtensionFactsOptions): ModuleExtensionContributionFact[] {
  return extractObjectConvention({
    module: options,
    relativePath: 'data/extensions.ts',
    exportName: 'entityExtensions',
    exportAliases: ['extensions'],
    build(entry, sourcePath, index) {
      const baseEntity = stringValue(entry.base)
      const extensionEntity = stringValue(entry.extension)
      const join = isStaticObject(entry.join) ? entry.join : null
      if (!baseEntity || !extensionEntity || !join) return null
      const id = `${options.moduleId}.entity-extension.${index}:${baseEntity}->${extensionEntity}`
      const contribution = contributionBase(id, sourcePath, 'extensions')
      return {
        ...contribution,
        kind: 'entity-extension',
        targets: [openTarget(baseEntity)],
        details: {
          hostEntityId: baseEntity,
          extensionEntityId: extensionEntity,
          linkId: `${stringValue(join.baseKey) ?? 'id'}:${stringValue(join.extensionKey) ?? 'id'}`,
          scopeContract: 'tenant-and-organization',
          orphanContract: booleanValue(entry.required) ? 'required' : 'optional',
        },
      }
    },
  })
}

function extractSubscribers(options: ExtractModuleExtensionFactsOptions): ModuleExtensionContributionFact[] {
  const directory = path.join(options.moduleRoot, 'subscribers')
  if (!fs.existsSync(directory)) return []
  const facts: ModuleExtensionContributionFact[] = []
  for (const filePath of sourceFilesBelow(directory)) {
    const metadata = readRootObject(filePath, 'metadata')
    if (!metadata) continue
    const event = stringValue(metadata.event)
    if (!event) continue
    const relativeStem = path.relative(directory, filePath).replace(/\.tsx?$/, '').split(path.sep).join('/')
    const subscriberId = stringValue(metadata.id) ?? `${options.moduleId}:${relativeStem}`
    const persistent = booleanValue(metadata.persistent) ?? false
    const sync = booleanValue(metadata.sync) ?? !persistent
    const contribution = contributionBase(subscriberId, portablePath(options.moduleRoot, options.sourceRoot, filePath), 'metadata')
    facts.push({
      ...contribution,
      kind: 'subscriber',
      targets: [openTarget(event)],
      phases: sync ? ['before-or-after'] : ['async-delivery'],
      details: {
        event,
        subscriberId,
        persistent,
        sync,
        ...(numberValue(metadata.priority) !== undefined ? { priority: numberValue(metadata.priority) as number } : {}),
      },
    })
  }
  return facts
}

function extractBrowserReactions(options: ExtractModuleExtensionFactsOptions): ModuleExtensionContributionFact[] {
  return options.events.flatMap((event) => {
    const transports = [event.clientBroadcast ? 'client' : null, event.portalBroadcast ? 'portal' : null]
      .filter((value): value is 'client' | 'portal' => value !== null)
    if (transports.length === 0) return []
    const contribution = contributionBase(`${event.id}.browser`, path.posix.join(options.sourceRoot, 'events.ts'), 'events')
    return [{
      ...contribution,
      kind: 'browser-reaction' as const,
      targets: [factTarget(event.id, 'events')],
      details: {
        transports,
        hooks: transports.flatMap((transport) => transport === 'client' ? ['useAppEvent', 'useOperationProgress'] : ['usePortalAppEvent']),
        audienceScopeContract: 'tenant-organization-user-role-and-customer',
      },
    }]
  })
}

function extractNotificationReactions(options: ExtractModuleExtensionFactsOptions): ModuleExtensionContributionFact[] {
  return extractObjectConvention({
    module: options,
    relativePath: 'notifications.handlers.ts',
    exportName: 'notificationHandlers',
    build(entry, sourcePath, index) {
      const notificationType = stringValue(entry.notificationType)
      if (!notificationType) return null
      const declaredId = stringValue(entry.id)
      const id = declaredId ?? `${options.moduleId}.notification-handler.${index}`
      const contribution = contributionBase(id, sourcePath, 'notificationHandlers')
      return {
        ...contribution,
        kind: 'browser-reaction',
        targets: [factTarget(notificationType, 'notifications')],
        features: strings(entry.features),
        placement: numberValue(entry.priority) !== undefined ? { priority: numberValue(entry.priority) } : undefined,
        details: {
          transports: ['notification-effect'],
          hooks: ['useNotificationEffect'],
          audienceScopeContract: 'tenant-organization-user-role-and-customer',
          ...(declaredId ? { overrideKey: declaredId } : {}),
        },
      }
    },
  })
}

function extractComponentOverrides(options: ExtractModuleExtensionFactsOptions): ModuleExtensionContributionFact[] {
  return extractObjectConvention({
    module: options,
    relativePath: 'widgets/components.ts',
    exportName: 'componentOverrides',
    build(entry, sourcePath, index) {
      const targetDefinition = isStaticObject(entry.target) ? entry.target : null
      const handle = targetDefinition ? stringValue(targetDefinition.componentId) : undefined
      if (!handle) return null
      // `ComponentOverride` discriminates on `wrapper` / `propsTransform` /
      // `replacement` — never on a `props` property, which the union has no member for.
      const mode = entry.wrapper !== undefined ? 'wrapper' : entry.propsTransform !== undefined ? 'props' : 'replace'
      const id = `${options.moduleId}.component-override.${index}:${handle}`
      const contribution = contributionBase(id, sourcePath, 'componentOverrides')
      return {
        ...contribution,
        kind: 'component-override',
        targets: [target(handle)],
        details: {
          handle,
          mode,
          propsContract: stringValue(entry.propsContract) ?? 'component-props-schema',
        },
      }
    },
  })
}

function extractSpecializedRegistries(options: ExtractModuleExtensionFactsOptions): ModuleExtensionContributionFact[] {
  const facts: ModuleExtensionContributionFact[] = []
  const add = (
    id: string,
    registry: SpecializedRegistry,
    sourcePath: string,
    specialistRoute: string,
    symbol = id,
  ): void => {
    const contributionId = `${registry}:${id}`
    const contribution = contributionBase(contributionId, sourcePath, id)
    const fact: ModuleExtensionContributionFact = {
      ...contribution,
      kind: 'specialized-registry',
      targets: [factTarget(id, specialistRoute)],
      source: { path: sourcePath, symbol },
      details: { registry, registryId: id, specialistRoute },
    }
    const existingIndex = facts.findIndex((entry) => entry.id === contributionId)
    if (existingIndex >= 0) facts[existingIndex] = fact
    else facts.push(fact)
  }
  for (const id of options.notifications ?? []) add(id, 'notification', path.posix.join(options.sourceRoot, 'notifications.ts'), 'notifications')
  for (const id of options.searchEntities) add(id, 'search', path.posix.join(options.sourceRoot, 'search.ts'), 'search')
  for (const tool of options.aiTools ?? []) add(tool.name, 'ai', tool.sourcePath, 'aiTools')
  for (const agent of options.aiAgents ?? []) add(agent.id, 'ai', agent.sourcePath, 'aiAgents')

  const vectorPath = conventionPath(options.moduleRoot, 'vector.ts')
  if (vectorPath) {
    const vectorConfig = readRootObject(vectorPath, 'vectorConfig') ?? readRootObject(vectorPath, 'config')
    const sourcePath = portablePath(options.moduleRoot, options.sourceRoot, vectorPath)
    if (vectorConfig && Array.isArray(vectorConfig.entities)) {
      for (const entity of vectorConfig.entities) {
        if (!isStaticObject(entity)) continue
        const entityId = stringValue(entity.entityId)
        if (entityId) add(entityId, 'vector', sourcePath, 'vector', 'vectorConfig')
      }
    }
  }

  const integrationPath = conventionPath(options.moduleRoot, 'integration.ts')
  if (integrationPath) {
    const sourcePath = portablePath(options.moduleRoot, options.sourceRoot, integrationPath)
    const addIntegration = (integration: StaticObject, symbol: string, bundleId?: string): void => {
      const integrationId = stringValue(integration.id)
      if (integrationId) {
        add(integrationId, 'integration', sourcePath, 'integrations', bundleId ? `${symbol}[${bundleId}]` : symbol)
      }
      const providerKey = stringValue(integration.providerKey)
      const category = stringValue(integration.category)
      const categoryRegistry = category === 'payment' ? 'payment'
        : category === 'shipping' ? 'shipping'
          : category === 'currency' ? 'currency'
            : null
      if (providerKey && categoryRegistry) {
        const specialistRoute = categoryRegistry === 'payment' ? 'paymentGateways'
          : categoryRegistry === 'shipping' ? 'shippingCarriers'
            : 'currencies'
        add(providerKey, categoryRegistry, sourcePath, specialistRoute, `${symbol}.providerKey`)
      }
    }
    const singular = readRootObject(integrationPath, 'integration')
    if (singular) addIntegration(singular, 'integration')
    for (const integration of readConventionObjectArray(integrationPath, 'integrations')) {
      addIntegration(integration, 'integrations')
    }
    const bundle = readRootObject(integrationPath, 'integrationBundle') ?? readRootObject(integrationPath, 'bundle')
    if (bundle) {
      const bundleId = stringValue(bundle.id) ?? 'bundle'
      const members = Array.isArray(bundle.integrations) ? bundle.integrations : []
      for (const member of members) {
        if (isStaticObject(member)) addIntegration(member, 'integrationBundle', bundleId)
      }
    }
  }

  const workflowsPath = conventionPath(options.moduleRoot, 'workflows.ts')
  if (workflowsPath) {
    const config = readRootObject(workflowsPath, 'workflowsConfig')
    const sourcePath = portablePath(options.moduleRoot, options.sourceRoot, workflowsPath)
    if (config && Array.isArray(config.workflows)) {
      for (const workflow of config.workflows) {
        if (!isStaticObject(workflow)) continue
        const workflowId = stringValue(workflow.workflowId)
        if (workflowId) add(workflowId, 'workflow', sourcePath, 'workflows', 'workflowsConfig')
      }
    }
  }

  const diPath = conventionPath(options.moduleRoot, 'di.ts')
  if (diPath) {
    const sourcePath = portablePath(options.moduleRoot, options.sourceRoot, diPath)
    const registrations = readCallObjectArguments(diPath, new Set([
      'registerPaymentGatewayDescriptor',
      'registerShippingAdapter',
      'registerCurrencyProvider',
    ]))
    for (const registration of registrations) {
      const registry = registration.callee === 'registerPaymentGatewayDescriptor' ? 'payment'
        : registration.callee === 'registerShippingAdapter' ? 'shipping'
          : 'currency'
      const registryId = stringValue(registration.value.providerKey)
        ?? stringValue(registration.value.key)
        ?? stringValue(registration.value.id)
      if (!registryId) continue
      const specialistRoute = registry === 'payment' ? 'paymentGateways'
        : registry === 'shipping' ? 'shippingCarriers'
          : 'currencies'
      add(registryId, registry, sourcePath, specialistRoute, registration.callee)
    }
  }

  const dashboardRoots = { appBase: path.join(options.moduleRoot, '__app__'), pkgBase: options.moduleRoot }
  for (const widgetFile of scanModuleDir(dashboardRoots, SCAN_CONFIGS.dashboardWidgets)) {
    const filePath = path.join(options.moduleRoot, 'widgets', 'dashboard', widgetFile.relPath)
    const widget = readRootObject(filePath, 'widget')
    const metadata = widget && isStaticObject(widget.metadata) ? widget.metadata : null
    if (!metadata) continue
    const widgetId = stringValue(metadata.id)
    if (!widgetId) continue
    const sourcePath = portablePath(options.moduleRoot, options.sourceRoot, filePath)
    const contribution = contributionBase(`dashboard:${widgetId}`, sourcePath, 'widget.metadata')
    facts.push({
      ...contribution,
      kind: 'widget',
      targets: [target(`dashboard:${widgetId}`)],
      features: strings(metadata.features),
      details: {
        payload: 'dashboard',
        registryKey: widgetId,
        executionGuard: strings(metadata.features).length > 0 ? 'both' : 'host',
      },
    })
  }
  return facts
}

/**
 * Closed activation-adapter registry (Spec 2). Each `ModuleExtensionActivationKind`
 * maps to the contribution kinds it can bind and to the mode by which a `bound`
 * resolution is proven:
 *
 * - `call-site-object` — the host module owns a distinct opt-in call site (a
 *   `makeCrudRoute` option or a mutation-guard bridge). Presence of the option —
 *   NOT mere entity/route existence — produces an emitted `ModuleExtensionActivation`
 *   object. This is what makes "the entity could host X" (capability-only) different
 *   from "this route actually activates X" (bound).
 * - `host-reference` — the runtime bridge is universal for any matching host
 *   (every api route runs the interceptor pipeline; a bound widget/component host
 *   proves consumption). No object is duplicated; `bound` is derived from the
 *   existing bound host fact and the incoming row carries no `activationId`.
 * - `owner-reference` — like host-reference but proven by the target module owning
 *   the concrete runtime id (command ids have no host fact of their own).
 *
 * The registry is exhaustive by construction: the `Record` key set is the full
 * `ModuleExtensionActivationKind` union, so adding a kind fails the typecheck until
 * it is classified. `activation-adapter-coverage.test.ts` re-checks this at runtime.
 */
type ActivationAdapterMode = 'call-site-object' | 'host-reference' | 'owner-reference'

export const ACTIVATION_ADAPTERS: Record<ModuleExtensionActivationKind, {
  contributionKinds: ModuleExtensionContributionKind[]
  mode: ActivationAdapterMode
}> = {
  'crud-response-enricher': { contributionKinds: ['response-enricher'], mode: 'call-site-object' },
  'query-enricher': { contributionKinds: ['response-enricher'], mode: 'call-site-object' },
  'mutation-guard': { contributionKinds: ['mutation-guard'], mode: 'call-site-object' },
  'api-interceptor-bridge': { contributionKinds: ['api-interceptor'], mode: 'host-reference' },
  'command-interceptor-bridge': { contributionKinds: ['command-interceptor'], mode: 'owner-reference' },
  'widget-injection-consumer': { contributionKinds: ['widget', 'data-table', 'crud-form'], mode: 'host-reference' },
  'component-extension-consumer': { contributionKinds: ['component-override'], mode: 'host-reference' },
  'dashboard-host-consumer': { contributionKinds: ['widget'], mode: 'host-reference' },
}

/**
 * Every UMES contribution kind classified against the activation registry: either
 * the ordered set of activation kinds that can bind it, or `capability-only` for
 * contributions that are always active by declaration/registration and never gain
 * a route/entity activation. Exhaustive by `Record` construction — a new kind fails
 * the typecheck until classified.
 */
export const CONTRIBUTION_ACTIVATION_CLASSIFICATION: Record<
  ModuleExtensionContributionKind,
  ModuleExtensionActivationKind[] | 'capability-only'
> = {
  'response-enricher': ['crud-response-enricher', 'query-enricher'],
  'mutation-guard': ['mutation-guard'],
  'api-interceptor': ['api-interceptor-bridge'],
  'command-interceptor': ['command-interceptor-bridge'],
  'widget': ['widget-injection-consumer', 'dashboard-host-consumer'],
  'data-table': ['widget-injection-consumer'],
  'crud-form': ['widget-injection-consumer'],
  'component-override': ['component-extension-consumer'],
  'entity-extension': 'capability-only',
  'subscriber': 'capability-only',
  'browser-reaction': 'capability-only',
  'specialized-registry': 'capability-only',
  'module-override': 'capability-only',
}

export const ALL_ACTIVATION_KINDS = Object.keys(ACTIVATION_ADAPTERS) as ModuleExtensionActivationKind[]
export const ALL_CONTRIBUTION_KINDS = Object.keys(CONTRIBUTION_ACTIVATION_CLASSIFICATION) as ModuleExtensionContributionKind[]

/**
 * Verified mutation-guard bridge shapes. The canonical route helper nests the
 * resource under `input` (`runRouteMutationGuards({ …, input: { resourceKind } })`),
 * while the legacy helpers take the resource object directly. Module wrappers around
 * the canonical helper live under `lib/` as often as under `api/`, so both trees are
 * scanned.
 */
const MUTATION_GUARD_BRIDGE_ADAPTERS: Record<string, { resourceArgument: 'input-property' | 'any-argument' }> = {
  runRouteMutationGuards: { resourceArgument: 'input-property' },
  validateCrudMutationGuard: { resourceArgument: 'any-argument' },
  runMutationGuards: { resourceArgument: 'any-argument' },
}

const MUTATION_GUARD_SOURCE_DIRECTORIES = ['api', 'lib'] as const

const MUTATION_GUARD_OPERATIONS = new Set(['create', 'update', 'delete', 'custom'])

/**
 * `'custom'` action endpoints are mapped by `toRegistryMutationOperation` onto the
 * closest registry operation, `'update'`.
 */
function toRegistryGuardOperation(operation: string): string {
  return operation === 'custom' ? 'update' : operation
}

function readMutationGuardBridge(
  node: ts.CallExpression,
  context: StaticContext,
): { entityId: string; operations: string[] } | null {
  const callee = node.expression
  const calleeName = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : null
  const adapter = calleeName ? MUTATION_GUARD_BRIDGE_ADAPTERS[calleeName] : undefined
  if (!adapter) return null

  const argumentObjects = node.arguments
    .map((argument) => staticValue(argument, context))
    .filter(isStaticObject)
  const resourceObjects = adapter.resourceArgument === 'input-property'
    ? argumentObjects.flatMap((argumentObject) => (isStaticObject(argumentObject.input) ? [argumentObject.input] : []))
    : argumentObjects
  for (const resourceObject of resourceObjects) {
    const entityId = stringValue(resourceObject.resourceKind) ?? stringValue(resourceObject.entityId)
    if (!entityId) continue
    const declaredOperation = stringValue(resourceObject.operation)
    const operations = declaredOperation && MUTATION_GUARD_OPERATIONS.has(declaredOperation)
      ? [toRegistryGuardOperation(declaredOperation)]
      : []
    return { entityId, operations }
  }
  return null
}

function nodeLine(file: ts.SourceFile, node: ts.Node): number {
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
}

function activationId(host: ModuleExtensionTargetRef, kind: ModuleExtensionActivationKind): string {
  const method = host.method ? `:${host.method}` : ''
  return `${host.kind}:${host.id}${method}:${kind}`
}

function sortActivations(activations: ModuleExtensionActivation[]): ModuleExtensionActivation[] {
  return [...activations].sort((left, right) => left.id.localeCompare(right.id))
}

/**
 * Extract the `call-site-object` activations (CRUD response/query enrichers and
 * mutation guards) from a module's real `api/**` opt-in sites. Entity or route
 * presence alone never lands here — only a literal `enrichers: { entityId }`
 * option or a mutation-guard bridge call with a static `resourceKind`/`entityId`.
 */
/**
 * `<engine>.query(entityId, { …, extensions })` — the only call shape that enables the
 * query-engine enricher and sync query-lifecycle stages.
 */
function isQueryWithExtensionsCall(node: ts.Node, context: StaticContext): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false
  const callee = node.expression
  const calleeName = ts.isPropertyAccessExpression(callee)
    ? callee.name.text
    : ts.isIdentifier(callee)
      ? callee.text
      : null
  if (calleeName !== 'query') return false
  const queryOptions = node.arguments[1] ? staticValue(node.arguments[1], context) : undefined
  return isStaticObject(queryOptions) && queryOptions.extensions !== undefined
}

function extractCallSiteActivations(options: ExtractModuleExtensionFactsOptions): ModuleExtensionActivation[] {
  const activations: ModuleExtensionActivation[] = []
  const byId = new Map<string, ModuleExtensionActivation>()
  const push = (activation: ModuleExtensionActivation): void => {
    const existing = byId.get(activation.id)
    if (existing) {
      if (!existing.operations || !activation.operations) {
        delete existing.operations
      } else {
        existing.operations = [...new Set([...existing.operations, ...activation.operations])]
          .sort((left, right) => left.localeCompare(right))
      }
      return
    }
    byId.set(activation.id, activation)
    activations.push(activation)
  }
  const scannedFiles = MUTATION_GUARD_SOURCE_DIRECTORIES
    .flatMap((directory) => sourceFilesBelow(path.join(options.moduleRoot, directory)))
  for (const filePath of scannedFiles) {
    const file = sourceFile(filePath)
    if (!file) continue
    const context = buildStaticContext(file)
    const sourcePath = portablePath(options.moduleRoot, options.sourceRoot, filePath)
    const visit = (node: ts.Node): void => {
      // `enrichers: { entityId }` on a CRUD route runs `applyResponseEnrichers` after the
      // list/detail hook. It does NOT enable the query-engine enricher stage.
      if (ts.isPropertyAssignment(node) && propertyName(node.name) === 'enrichers') {
        const config = staticValue(node.initializer, context)
        const entityId = isStaticObject(config) ? stringValue(config.entityId) : undefined
        if (entityId) {
          const host: ModuleExtensionTargetRef = { kind: 'entity', id: entityId, moduleId: options.moduleId }
          push({
            id: activationId(host, 'crud-response-enricher'),
            kind: 'crud-response-enricher',
            host,
            contributionKinds: ['response-enricher'],
            source: { sourcePath, line: nodeLine(file, node) },
          })
        }
      }
      // The query-engine enricher stage runs only for a query that passes `extensions`,
      // so the bound call site is `queryEngine.query('<entityId>', { …, extensions })`.
      if (isQueryWithExtensionsCall(node, context)) {
        const entityId = stringValue(staticValue(node.arguments[0], context))
        if (entityId) {
          const host: ModuleExtensionTargetRef = { kind: 'entity', id: entityId, moduleId: options.moduleId }
          push({
            id: activationId(host, 'query-enricher'),
            kind: 'query-enricher',
            host,
            contributionKinds: ['response-enricher'],
            source: { sourcePath, line: nodeLine(file, node) },
          })
        }
      }
      if (ts.isCallExpression(node)) {
        const bridge = readMutationGuardBridge(node, context)
        if (bridge) {
          const host: ModuleExtensionTargetRef = { kind: 'entity', id: bridge.entityId, moduleId: options.moduleId }
          push({
            id: activationId(host, 'mutation-guard'),
            kind: 'mutation-guard',
            host,
            contributionKinds: ['mutation-guard'],
            ...(bridge.operations.length > 0 ? { operations: bridge.operations } : {}),
            source: { sourcePath, line: nodeLine(file, node) },
          })
        }
      }
      node.forEachChild(visit)
    }
    file.forEachChild(visit)
  }
  return sortActivations(activations)
}

export function extractModuleExtensionFacts(options: ExtractModuleExtensionFactsOptions): ModuleExtensionSurfaceFacts {
  const declared = extractDeclaredHosts(options)
  const hosts = sortHosts([...declared.hosts, ...extractFactRefHosts(options)])
  const contributions = sortContributions([
    ...extractInjectionTable(options),
    ...extractEnrichers(options),
    ...extractApiInterceptors(options),
    ...extractCommandInterceptors(options),
    ...extractGuards(options),
    ...extractEntityExtensions(options),
    ...extractSubscribers(options),
    ...extractBrowserReactions(options),
    ...extractNotificationReactions(options),
    ...extractComponentOverrides(options),
    ...extractSpecializedRegistries(options),
  ])
  return {
    hosts,
    contributions,
    unresolved: declared.unresolved,
    activations: extractCallSiteActivations(options),
  }
}

function patternMatches(pattern: string, targetId: string): boolean {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\{[^}]+\\\}/g, '[^:]+')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(targetId)
}

function targetModuleId(targetId: string): string | null {
  const withoutPrefix = targetId.replace(/^(?:data-table|crud-form|detail|portal-page):/, '')
  const match = /^([a-z][a-z0-9_]*)[.:]/.exec(withoutPrefix)
  return match?.[1] ?? null
}

export function correlateExtensionTarget(
  targetFact: ModuleExtensionTargetFact,
  options: CorrelateExtensionFactsOptions,
): ModuleExtensionTargetFact {
  if (targetFact.resolution !== 'unresolved') return targetFact
  const allHosts = Object.values(options.surfacesByModule).flatMap((surface) => surface.hosts)
  if (targetFact.id.includes('*') || targetFact.id.includes('{')) {
    const knownIds = [
      ...allHosts.filter((host) => host.bound).map((host) => host.id),
      ...options.entityIds,
      ...options.eventIds,
      ...options.apiRoutes,
      ...(options.commandIds ?? []),
    ]
    if (targetFact.id === '*' || knownIds.some((knownId) => patternMatches(targetFact.id, knownId))) {
      return { id: targetFact.id, resolution: 'pattern' }
    }
  }
  const exact = allHosts.find((host) => host.bound && (
    host.id === targetFact.id
    || host.aliases?.includes(targetFact.id)
    || (host.family === 'api-route' && host.id.endsWith(`/${targetFact.id}`))
  ))
  if (exact) {
    return exact.source.kind === 'fact-ref'
      ? factTarget(targetFact.id, exact.source.factSection, exact.source.factKey)
      : { id: targetFact.id, resolution: 'exact' }
  }
  const patterned = allHosts.find((host) => host.bound && host.resolution === 'pattern' && patternMatches(host.id, targetFact.id))
  if (patterned) return { id: targetFact.id, resolution: 'pattern' }
  const framework = allFrameworkHosts().find((host) => patternMatches(host.id, targetFact.id))
    ?? (FRAMEWORK_PREFIXES.some((prefix) => targetFact.id.startsWith(prefix)) ? FRAMEWORK_HOSTS[0] : undefined)
  if (framework) return { id: targetFact.id, resolution: 'framework' }
  if (options.entityIds.has(targetFact.id)) {
    return { id: targetFact.id, resolution: 'fact-ref', factRef: { factSection: 'entities', factKey: targetFact.id } }
  }
  if (options.eventIds.has(targetFact.id)) {
    return { id: targetFact.id, resolution: 'fact-ref', factRef: { factSection: 'events', factKey: targetFact.id } }
  }
  if (options.commandIds?.has(targetFact.id)) {
    return factTarget(targetFact.id, 'ownedContracts.command')
  }
  const route = [...options.apiRoutes].find((apiRoute) => apiRoute === targetFact.id || apiRoute.endsWith(`/${targetFact.id}`))
  if (route) return { id: targetFact.id, resolution: 'fact-ref', factRef: { factSection: 'apiRoutes', factKey: route } }
  const ownerModule = targetModuleId(targetFact.id)
  if (ownerModule && !options.surfacesByModule[ownerModule]) {
    return { id: targetFact.id, resolution: 'optional-external', optionalOwnerPackage: `module:${ownerModule}` }
  }
  if (ownerModule && options.contributingModuleId && ownerModule !== options.contributingModuleId) {
    return { id: targetFact.id, resolution: 'optional-external', optionalOwnerPackage: `module:${ownerModule}` }
  }
  return targetFact
}

export function correlateModuleExtensionFacts(options: CorrelateExtensionFactsOptions): Record<string, ModuleExtensionSurfaceFacts> {
  const result: Record<string, ModuleExtensionSurfaceFacts> = {}
  for (const moduleId of Object.keys(options.surfacesByModule).sort((left, right) => left.localeCompare(right))) {
    const surface = options.surfacesByModule[moduleId]
    const unresolved: ModuleExtensionUnresolvedFact[] = [...surface.unresolved]
    const contributions = surface.contributions.map((contribution) => {
      const targets = contribution.targets.map((entry) => correlateExtensionTarget(entry, {
        ...options,
        contributingModuleId: moduleId,
      }))
      for (const entry of targets) {
        if (entry.resolution !== 'unresolved') continue
        unresolved.push({
          key: `${contribution.id}:${entry.id}`,
          source: contribution.source,
          reason: 'unresolved-first-party-target',
        })
      }
      return { ...contribution, targets }
    })
    result[moduleId] = {
      hosts: sortHosts([...surface.hosts]),
      contributions: sortContributions(contributions),
      unresolved: unresolved.sort((left, right) => left.key.localeCompare(right.key)),
      activations: sortActivations([...(surface.activations ?? [])]),
    }
  }
  return result
}

type IncomingTargetOwner = {
  moduleId: string
  source: ModuleFactSourceRef
  /** Interceptor bridges the owning api route wires (api-route owners only). */
  bridges?: ApiRouteInterceptorBridge[]
}

export interface CorrelateIncomingExtensionsOptions {
  surfacesByModule: Readonly<Record<string, ModuleExtensionSurfaceFacts>>
  /** Concrete runtime-id owner maps derived from the fully-selected module set. */
  apiRouteOwners?: ReadonlyMap<string, IncomingTargetOwner>
  commandOwners?: ReadonlyMap<string, IncomingTargetOwner>
}

function normalizeRouteId(routeId: string): string {
  return routeId.replace(/^\//, '')
}

/**
 * Owner marker for a contribution bound to a framework host (dashboard, menus,
 * notifications, …). Framework hosts have no module surface of their own, so the
 * activation is recorded on the contributor and never produces an incoming row.
 */
const FRAMEWORK_HOST_OWNER = 'framework'

/**
 * Framework host families each host-reference adapter may bind, so a dashboard
 * contribution resolves through `dashboard-host-consumer` rather than being claimed
 * by the generic widget-injection adapter that runs first.
 */
const FRAMEWORK_HOST_FAMILIES_BY_ACTIVATION: Partial<Record<ModuleExtensionActivationKind, ExtensionHostFamily[]>> = {
  'dashboard-host-consumer': ['dashboard'],
  'widget-injection-consumer': ['menu', 'generic', 'crud-form', 'data-table', 'notification', 'integration'],
  'component-extension-consumer': ['component-handle'],
}

/**
 * Resolves a target id against the framework host catalog — exact ids first, then
 * the patterned entries (`dashboard:*`, `crud-form:*`, `integrations.detail:{id}`),
 * so a concrete `dashboard:<widget>` contribution reaches `framework.dashboard`.
 */
function findFrameworkHost(
  targetId: string,
  activationKind: ModuleExtensionActivationKind,
): ModuleExtensionHostFact | null {
  const families = FRAMEWORK_HOST_FAMILIES_BY_ACTIVATION[activationKind]
  if (!families) return null
  const candidates = FRAMEWORK_HOSTS.filter((host) => families.includes(host.family))
  const exact = candidates.find((host) => host.id === targetId)
  if (exact) return exact
  return candidates.find((host) => host.resolution === 'pattern' && patternMatches(host.id, targetId)) ?? null
}

/**
 * A call site that guards only some operations does not activate a contribution
 * declaring none of them. Either side leaving operations undeclared means "any".
 */
function operationsIntersect(
  activationOperations: readonly string[] | undefined,
  contributionOperations: readonly string[] | undefined,
): boolean {
  if (!activationOperations || activationOperations.length === 0) return true
  if (!contributionOperations || contributionOperations.length === 0) return true
  return contributionOperations.some((operation) => activationOperations.includes(operation))
}

function contributionSourceRef(contribution: ModuleExtensionContributionFact): ModuleFactSourceRef {
  return {
    sourcePath: contribution.source.path,
    ...(contribution.source.symbol ? { exportName: contribution.source.symbol } : {}),
  }
}

function targetRefKindFor(
  contribution: ModuleExtensionContributionFact,
  targetId: string,
): ModuleExtensionTargetRef['kind'] {
  if (targetId === '*' || targetId.includes('*') || targetId.includes('{')) return 'wildcard'
  switch (contribution.kind) {
    case 'response-enricher':
    case 'mutation-guard':
    case 'entity-extension':
      return 'entity'
    case 'api-interceptor':
      return 'api-route'
    case 'command-interceptor':
      return 'command'
    case 'component-override':
      return 'component'
    case 'subscriber':
      return 'event'
    case 'browser-reaction':
      return contribution.details.transports.includes('notification-effect') ? 'notification' : 'event'
    case 'widget':
    case 'data-table':
    case 'crud-form':
      return 'widget-spot'
    case 'specialized-registry':
    case 'module-override':
      return 'module'
    default:
      return 'module'
  }
}

/**
 * Builds the bidirectional incoming/resolution index after every module fact is
 * extracted and target-correlated. For each contribution target it records one
 * contributor-owned `ModuleContributionResolution` and, when a concrete target
 * owner exists, one target-owned `ModuleIncomingExtensionRef` per matching
 * activation. It never duplicates contribution behavior metadata — incoming rows
 * point back to the source-owned contribution by `contributorModuleId + contributionId`.
 */
export function correlateIncomingExtensions(
  options: CorrelateIncomingExtensionsOptions,
): Record<string, ModuleExtensionSurfaceFacts> {
  const moduleIds = Object.keys(options.surfacesByModule).sort((left, right) => left.localeCompare(right))
  const apiRouteOwners = options.apiRouteOwners ?? new Map<string, IncomingTargetOwner>()
  const commandOwners = options.commandOwners ?? new Map<string, IncomingTargetOwner>()

  // Index call-site activations by (kind, normalized host id).
  const activationIndex = new Map<string, Array<{ moduleId: string; activation: ModuleExtensionActivation }>>()
  const activationKey = (kind: ModuleExtensionActivationKind, hostKind: ModuleExtensionTargetRef['kind'], id: string): string => {
    const normId = hostKind === 'api-route' ? normalizeRouteId(id) : id
    return JSON.stringify([kind, hostKind, normId])
  }
  // Index bound hosts by their runtime id for host-reference resolution.
  const boundHostIndex = new Map<string, { moduleId: string; host: ModuleExtensionHostFact }>()

  for (const moduleId of moduleIds) {
    const surface = options.surfacesByModule[moduleId]
    for (const activation of surface.activations ?? []) {
      const key = activationKey(activation.kind, activation.host.kind, activation.host.id)
      const bucket = activationIndex.get(key)
      if (bucket) bucket.push({ moduleId, activation })
      else activationIndex.set(key, [{ moduleId, activation }])
    }
    for (const host of surface.hosts) {
      if (!host.bound) continue
      if (!boundHostIndex.has(host.id)) boundHostIndex.set(host.id, { moduleId, host })
    }
  }

  const incomingByModule: Record<string, ModuleIncomingExtensionRef[]> = {}
  const resolutionsByModule: Record<string, ModuleContributionResolution[]> = {}
  const syntheticActivations: Record<string, ModuleExtensionActivation[]> = {}
  for (const moduleId of moduleIds) {
    incomingByModule[moduleId] = []
    resolutionsByModule[moduleId] = []
    syntheticActivations[moduleId] = []
  }
  const registerSyntheticActivation = (ownerModule: string, activation: ModuleExtensionActivation): void => {
    if (!syntheticActivations[ownerModule]) syntheticActivations[ownerModule] = []
    if (!syntheticActivations[ownerModule].some((entry) => entry.id === activation.id)) {
      syntheticActivations[ownerModule].push(activation)
    }
  }

  const findCallSiteActivations = (
    contributionKind: ModuleExtensionContributionKind,
    activationKinds: ModuleExtensionActivationKind[],
    targetRef: ModuleExtensionTargetRef,
    contributionOperations: readonly string[] | undefined,
  ): Array<{ moduleId: string; activation: ModuleExtensionActivation }> => {
    const matches: Array<{ moduleId: string; activation: ModuleExtensionActivation }> = []
    for (const kind of activationKinds) {
      if (ACTIVATION_ADAPTERS[kind].mode !== 'call-site-object') continue
      const bucket = activationIndex.get(activationKey(kind, targetRef.kind, targetRef.id)) ?? []
      for (const entry of bucket) {
        if (!entry.activation.contributionKinds.includes(contributionKind)) continue
        if (!operationsIntersect(entry.activation.operations, contributionOperations)) continue
        matches.push(entry)
      }
    }
    return matches.sort((left, right) => left.activation.id.localeCompare(right.activation.id))
  }

  for (const contributorModuleId of moduleIds) {
    const surface = options.surfacesByModule[contributorModuleId]
    for (const contribution of surface.contributions) {
      const classification = CONTRIBUTION_ACTIVATION_CLASSIFICATION[contribution.kind]
      for (const resolvedTarget of contribution.targets) {
        const targetKind = targetRefKindFor(contribution, resolvedTarget.id)
        const baseTarget: ModuleExtensionTargetRef = { kind: targetKind, id: resolvedTarget.id }

        let resolution: ModuleExtensionResolution
        let ownerModule: string | null = null
        let boundActivationIds: string[] = []

        if (targetKind === 'wildcard' || resolvedTarget.resolution === 'pattern') {
          resolution = 'wildcard'
        } else if (resolvedTarget.resolution === 'optional-external') {
          resolution = 'optional-target-missing'
        } else if (resolvedTarget.resolution === 'unresolved') {
          resolution = 'unresolved'
        } else {
          const activationKinds = classification === 'capability-only' ? [] : classification
          const callSiteMatches = findCallSiteActivations(
            contribution.kind,
            activationKinds,
            baseTarget,
            contribution.operations,
          )
          if (callSiteMatches.length > 0) {
            resolution = 'bound'
            ownerModule = callSiteMatches[0].moduleId
            boundActivationIds = callSiteMatches.map((entry) => entry.activation.id)
          } else {
            const referenceBinding = resolveReferenceBinding({
              contribution,
              activationKinds,
              targetRef: baseTarget,
              boundHostIndex,
              apiRouteOwners,
              commandOwners,
            })
            if (referenceBinding) {
              resolution = 'bound'
              // A framework host owns no module surface: record the activation on the
              // contributor and leave `ownerModule` unset so no incoming row is emitted.
              const isFrameworkHost = referenceBinding.ownerModule === FRAMEWORK_HOST_OWNER
              ownerModule = isFrameworkHost ? null : referenceBinding.ownerModule
              const activationOwner = isFrameworkHost ? contributorModuleId : referenceBinding.ownerModule
              for (const activation of referenceBinding.activations) {
                registerSyntheticActivation(activationOwner, activation)
              }
              boundActivationIds = referenceBinding.activations.map((activation) => activation.id)
            } else {
              const hostOwner = boundHostIndex.get(resolvedTarget.id)
              if (hostOwner) {
                resolution = 'capability-only'
                ownerModule = hostOwner.moduleId
              } else {
                resolution = 'capability-only'
                ownerModule = null
              }
            }
          }
        }

        const resolutionTarget: ModuleExtensionTargetRef = ownerModule
          ? { ...baseTarget, moduleId: ownerModule }
          : baseTarget
        resolutionsByModule[contributorModuleId].push({
          contributionId: contribution.id,
          target: resolutionTarget,
          resolution,
          activationIds: [...boundActivationIds].sort((left, right) => left.localeCompare(right)),
        })

        // Incoming rows document contributions installed by OTHER modules onto a
        // target module's surface (cross-module discovery). Same-module targets are
        // already fully covered by the contributor-owned resolution row above, so
        // emitting a self-incoming row would only duplicate that fact and bloat the
        // generated context.
        if (ownerModule && ownerModule !== contributorModuleId && (resolution === 'bound' || resolution === 'capability-only')) {
          const source = contributionSourceRef(contribution)
          const incomingTarget: ModuleExtensionTargetRef = { ...baseTarget, moduleId: ownerModule }
          if (resolution === 'bound' && boundActivationIds.length > 0) {
            for (const activationRefId of boundActivationIds) {
              incomingByModule[ownerModule].push({
                contributionId: contribution.id,
                contributionKind: contribution.kind,
                contributorModuleId,
                target: incomingTarget,
                activationId: activationRefId,
                resolution: 'bound',
                source,
              })
            }
          } else {
            incomingByModule[ownerModule].push({
              contributionId: contribution.id,
              contributionKind: contribution.kind,
              contributorModuleId,
              target: incomingTarget,
              resolution,
              source,
            })
          }
        }
      }
    }
  }

  const result: Record<string, ModuleExtensionSurfaceFacts> = {}
  for (const moduleId of moduleIds) {
    const surface = options.surfacesByModule[moduleId]
    result[moduleId] = {
      ...surface,
      activations: sortActivations([...(surface.activations ?? []), ...syntheticActivations[moduleId]]),
      incoming: dedupeIncoming(incomingByModule[moduleId]),
      contributionResolutions: sortResolutions(resolutionsByModule[moduleId]),
    }
  }
  return result
}

/**
 * Intersects an api-interceptor contribution's declared methods and phases with the
 * bridges its target route actually wires. A route with no bridge, a phase the route
 * never runs, or a method the route does not handle yields no binding, so the
 * contribution stays `capability-only` instead of being reported as active.
 */
function matchApiInterceptorBridges(
  contribution: ModuleExtensionContributionFact,
  owner: IncomingTargetOwner,
): ApiRouteInterceptorBridge[] {
  if (contribution.kind !== 'api-interceptor') return []
  const bridges = owner.bridges ?? []
  const declaredMethods = contribution.details.methods ?? []
  const declaredPhases = contribution.phases ?? []
  const matched: ApiRouteInterceptorBridge[] = []
  for (const bridge of bridges) {
    if (declaredMethods.length > 0 && !declaredMethods.includes(bridge.method)) continue
    const phases = declaredPhases.length > 0
      ? bridge.phases.filter((phase) => declaredPhases.includes(phase))
      : bridge.phases
    if (phases.length === 0) continue
    matched.push({ method: bridge.method, phases })
  }
  return matched
}

function resolveReferenceBinding(input: {
  contribution: ModuleExtensionContributionFact
  activationKinds: ModuleExtensionActivationKind[]
  targetRef: ModuleExtensionTargetRef
  boundHostIndex: ReadonlyMap<string, { moduleId: string; host: ModuleExtensionHostFact }>
  apiRouteOwners: ReadonlyMap<string, IncomingTargetOwner>
  commandOwners: ReadonlyMap<string, IncomingTargetOwner>
}): { ownerModule: string; activations: ModuleExtensionActivation[] } | null {
  for (const kind of input.activationKinds) {
    const adapter = ACTIVATION_ADAPTERS[kind]
    if (adapter.mode === 'call-site-object') continue
    if (!adapter.contributionKinds.includes(input.contribution.kind)) continue

    if (adapter.mode === 'host-reference' && kind === 'api-interceptor-bridge') {
      const routeId = normalizeRouteId(input.targetRef.id)
      const owner = input.apiRouteOwners.get(routeId)
      if (!owner) continue
      const matchedBridges = matchApiInterceptorBridges(input.contribution, owner)
      if (matchedBridges.length === 0) continue
      return {
        ownerModule: owner.moduleId,
        activations: matchedBridges.map((bridge) => {
          const host: ModuleExtensionTargetRef = {
            kind: 'api-route',
            id: routeId,
            moduleId: owner.moduleId,
            method: bridge.method,
          }
          return {
            id: activationId(host, kind),
            kind,
            host,
            contributionKinds: ['api-interceptor'],
            phases: bridge.phases,
            source: owner.source,
            bridge: { factSection: 'apiRoutes', factKey: `/${routeId}` },
          }
        }),
      }
    }

    if (adapter.mode === 'owner-reference' && kind === 'command-interceptor-bridge') {
      const owner = input.commandOwners.get(input.targetRef.id)
      if (!owner) continue
      const host: ModuleExtensionTargetRef = { kind: 'command', id: input.targetRef.id, moduleId: owner.moduleId }
      return {
        ownerModule: owner.moduleId,
        activations: [{
          id: activationId(host, kind),
          kind,
          host,
          contributionKinds: ['command-interceptor'],
          source: owner.source,
          bridge: { factSection: 'ownedContracts.command', factKey: input.targetRef.id },
        }],
      }
    }

    if (adapter.mode === 'host-reference' && (kind === 'widget-injection-consumer' || kind === 'component-extension-consumer' || kind === 'dashboard-host-consumer')) {
      const frameworkHostFact = input.boundHostIndex.has(input.targetRef.id)
        ? null
        : findFrameworkHost(input.targetRef.id, kind)
      const hostEntry = input.boundHostIndex.get(input.targetRef.id)
        ?? (frameworkHostFact ? { moduleId: FRAMEWORK_HOST_OWNER, host: frameworkHostFact } : undefined)
      if (!hostEntry) continue
      const hostSource = hostReferenceSource(hostEntry.host)
      if (!hostSource) continue
      const host: ModuleExtensionTargetRef = { ...input.targetRef, moduleId: hostEntry.moduleId }
      return {
        ownerModule: hostEntry.moduleId,
        activations: [{
          id: activationId(host, kind),
          kind,
          host,
          contributionKinds: adapter.contributionKinds,
          source: hostSource,
          bridge: { factSection: 'hosts', factKey: hostEntry.host.key },
        }],
      }
    }
  }
  return null
}

function hostReferenceSource(host: ModuleExtensionHostFact): ModuleFactSourceRef | null {
  if (host.source.kind === 'declaration' || host.source.kind === 'framework') {
    return { sourcePath: host.source.path, exportName: host.source.symbol }
  }
  return null
}

function incomingIdentity(entry: ModuleIncomingExtensionRef): string {
  const target = JSON.stringify([entry.target.kind, entry.target.id])
  return JSON.stringify([entry.contributorModuleId, entry.contributionId, target, entry.activationId ?? entry.resolution])
}

function dedupeIncoming(entries: ModuleIncomingExtensionRef[]): ModuleIncomingExtensionRef[] {
  const seen = new Set<string>()
  const unique: ModuleIncomingExtensionRef[] = []
  for (const entry of entries) {
    const identity = incomingIdentity(entry)
    if (seen.has(identity)) continue
    seen.add(identity)
    unique.push(entry)
  }
  return unique.sort((left, right) => incomingIdentity(left).localeCompare(incomingIdentity(right)))
}

function resolutionIdentity(entry: ModuleContributionResolution): string {
  return JSON.stringify([entry.contributionId, entry.target.kind, entry.target.id, entry.resolution])
}

function sortResolutions(entries: ModuleContributionResolution[]): ModuleContributionResolution[] {
  const seen = new Set<string>()
  const unique: ModuleContributionResolution[] = []
  for (const entry of entries) {
    const identity = resolutionIdentity(entry)
    if (seen.has(identity)) continue
    seen.add(identity)
    unique.push(entry)
  }
  return unique.sort((left, right) => resolutionIdentity(left).localeCompare(resolutionIdentity(right)))
}

export function assertNoUnresolvedExtensionTargets(
  surfacesByModule: Readonly<Record<string, ModuleExtensionSurfaceFacts>>,
): void {
  const unresolved = Object.entries(surfacesByModule).flatMap(([moduleId, surface]) =>
    surface.unresolved
      .filter((entry) => entry.reason === 'unresolved-first-party-target')
      .map((entry) => `${moduleId}:${entry.key}`),
  ).sort((left, right) => left.localeCompare(right))
  if (unresolved.length > 0) {
    throw new Error(`[module-facts] unresolved first-party extension targets: ${unresolved.join(', ')}`)
  }
}

/**
 * Supported merge/replace/disable modes for each dotted unified-override host,
 * derived from {@link FRAMEWORK_OVERRIDE_HOSTS} (the framework catalog authority
 * — spec 2026-08-02-module-facts-exact-override-targets). Keyed by the dotted
 * host id (e.g. `routes.api`, `ai.extensions`, `nav.groupOrder`) so the module
 * override-target adapters share one mode source of truth with the catalog.
 */
export function getFrameworkOverrideModes(
  hosts: readonly ModuleExtensionHostFact[] = FRAMEWORK_OVERRIDE_HOSTS,
): Record<string, 'disable-replace' | 'replace' | 'additive'> {
  const modes: Record<string, 'disable-replace' | 'replace' | 'additive'> = {}
  for (const [dotted, operation] of Object.entries(getFrameworkOverrideHostOperations(hosts))) {
    if (operation === 'disable-replace' || operation === 'replace' || operation === 'additive') {
      modes[dotted] = operation
    }
  }
  return modes
}

/**
 * The catalog's declared first operation for every dotted unified-override host,
 * **without** validating it against the known mode set.
 *
 * {@link getFrameworkOverrideModes} silently drops a host whose operation is not a
 * recognized mode, which makes "the catalog does not describe this host at all"
 * indistinguishable from "the catalog describes it with a mode this generator does
 * not understand". Consumers that must tell those apart (the override-target
 * adapters, which emit different diagnostics for each) read the raw operations
 * here instead — spec `2026-07-31-standalone-canonical-example-module.md`,
 * § PR #4883 Module-Fact and Extension-Topology Contract.
 *
 * `hosts` defaults to the framework catalog. Every catalog host declares a valid
 * mode today, so the pass-through is unobservable against the real catalog; passing
 * an explicit host list is how `module-override-targets.unknown-mode.test.ts` proves
 * that an operation this generator does not recognize really does survive here.
 */
export function getFrameworkOverrideHostOperations(
  hosts: readonly ModuleExtensionHostFact[] = FRAMEWORK_OVERRIDE_HOSTS,
): Record<string, string> {
  const operations: Record<string, string> = {}
  for (const host of hosts) {
    const dotted = host.key.replace(/^framework\.module-override\./, '')
    const operation = host.operations?.[0]
    if (typeof operation === 'string') operations[dotted] = operation
  }
  return operations
}

export function getFrameworkExtensionHosts(): ModuleExtensionHostFact[] {
  return sortHosts(allFrameworkHosts().map((host) => ({
    ...host,
    capabilities: [...host.capabilities],
    ...(host.operations ? { operations: [...host.operations] } : {}),
  })))
}

export function renderFrameworkExtensionPointsMarkdown(): string {
  const rows = getFrameworkExtensionHosts().map((host) =>
    `| ${host.id} | ${host.family} | ${[...host.capabilities, ...(host.operations ?? [])].join(', ')} | ${host.stability.toUpperCase()} |`,
  )
  return [
    '# Framework extension points (generated, do not edit)',
    '',
    '| ID / pattern | Family | Supports | Stability |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}
