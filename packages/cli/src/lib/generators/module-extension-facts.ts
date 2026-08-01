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
  ModuleExtensionContributionFact,
  ModuleExtensionContributionBase,
  ModuleExtensionHostFact,
  ModuleExtensionSurfaceFacts,
  ModuleExtensionTargetFact,
  ModuleExtensionUnresolvedFact,
} from '@open-mercato/shared/modules/widgets/extension-points'

type StaticScalar = string | number | boolean | null
type StaticValue = StaticScalar | StaticValue[] | { [key: string]: StaticValue }
type StaticObject = { [key: string]: StaticValue }

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
  contributingModuleId?: string
}

type StaticContext = {
  initializers: Map<string, ts.Expression>
  sourceFile: ts.SourceFile
  resolving: Set<string>
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
  if (!fs.existsSync(filePath)) return null
  const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(filePath, fs.readFileSync(filePath, 'utf8'), ts.ScriptTarget.ES2020, true, scriptKind)
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
  const initializers = new Map<string, ts.Expression>()
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      initializers.set(node.name.text, node.initializer)
    }
    node.forEachChild(visit)
  }
  file.forEachChild(visit)
  return { initializers, sourceFile: file, resolving: new Set() }
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

function staticObject(expression: ts.ObjectLiteralExpression, context: StaticContext): StaticObject {
  const result: StaticObject = {}
  for (const property of expression.properties) {
    if (ts.isPropertyAssignment(property)) {
      const name = propertyName(property.name)
      if (!name) continue
      const value = staticValue(property.initializer, context)
      if (value !== undefined) result[name] = value
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
  if (ts.isIdentifier(current)) {
    if (context.resolving.has(current.text)) return undefined
    const initializer = context.initializers.get(current.text)
    if (!initializer) return undefined
    context.resolving.add(current.text)
    const value = staticValue(initializer, context)
    context.resolving.delete(current.text)
    return value
  }
  if (ts.isCallExpression(current)) {
    if (ts.isIdentifier(current.expression)) {
      const callable = context.initializers.get(current.expression.text)
      if (callable && (ts.isArrowFunction(callable) || ts.isFunctionExpression(callable))) {
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
        if (ts.isExpression(callable.body)) return staticValue(callable.body, childContext)
        const returnStatement = callable.body.statements.find(ts.isReturnStatement)
        if (returnStatement?.expression) return staticValue(returnStatement.expression, childContext)
      }
    }
    const firstArgument = current.arguments[0]
    if (firstArgument) {
      const value = staticValue(firstArgument, context)
      if (!isStaticObject(value) || !ts.isIdentifier(current.expression)) return value
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
  if (!initializer) return []
  const value = staticValue(initializer, context)
  return Array.isArray(value) ? value.filter(isStaticObject) : []
}

function readRootObject(filePath: string, variableName: string): StaticObject | null {
  const file = sourceFile(filePath)
  if (!file) return null
  const context = buildStaticContext(file)
  const initializer = context.initializers.get(variableName)
  if (!initializer) return null
  const value = staticValue(initializer, context)
  return isStaticObject(value) ? value : null
}

function sortHosts(hosts: ModuleExtensionHostFact[]): ModuleExtensionHostFact[] {
  return hosts.sort((left, right) => left.id.localeCompare(right.id) || left.key.localeCompare(right.key))
}

function sortContributions(contributions: ModuleExtensionContributionFact[]): ModuleExtensionContributionFact[] {
  return contributions.sort((left, right) => left.id.localeCompare(right.id) || left.kind.localeCompare(right.kind))
}

function target(id: string, resolution: ModuleExtensionTargetFact['resolution'] = 'unresolved'): ModuleExtensionTargetFact {
  return { id, resolution }
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
  for (const hostKey of Object.keys(hostsObject).sort()) {
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
    source: { kind: 'fact-ref', factSection: options.factSection, factKey: options.id },
  }
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
        phases: phase === 'querying' ? ['block', 'query-transform'] : ['result-transform', 'scope-reapply'],
        activation: 'caller-opt-in',
        scopeContract: 'tenant-and-organization-reapplied-after-result',
      }))
    }
  }
  return hosts
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

function extractInjectionTable(options: ExtractModuleExtensionFactsOptions): ModuleExtensionContributionFact[] {
  const filePath = conventionPath(options.moduleRoot, 'widgets/injection-table.ts')
  if (!filePath) return []
  const table = readRootObject(filePath, 'injectionTable')
  if (!table) return []
  const sourcePath = portablePath(options.moduleRoot, options.sourceRoot, filePath)
  const facts: ModuleExtensionContributionFact[] = []
  for (const targetId of Object.keys(table).sort()) {
    const entries = table[targetId]
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (!isStaticObject(entry)) continue
      const widgetId = stringValue(entry.widgetId)
      if (!widgetId) continue
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
        features: strings(entry.features),
        placement: numberValue(entry.priority) !== undefined ? { priority: numberValue(entry.priority) } : undefined,
      }
      if (targetId.startsWith('data-table:')) {
        facts.push({
          ...shared,
          kind: 'data-table',
          details: {
            payload: payload === 'field' ? 'render' : payload,
            tableId: targetId.replace(/^data-table:/, '').replace(/:(?:columns|row-actions|bulk-actions|filters|toolbar|header|footer|search-trailing)$/, ''),
            executionGuard: strings(entry.features).length > 0 ? 'both' : 'host',
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
            executionGuard: strings(entry.features).length > 0 ? 'both' : 'host',
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
      const queryEngine = isStaticObject(entry.queryEngine) ? entry.queryEngine : null
      const surfaces = [entry.enrichMany === true ? 'list' : null, entry.enrichOne === true ? 'detail' : null]
        .filter((value): value is 'list' | 'detail' => value !== null)
      const base = contributionBase(id, sourcePath, id)
      return {
        ...base,
        kind: 'response-enricher',
        targets: [target(targetEntity, 'fact-ref')],
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
        targets: [target(targetRoute, 'fact-ref')],
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
        targets: [target(targetCommand, 'fact-ref')],
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
        targets: [target(targetEntity, 'fact-ref')],
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
        targets: [target(baseEntity, 'fact-ref')],
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
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name) || /\.(?:test|spec)\./.test(entry.name)) continue
    const filePath = path.join(directory, entry.name)
    const metadata = readRootObject(filePath, 'metadata')
    if (!metadata) continue
    const event = stringValue(metadata.event)
    if (!event) continue
    const subscriberId = stringValue(metadata.id) ?? `${options.moduleId}:${entry.name.replace(/\.tsx?$/, '')}`
    const persistent = booleanValue(metadata.persistent) ?? false
    const sync = booleanValue(metadata.sync) ?? !persistent
    const contribution = contributionBase(subscriberId, portablePath(options.moduleRoot, options.sourceRoot, filePath), 'metadata')
    facts.push({
      ...contribution,
      kind: 'subscriber',
      targets: [target(event, event.includes('*') ? 'pattern' : 'fact-ref')],
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
      targets: [target(event.id, 'fact-ref')],
      details: {
        transports,
        hooks: transports.flatMap((transport) => transport === 'client' ? ['useAppEvent', 'useOperationProgress'] : ['usePortalAppEvent']),
        audienceScopeContract: 'tenant-organization-user-role-and-customer',
      },
    }]
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
      const mode = entry.wrapper !== undefined ? 'wrapper' : entry.props !== undefined ? 'props' : 'replace'
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
    registry: 'notification' | 'search' | 'ai',
    sourcePath: string,
    specialistRoute: string,
  ): void => {
    const contribution = contributionBase(`${registry}:${id}`, sourcePath, id)
    facts.push({
      ...contribution,
      kind: 'specialized-registry',
      targets: [target(id, 'fact-ref')],
      details: { registry, registryId: id, specialistRoute },
    })
  }
  for (const id of options.notifications ?? []) add(id, 'notification', path.posix.join(options.sourceRoot, 'notifications.ts'), 'notifications')
  for (const id of options.searchEntities) add(id, 'search', path.posix.join(options.sourceRoot, 'search.ts'), 'search')
  for (const tool of options.aiTools ?? []) add(tool.name, 'ai', tool.sourcePath, 'aiTools')
  for (const agent of options.aiAgents ?? []) add(agent.id, 'ai', agent.sourcePath, 'aiAgents')
  return facts
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
    ...extractComponentOverrides(options),
    ...extractSpecializedRegistries(options),
  ])
  return { hosts, contributions, unresolved: declared.unresolved }
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
  const exact = allHosts.find((host) => host.bound && (host.id === targetFact.id || host.aliases?.includes(targetFact.id)))
  if (exact) return { id: targetFact.id, resolution: exact.resolution === 'fact-ref' ? 'fact-ref' : 'exact' }
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
  const route = [...options.apiRoutes].find((apiRoute) => apiRoute === targetFact.id || apiRoute.endsWith(`/${targetFact.id}`))
  if (route) return { id: targetFact.id, resolution: 'fact-ref', factRef: { factSection: 'apiRoutes', factKey: route } }
  const ownerModule = targetModuleId(targetFact.id)
  if (ownerModule && options.contributingModuleId && ownerModule !== options.contributingModuleId) {
    return { id: targetFact.id, resolution: 'optional-external', optionalOwnerPackage: `module:${ownerModule}` }
  }
  if (ownerModule && !options.surfacesByModule[ownerModule]) {
    return { id: targetFact.id, resolution: 'optional-external', optionalOwnerPackage: `module:${ownerModule}` }
  }
  return targetFact
}

export function correlateModuleExtensionFacts(options: CorrelateExtensionFactsOptions): Record<string, ModuleExtensionSurfaceFacts> {
  const result: Record<string, ModuleExtensionSurfaceFacts> = {}
  for (const moduleId of Object.keys(options.surfacesByModule).sort()) {
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
    }
  }
  return result
}

export function assertNoUnresolvedExtensionTargets(
  surfacesByModule: Readonly<Record<string, ModuleExtensionSurfaceFacts>>,
): void {
  const unresolved = Object.entries(surfacesByModule).flatMap(([moduleId, surface]) =>
    surface.unresolved
      .filter((entry) => entry.reason === 'unresolved-first-party-target')
      .map((entry) => `${moduleId}:${entry.key}`),
  ).sort()
  if (unresolved.length > 0) {
    throw new Error(`[module-facts] unresolved first-party extension targets: ${unresolved.join(', ')}`)
  }
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
