import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import type { PackageResolver } from '../resolver'
import {
  calculateStructureChecksum,
  toVar,
  moduleHasExport,
  type GeneratorResult,
  createGeneratorResult,
  writeGeneratedFile,
} from '../utils'
import {
  scanModuleDir,
  resolveModuleFile,
  resolveFirstModuleFile,
  SCAN_CONFIGS,
  MODULE_CODE_EXTENSIONS,
  type ModuleRoots,
  type ModuleImports,
  stripModuleCodeExtension,
  isModulePageFile,
  resolveStandaloneSourceMirrorBase,
} from './scanner'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface ModuleRegistryOptions {
  resolver: PackageResolver
  quiet?: boolean
}

type DashboardWidgetEntry = {
  moduleId: string
  key: string
  source: 'app' | 'package'
  importPath: string
}

type RuntimeApiMethodMetadata = {
  requireAuth?: boolean
  requireRoles?: string[]
  requireFeatures?: string[]
  rateLimit?: {
    points: number
    duration: number
    blockDuration?: number
    keyPrefix?: string
  }
}

type PageRouteGenerationResult = {
  eagerRoutes: string[]
  runtimeRoutes: string[]
  manifestRoutes: string[]
}

type ApiRouteGenerationResult = {
  eagerApis: string[]
  runtimeApis: string[]
  manifestApis: string[]
}

type SerializablePageMetadata = {
  requireAuth?: boolean
  requireRoles?: string[]
  requireFeatures?: string[]
  requireCustomerAuth?: boolean
  requireCustomerFeatures?: string[]
  title?: string
  titleKey?: string
  pageTitle?: string
  pageTitleKey?: string
  group?: string
  groupKey?: string
  pageGroup?: string
  pageGroupKey?: string
  order?: number
  pageOrder?: number
  priority?: number
  pagePriority?: number
  navHidden?: boolean
  breadcrumb?: Array<{ label: string; labelKey?: string; href?: string }>
  pageContext?: 'main' | 'admin' | 'settings' | 'profile'
  placement?: {
    section: string
    sectionLabel?: string
    sectionLabelKey?: string
    order?: number
  }
  icon?: string
}

type SerializableSubscriberMetadata = {
  id?: string
  event?: string
  persistent?: boolean
  sync?: boolean
  priority?: number
}

type SerializableWorkerMetadata = {
  id?: string
  queue?: string
  concurrency?: number
}

type PageMetadataManifestLoadResult = {
  manifestExpr: string
  requiresRuntimeImport: boolean
}

function scanDashboardWidgetEntries(options: {
  modId: string
  roots: ModuleRoots
  appImportBase: string
  pkgImportBase: string
}): DashboardWidgetEntry[] {
  const { modId, roots, appImportBase, pkgImportBase } = options
  const files = scanModuleDir(roots, SCAN_CONFIGS.dashboardWidgets)
  return files.map(({ relPath, fromApp }) => {
    const segs = relPath.split('/')
    const file = segs.pop()!
    const base = file.replace(/\.(t|j)sx?$/, '')
    const importPath = sanitizeGeneratedModuleSpecifier(
      `${fromApp ? appImportBase : pkgImportBase}/widgets/dashboard/${[...segs, base].join('/')}`
    )
    const key = [modId, ...segs, base].filter(Boolean).join(':')
    const source = fromApp ? 'app' : 'package'
    return { moduleId: modId, key, source, importPath }
  })
}

async function loadModuleExportsFromSource<T = Record<string, unknown>>(sourceFile: string): Promise<T | null> {
  try {
    return await import(buildCacheBustedSourceImportUrl(sourceFile)) as T
  } catch {
    return null
  }
}

function buildCacheBustedSourceImportUrl(sourceFile: string): string {
  const url = pathToFileURL(sourceFile)
  try {
    const stat = fs.statSync(sourceFile)
    url.searchParams.set('v', `${stat.mtimeMs}-${stat.size}`)
  } catch {}
  return url.href
}

function unwrapObjectLiteralExpression(
  expression: ts.Expression | undefined,
): ts.ObjectLiteralExpression | undefined {
  if (!expression) return undefined
  if (ts.isObjectLiteralExpression(expression)) return expression
  if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) {
    return unwrapObjectLiteralExpression(expression.expression)
  }
  if (ts.isParenthesizedExpression(expression)) {
    return unwrapObjectLiteralExpression(expression.expression)
  }
  return undefined
}

function extractNamedObjectLiteralSource(sourceFile: string, exportName: string): string | null {
  let source = ''
  try {
    source = fs.readFileSync(sourceFile, 'utf8')
  } catch {
    return null
  }

  const parsed = ts.createSourceFile(
    sourceFile,
    source,
    ts.ScriptTarget.Latest,
    true,
    inferScriptKind(sourceFile),
  )

  const exportedNames = new Set<string>()
  for (const statement of parsed.statements) {
    if (
      ts.isExportDeclaration(statement)
      && statement.exportClause
      && ts.isNamedExports(statement.exportClause)
      && !statement.moduleSpecifier
    ) {
      for (const element of statement.exportClause.elements) {
        exportedNames.add(element.name.text)
      }
    }
  }

  for (const statement of parsed.statements) {
    if (!ts.isVariableStatement(statement)) continue

    const statementExportsNameDirectly = (ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== exportName) continue
      if (!statementExportsNameDirectly && !exportedNames.has(exportName)) continue

      const objectLiteral = unwrapObjectLiteralExpression(declaration.initializer)
      if (!objectLiteral) return null
      return source.slice(objectLiteral.getStart(parsed), objectLiteral.end)
    }
  }

  return null
}

function extractNamedObjectLiteralExport(sourceFile: string, exportName: string): Record<string, unknown> | null {
  const literal = extractNamedObjectLiteralSource(sourceFile, exportName)
  if (!literal) return null
  try {
    const extracted = Function(`"use strict"; return (${literal});`)()
    return extracted && typeof extracted === 'object' ? extracted as Record<string, unknown> : null
  } catch {
    return null
  }
}

function inferScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (filePath.endsWith('.js')) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function hasDefaultExport(sourceFile: string): boolean {
  let source = ''
  try {
    source = fs.readFileSync(sourceFile, 'utf8')
  } catch {
    return false
  }

  const parsed = ts.createSourceFile(
    sourceFile,
    source,
    ts.ScriptTarget.Latest,
    true,
    inferScriptKind(sourceFile),
  )

  for (const statement of parsed.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      return true
    }

    if (
      ts.isExportDeclaration(statement)
      && statement.exportClause
      && ts.isNamedExports(statement.exportClause)
      && statement.exportClause.elements.some(
        (element) => element.name.text === 'default' || element.propertyName?.text === 'default',
      )
    ) {
      return true
    }

    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
    if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
      return true
    }
  }

  return false
}

function requiresRuntimePageMetadataFromSourceFile(sourceFile: string): boolean {
  const literal = extractNamedObjectLiteralSource(sourceFile, 'metadata')
  if (!literal) return false

  if (/\b(?:visible|enabled)\s*(?::|[,}])/.test(literal)) {
    return true
  }

  if (!/\bicon\s*(?::|[,}])/.test(literal)) {
    return false
  }

  const iconMatch = /\bicon\s*:\s*([^,\n}]+)/m.exec(literal)
  if (!iconMatch) return true

  return !/^['"`]/.test(iconMatch[1].trim())
}

function toLiteral(value: unknown): string {
  return JSON.stringify(value)
}

const GENERATED_MODULE_SPECIFIER_PREFIXES = ['@/', '@open-mercato/', '../../src/modules/', './'] as const
const GENERATED_MODULE_SPECIFIER_SEGMENT = /^[A-Za-z0-9_.\-[\]()']+$/

function sanitizeGeneratedModuleSpecifierSegment(segment: string, importPath: string): string {
  const match = GENERATED_MODULE_SPECIFIER_SEGMENT.exec(segment)
  if (!match || segment === '.' || segment === '..') {
    throw new Error(`Unsafe generated module specifier: ${importPath}`)
  }
  return match[0]
}

function sanitizeGeneratedModuleSpecifier(importPath: string): string {
  const prefix = GENERATED_MODULE_SPECIFIER_PREFIXES.find((candidate) => importPath.startsWith(candidate))
  if (!prefix) {
    throw new Error(`Unsafe generated module specifier prefix: ${importPath}`)
  }

  const suffix = importPath.slice(prefix.length)
  if (!suffix) {
    throw new Error(`Unsafe generated module specifier: ${importPath}`)
  }

  const segments = suffix
    .split('/')
    .map((segment) => sanitizeGeneratedModuleSpecifierSegment(segment, importPath))

  return `${prefix}${segments.join('/')}`
}

function buildImportStatement(importClause: string, importPath: string): string {
  return `import ${importClause} from ${toLiteral(sanitizeGeneratedModuleSpecifier(importPath))}`
}

function buildBareImportStatement(importPath: string): string {
  return `import ${toLiteral(sanitizeGeneratedModuleSpecifier(importPath))}`
}

function buildDynamicImportExpression(importPath: string): string {
  return `import(${toLiteral(sanitizeGeneratedModuleSpecifier(importPath))})`
}

function findExistingModuleFile(baseDir: string, relativePath: string): string | null {
  const directPath = path.join(baseDir, relativePath)
  if (fs.existsSync(directPath)) return directPath

  const stripped = stripModuleCodeExtension(relativePath)
  for (const extension of MODULE_CODE_EXTENSIONS) {
    const candidate = path.join(baseDir, `${stripped}${extension}`)
    if (fs.existsSync(candidate)) return candidate
  }

  return null
}

function findExistingModuleFileByBaseNames(baseDir: string, relativeBaseNames: string[]): string | null {
  for (const relativeBaseName of relativeBaseNames) {
    const resolved = findExistingModuleFile(baseDir, relativeBaseName)
    if (resolved) return resolved
  }
  return null
}

function toModuleImportSubpath(filePath: string, baseDir: string): string {
  const relativePath = path.relative(baseDir, filePath).replace(/\\/g, '/')
  return stripModuleCodeExtension(relativePath)
}

function normalizeApiMethodMetadata(raw: unknown): RuntimeApiMethodMetadata | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const normalized: RuntimeApiMethodMetadata = {}

  if (typeof source.requireAuth === 'boolean') {
    normalized.requireAuth = source.requireAuth
  }
  if (Array.isArray(source.requireRoles)) {
    normalized.requireRoles = source.requireRoles.filter((role): role is string => typeof role === 'string' && role.length > 0)
  }
  if (Array.isArray(source.requireFeatures)) {
    normalized.requireFeatures = source.requireFeatures.filter((feature): feature is string => typeof feature === 'string' && feature.length > 0)
  }
  if (source.rateLimit && typeof source.rateLimit === 'object') {
    const rateLimit = source.rateLimit as Record<string, unknown>
    if (typeof rateLimit.points === 'number' && typeof rateLimit.duration === 'number') {
      normalized.rateLimit = {
        points: rateLimit.points,
        duration: rateLimit.duration,
        blockDuration: typeof rateLimit.blockDuration === 'number' ? rateLimit.blockDuration : undefined,
        keyPrefix: typeof rateLimit.keyPrefix === 'string' ? rateLimit.keyPrefix : undefined,
      }
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : null
}

function buildApiMetadataLiteral(metadata: unknown, method?: HttpMethod): string {
  if (!metadata || typeof metadata !== 'object') return 'undefined'
  const source = metadata as Record<string, unknown>
  const methods: HttpMethod[] = method ? [method] : ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  const normalized: Partial<Record<HttpMethod, RuntimeApiMethodMetadata>> = {}

  for (const entryMethod of methods) {
    const candidate = method ? source : source[entryMethod]
    const value = normalizeApiMethodMetadata(candidate)
    if (value) {
      normalized[entryMethod] = value
    }
  }

  return Object.keys(normalized).length > 0 ? toLiteral(normalized) : 'undefined'
}

function resolveApiPathFromMetadata(metadata: unknown, fallbackPath: string): string {
  if (!metadata || typeof metadata !== 'object') return fallbackPath
  const candidate = (metadata as Record<string, unknown>).path
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : fallbackPath
}

function detectExportedHttpMethods(sourceFile: string): HttpMethod[] {
  let source = ''
  try {
    source = fs.readFileSync(sourceFile, 'utf8')
  } catch {
    return []
  }

  const knownMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as HttpMethod[]
  const exportedMethods = new Set<HttpMethod>()
  const collectKnownMethods = (rawSpecifiers: string[], opts?: { useExportedAlias?: boolean; useDestructuredProperty?: boolean }) => {
    for (const specifier of rawSpecifiers) {
      const trimmed = specifier.trim()
      if (!trimmed) continue

      let candidate = trimmed
      if (opts?.useExportedAlias) {
        candidate = trimmed.split(/\s+as\s+/i).pop()?.trim() ?? trimmed
      }
      if (opts?.useDestructuredProperty) {
        candidate = trimmed.split(':')[0]?.trim() ?? trimmed
      }

      if (knownMethods.includes(candidate as HttpMethod)) {
        exportedMethods.add(candidate as HttpMethod)
      }
    }
  }

  for (const method of knownMethods) {
    const pattern = new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b|export\\s+(?:const|let|var)\\s+${method}\\b`)
    if (pattern.test(source)) {
      exportedMethods.add(method)
    }
  }

  const reExportPattern = /export\s*{([^}]+)}/g
  for (const match of source.matchAll(reExportPattern)) {
    const exportBlock = match[1] ?? ''
    collectKnownMethods(
      exportBlock
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
      { useExportedAlias: true },
    )
  }

  const destructuredExportPattern = /export\s+(?:const|let|var)\s*{([^}]+)}/g
  for (const match of source.matchAll(destructuredExportPattern)) {
    const exportBlock = match[1] ?? ''
    collectKnownMethods(
      exportBlock
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
      { useDestructuredProperty: true },
    )
  }

  return knownMethods.filter((method) => exportedMethods.has(method))
}

function buildPageRouteProps(metaExpr: string, routePath: string): string {
  return `pattern: ${toLiteral(routePath || '/')}, requireAuth: (${metaExpr})?.requireAuth, requireRoles: (${metaExpr})?.requireRoles, requireFeatures: (${metaExpr})?.requireFeatures, requireCustomerAuth: (${metaExpr})?.requireCustomerAuth, requireCustomerFeatures: (${metaExpr})?.requireCustomerFeatures, title: (${metaExpr})?.pageTitle ?? (${metaExpr})?.title, titleKey: (${metaExpr})?.pageTitleKey ?? (${metaExpr})?.titleKey, group: (${metaExpr})?.pageGroup ?? (${metaExpr})?.group, groupKey: (${metaExpr})?.pageGroupKey ?? (${metaExpr})?.groupKey, icon: (${metaExpr})?.icon, order: (${metaExpr})?.pageOrder ?? (${metaExpr})?.order, priority: (${metaExpr})?.pagePriority ?? (${metaExpr})?.priority, navHidden: (${metaExpr})?.navHidden, visible: (${metaExpr})?.visible, enabled: (${metaExpr})?.enabled, breadcrumb: (${metaExpr})?.breadcrumb, pageContext: (${metaExpr})?.pageContext, placement: (${metaExpr})?.placement`
}

function normalizeBreadcrumb(raw: unknown): SerializablePageMetadata['breadcrumb'] {
  if (!Array.isArray(raw)) return undefined
  const breadcrumb = raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const source = entry as Record<string, unknown>
      if (typeof source.label !== 'string') return null
      return {
        label: source.label,
        labelKey: typeof source.labelKey === 'string' ? source.labelKey : undefined,
        href: typeof source.href === 'string' ? source.href : undefined,
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
  return breadcrumb.length > 0 ? breadcrumb : undefined
}

function normalizePlacement(raw: unknown): SerializablePageMetadata['placement'] {
  if (!raw || typeof raw !== 'object') return undefined
  const source = raw as Record<string, unknown>
  if (typeof source.section !== 'string' || source.section.length === 0) return undefined
  return {
    section: source.section,
    sectionLabel: typeof source.sectionLabel === 'string' ? source.sectionLabel : undefined,
    sectionLabelKey: typeof source.sectionLabelKey === 'string' ? source.sectionLabelKey : undefined,
    order: typeof source.order === 'number' ? source.order : undefined,
  }
}

function normalizePageMetadata(raw: unknown): SerializablePageMetadata | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const normalized: SerializablePageMetadata = {}

  if (typeof source.requireAuth === 'boolean') normalized.requireAuth = source.requireAuth
  if (Array.isArray(source.requireRoles)) normalized.requireRoles = source.requireRoles.filter((role): role is string => typeof role === 'string' && role.length > 0)
  if (Array.isArray(source.requireFeatures)) normalized.requireFeatures = source.requireFeatures.filter((feature): feature is string => typeof feature === 'string' && feature.length > 0)
  if (typeof source.requireCustomerAuth === 'boolean') normalized.requireCustomerAuth = source.requireCustomerAuth
  if (Array.isArray(source.requireCustomerFeatures)) normalized.requireCustomerFeatures = source.requireCustomerFeatures.filter((feature): feature is string => typeof feature === 'string' && feature.length > 0)
  if (typeof source.title === 'string') normalized.title = source.title
  if (typeof source.titleKey === 'string') normalized.titleKey = source.titleKey
  if (typeof source.pageTitle === 'string') normalized.pageTitle = source.pageTitle
  if (typeof source.pageTitleKey === 'string') normalized.pageTitleKey = source.pageTitleKey
  if (typeof source.group === 'string') normalized.group = source.group
  if (typeof source.groupKey === 'string') normalized.groupKey = source.groupKey
  if (typeof source.pageGroup === 'string') normalized.pageGroup = source.pageGroup
  if (typeof source.pageGroupKey === 'string') normalized.pageGroupKey = source.pageGroupKey
  if (typeof source.order === 'number') normalized.order = source.order
  if (typeof source.pageOrder === 'number') normalized.pageOrder = source.pageOrder
  if (typeof source.priority === 'number') normalized.priority = source.priority
  if (typeof source.pagePriority === 'number') normalized.pagePriority = source.pagePriority
  if (typeof source.navHidden === 'boolean') normalized.navHidden = source.navHidden
  if (typeof source.pageContext === 'string' && ['main', 'admin', 'settings', 'profile'].includes(source.pageContext)) {
    normalized.pageContext = source.pageContext as SerializablePageMetadata['pageContext']
  }
  const breadcrumb = normalizeBreadcrumb(source.breadcrumb)
  if (breadcrumb) normalized.breadcrumb = breadcrumb
  const placement = normalizePlacement(source.placement)
  if (placement) normalized.placement = placement
  if (typeof source.icon === 'string') normalized.icon = source.icon

  return Object.keys(normalized).length > 0 ? normalized : null
}

function requiresRuntimePageMetadata(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  const source = raw as Record<string, unknown>
  if (typeof source.visible === 'function' || typeof source.enabled === 'function') {
    return true
  }
  return source.icon != null && typeof source.icon !== 'string'
}

function normalizeSubscriberMetadata(raw: unknown): SerializableSubscriberMetadata | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const normalized: SerializableSubscriberMetadata = {}
  if (typeof source.id === 'string' && source.id.length > 0) normalized.id = source.id
  if (typeof source.event === 'string' && source.event.length > 0) normalized.event = source.event
  if (typeof source.persistent === 'boolean') normalized.persistent = source.persistent
  if (typeof source.sync === 'boolean') normalized.sync = source.sync
  if (typeof source.priority === 'number') normalized.priority = source.priority
  return Object.keys(normalized).length > 0 ? normalized : null
}

function normalizeWorkerMetadata(raw: unknown): SerializableWorkerMetadata | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const normalized: SerializableWorkerMetadata = {}
  if (typeof source.id === 'string' && source.id.length > 0) normalized.id = source.id
  if (typeof source.queue === 'string' && source.queue.length > 0) normalized.queue = source.queue
  if (typeof source.concurrency === 'number') normalized.concurrency = source.concurrency
  return Object.keys(normalized).length > 0 ? normalized : null
}

async function loadSubscriberMetadata(sourceFile: string): Promise<SerializableSubscriberMetadata | null> {
  const sourceModule = await loadModuleExportsFromSource<Record<string, unknown>>(sourceFile)
  return normalizeSubscriberMetadata(sourceModule?.metadata)
    ?? normalizeSubscriberMetadata(extractNamedObjectLiteralExport(sourceFile, 'metadata'))
}

async function loadWorkerMetadata(sourceFile: string): Promise<SerializableWorkerMetadata | null> {
  const sourceModule = await loadModuleExportsFromSource<Record<string, unknown>>(sourceFile)
  return normalizeWorkerMetadata(sourceModule?.metadata)
    ?? normalizeWorkerMetadata(extractNamedObjectLiteralExport(sourceFile, 'metadata'))
}

async function loadPageMetadataForManifest(options: {
  sourceFile: string
  metaPath?: string
  runtimeExpr: string
  allowRuntimeFallback?: boolean
}): Promise<PageMetadataManifestLoadResult> {
  const metadataModule = options.metaPath ?? options.sourceFile
  const sourceModule = await loadModuleExportsFromSource<Record<string, unknown>>(metadataModule)
  const runtimeMetadata = sourceModule?.metadata

  if (
    options.allowRuntimeFallback
    && (requiresRuntimePageMetadata(runtimeMetadata) || requiresRuntimePageMetadataFromSourceFile(metadataModule))
  ) {
    return {
      manifestExpr: options.runtimeExpr,
      requiresRuntimeImport: true,
    }
  }

  const normalized = normalizePageMetadata(runtimeMetadata)
    ?? normalizePageMetadata(extractNamedObjectLiteralExport(metadataModule, 'metadata'))

  return {
    manifestExpr: normalized ? `(${toLiteral(normalized)} as any)` : '(undefined as any)',
    requiresRuntimeImport: false,
  }
}

async function processPageFiles(options: {
  files: Array<{ relPath: string; fromApp: boolean }>
  type: 'frontend' | 'backend'
  modId: string
  appDir: string
  pkgDir: string
  appImportBase: string
  pkgImportBase: string
  eagerImports: string[]
  runtimeImports: string[]
  manifestImports?: string[]
  importIdRef: { value: number }
}): Promise<PageRouteGenerationResult> {
  const { files, type, modId, appDir, pkgDir, appImportBase, pkgImportBase, eagerImports, runtimeImports, manifestImports, importIdRef } = options
  const prefix = type === 'frontend' ? 'C' : 'B'
  const modPrefix = type === 'frontend' ? 'CM' : 'BM'
  const metaPrefix = type === 'frontend' ? 'M' : 'BM'
  const eagerRoutes: string[] = []
  const runtimeRoutes: string[] = []
  const manifestRoutes: string[] = []

  // Next-style page.* files
  for (const { relPath, fromApp } of files.filter(({ relPath: f }) => isModulePageFile(path.basename(f)))) {
    const segs = relPath.split('/')
    const pageFile = segs.pop()!
    const pageBaseName = stripModuleCodeExtension(pageFile)
    const importName = `${prefix}${importIdRef.value++}_${toVar(modId)}_${toVar(segs.join('_') || 'index')}`
    const pageModName = `${modPrefix}${importIdRef.value++}_${toVar(modId)}_${toVar(segs.join('_') || 'index')}`
    const runtimeMetaName = `${metaPrefix}Runtime${importIdRef.value++}_${toVar(modId)}_${toVar(segs.join('_') || 'index')}`
    const sub = segs.length ? `${segs.join('/')}/${pageBaseName}` : pageBaseName
    const importPath = sanitizeGeneratedModuleSpecifier(`${fromApp ? appImportBase : pkgImportBase}/${type}/${sub}`)
    const routePath = type === 'frontend'
      ? '/' + (segs.join('/') || '')
      : '/backend/' + (segs.join('/') || modId)
    const moduleBaseDir = path.join(fromApp ? appDir : pkgDir, ...segs)
    const sourceFile = findExistingModuleFile(moduleBaseDir, pageFile)
    if (!sourceFile || !hasDefaultExport(sourceFile)) continue
    const metaPath = findExistingModuleFileByBaseNames(moduleBaseDir, ['page.meta', 'meta'])
    let metaExpr = 'undefined'
    let runtimeMetaExpr = 'undefined'
    let manifestMetaExpr = 'undefined'
    let manifestImportStatement: string | null = null
    if (metaPath) {
      const metaImportName = `${metaPrefix}${importIdRef.value++}_${toVar(modId)}_${toVar(segs.join('_') || 'index')}`
      const metaImportPath = sanitizeGeneratedModuleSpecifier(
        `${fromApp ? appImportBase : pkgImportBase}/${type}/${toModuleImportSubpath(metaPath, fromApp ? appDir : pkgDir)}`
      )
      const manifestMetaImportName = `${metaPrefix}Manifest${importIdRef.value++}_${toVar(modId)}_${toVar(segs.join('_') || 'index')}`
      eagerImports.push(buildImportStatement(`* as ${metaImportName}`, metaImportPath))
      runtimeImports.push(buildImportStatement(`* as ${runtimeMetaName}`, metaImportPath))
      metaExpr = `(${metaImportName}.metadata as any)`
      runtimeMetaExpr = `(((${runtimeMetaName} as any).metadata) as any)`
      const manifestMetadata = await loadPageMetadataForManifest({
        sourceFile: metaPath,
        metaPath,
        runtimeExpr: `(((${manifestMetaImportName} as any).metadata) as any)`,
        allowRuntimeFallback: type === 'backend',
      })
      manifestMetaExpr = manifestMetadata.manifestExpr
      if (manifestMetadata.requiresRuntimeImport) {
        manifestImportStatement = buildImportStatement(`* as ${manifestMetaImportName}`, metaImportPath)
      }
      eagerImports.push(buildImportStatement(importName, importPath))
    } else {
      metaExpr = `(${pageModName} as any).metadata`
      runtimeMetaExpr = `(((${runtimeMetaName} as any).metadata) as any)`
      const manifestMetaImportName = `${metaPrefix}Manifest${importIdRef.value++}_${toVar(modId)}_${toVar(segs.join('_') || 'index')}`
      const manifestMetadata = await loadPageMetadataForManifest({
        sourceFile,
        runtimeExpr: `(((${manifestMetaImportName} as any).metadata) as any)`,
        allowRuntimeFallback: type === 'backend',
      })
      manifestMetaExpr = manifestMetadata.manifestExpr
      if (manifestMetadata.requiresRuntimeImport) {
        manifestImportStatement = buildImportStatement(`* as ${manifestMetaImportName}`, importPath)
      }
      eagerImports.push(buildImportStatement(`${importName}, * as ${pageModName}`, importPath))
      runtimeImports.push(buildImportStatement(`* as ${runtimeMetaName}`, importPath))
    }
    if (manifestImportStatement) {
      manifestImports?.push(manifestImportStatement)
    }
    const baseProps = buildPageRouteProps(metaExpr, routePath)
    const runtimeBaseProps = buildPageRouteProps(runtimeMetaExpr, routePath)
    const manifestBaseProps = buildPageRouteProps(manifestMetaExpr, routePath)
    eagerRoutes.push(`{ ${baseProps}, Component: ${importName} }`)
    runtimeRoutes.push(`{ ${runtimeBaseProps}, Component: async (props: any) => { const mod = await ${buildDynamicImportExpression(importPath)}; const Component = (mod.default ?? mod) as any; return createElement(Component, props) } }`)
    manifestRoutes.push(`{ moduleId: ${toLiteral(modId)}, ${manifestBaseProps}, load: async () => { const mod = await ${buildDynamicImportExpression(importPath)}; return (mod.default ?? mod) as any } }`)
  }

  // Back-compat direct files (old-style pages like login.tsx instead of login/page.tsx)
  for (const { relPath, fromApp } of files.filter(({ relPath: f }) => !isModulePageFile(path.basename(f)))) {
    const segs = relPath.split('/')
    const file = segs.pop()!
    const name = stripModuleCodeExtension(file)
    const routeSegs = [...segs, name].filter(Boolean)
    const importName = `${prefix}${importIdRef.value++}_${toVar(modId)}_${toVar(routeSegs.join('_') || 'index')}`
    const pageModName = `${modPrefix}${importIdRef.value++}_${toVar(modId)}_${toVar(routeSegs.join('_') || 'index')}`
    const runtimeMetaName = `${metaPrefix}Runtime${importIdRef.value++}_${toVar(modId)}_${toVar(routeSegs.join('_') || 'index')}`
    const importPath = sanitizeGeneratedModuleSpecifier(
      `${fromApp ? appImportBase : pkgImportBase}/${type}/${[...segs, name].join('/')}`
    )
    const routePath = type === 'frontend'
      ? '/' + (routeSegs.join('/') || '')
      : '/backend/' + (segs[0] === modId
          ? [...segs, name].filter(Boolean).join('/')
          : [modId, ...segs, name].filter(Boolean).join('/'))
    const moduleBaseDir = path.join(fromApp ? appDir : pkgDir, ...segs)
    const sourceFile = findExistingModuleFile(moduleBaseDir, file)
    if (!sourceFile || !hasDefaultExport(sourceFile)) continue
    const metaPath = findExistingModuleFileByBaseNames(moduleBaseDir, [`${name}.meta`, 'meta'])
    let metaExpr = 'undefined'
    let runtimeMetaExpr = 'undefined'
    let manifestMetaExpr = 'undefined'
    let manifestImportStatement: string | null = null
    if (metaPath) {
      const metaImportName = `${metaPrefix}${importIdRef.value++}_${toVar(modId)}_${toVar(routeSegs.join('_') || 'index')}`
      const metaBase = path.basename(metaPath)
      const metaImportSub = stripModuleCodeExtension(metaBase) === 'meta' ? 'meta' : `${name}.meta`
      const metaImportPath = sanitizeGeneratedModuleSpecifier(
        `${fromApp ? appImportBase : pkgImportBase}/${type}/${[...segs, metaImportSub].join('/')}`
      )
      const manifestMetaImportName = `${metaPrefix}Manifest${importIdRef.value++}_${toVar(modId)}_${toVar(routeSegs.join('_') || 'index')}`
      eagerImports.push(buildImportStatement(`* as ${metaImportName}`, metaImportPath))
      runtimeImports.push(buildImportStatement(`* as ${runtimeMetaName}`, metaImportPath))
      metaExpr = type === 'frontend' ? `(${metaImportName}.metadata as any)` : `${metaImportName}.metadata`
      runtimeMetaExpr = `(((${runtimeMetaName} as any).metadata) as any)`
      const manifestMetadata = await loadPageMetadataForManifest({
        sourceFile: metaPath,
        metaPath,
        runtimeExpr: `(((${manifestMetaImportName} as any).metadata) as any)`,
        allowRuntimeFallback: type === 'backend',
      })
      manifestMetaExpr = manifestMetadata.manifestExpr
      if (manifestMetadata.requiresRuntimeImport) {
        manifestImportStatement = buildImportStatement(`* as ${manifestMetaImportName}`, metaImportPath)
      }
      eagerImports.push(buildImportStatement(importName, importPath))
    } else {
      metaExpr = `(${pageModName} as any).metadata`
      runtimeMetaExpr = `(((${runtimeMetaName} as any).metadata) as any)`
      const manifestMetaImportName = `${metaPrefix}Manifest${importIdRef.value++}_${toVar(modId)}_${toVar(routeSegs.join('_') || 'index')}`
      const manifestMetadata = await loadPageMetadataForManifest({
        sourceFile,
        runtimeExpr: `(((${manifestMetaImportName} as any).metadata) as any)`,
        allowRuntimeFallback: type === 'backend',
      })
      manifestMetaExpr = manifestMetadata.manifestExpr
      if (manifestMetadata.requiresRuntimeImport) {
        manifestImportStatement = buildImportStatement(`* as ${manifestMetaImportName}`, importPath)
      }
      eagerImports.push(buildImportStatement(`${importName}, * as ${pageModName}`, importPath))
      runtimeImports.push(buildImportStatement(`* as ${runtimeMetaName}`, importPath))
    }
    if (manifestImportStatement) {
      manifestImports?.push(manifestImportStatement)
    }
    const baseProps = buildPageRouteProps(metaExpr, routePath)
    const runtimeBaseProps = buildPageRouteProps(runtimeMetaExpr, routePath)
    const manifestBaseProps = buildPageRouteProps(manifestMetaExpr, routePath)
    eagerRoutes.push(`{ ${baseProps}, Component: ${importName} }`)
    runtimeRoutes.push(`{ ${runtimeBaseProps}, Component: async (props: any) => { const mod = await ${buildDynamicImportExpression(importPath)}; const Component = (mod.default ?? mod) as any; return createElement(Component, props) } }`)
    manifestRoutes.push(`{ moduleId: ${toLiteral(modId)}, ${manifestBaseProps}, load: async () => { const mod = await ${buildDynamicImportExpression(importPath)}; return (mod.default ?? mod) as any } }`)
  }

  return {
    eagerRoutes,
    runtimeRoutes,
    manifestRoutes,
  }
}

async function processApiRoutes(options: {
  roots: ModuleRoots
  modId: string
  appImportBase: string
  pkgImportBase: string
  eagerImports: string[]
  importIdRef: { value: number }
}): Promise<ApiRouteGenerationResult> {
  const { roots, modId, appImportBase, pkgImportBase, eagerImports, importIdRef } = options
  const apiApp = path.join(roots.appBase, 'api')
  const apiPkg = path.join(roots.pkgBase, 'api')
  if (!fs.existsSync(apiApp) && !fs.existsSync(apiPkg)) {
    return { eagerApis: [], runtimeApis: [], manifestApis: [] }
  }

  const eagerApis: string[] = []
  const runtimeApis: string[] = []
  const manifestApis: string[] = []

  // route.* aggregations
  const routeFiles = scanModuleDir(roots, SCAN_CONFIGS.apiRoutes)
  for (const { relPath, fromApp } of routeFiles) {
    const segs = relPath.split('/')
    const routeFile = segs.pop()!
    const reqSegs = [modId, ...segs]
    const importName = `R${importIdRef.value++}_${toVar(modId)}_${toVar(segs.join('_') || 'index')}`
    const sourceDir = fromApp ? apiApp : apiPkg
    const sourceFile = findExistingModuleFile(path.join(sourceDir, ...segs), routeFile)
    if (!sourceFile) continue
    const apiSegPath = segs.join('/')
    const importPath = sanitizeGeneratedModuleSpecifier(
      `${fromApp ? appImportBase : pkgImportBase}/api${apiSegPath ? `/${apiSegPath}` : ''}/${stripModuleCodeExtension(routeFile)}`
    )
    const routePath = '/' + reqSegs.filter(Boolean).join('/')
    const sourceModule = await loadModuleExportsFromSource<Record<string, unknown>>(sourceFile)
    const metadata = sourceModule?.metadata ?? extractNamedObjectLiteralExport(sourceFile, 'metadata')
    const resolvedPath = resolveApiPathFromMetadata(metadata, routePath)
    const exportedMethods = detectExportedHttpMethods(sourceFile)
    if (exportedMethods.length === 0) continue
    const metadataLiteral = buildApiMetadataLiteral(metadata)
    const hasOpenApi = await moduleHasExport(sourceFile, 'openApi')
    const docsPart = hasOpenApi ? `, docs: ((${importName} as any).openApi as any)` : ''
    eagerImports.push(buildImportStatement(`* as ${importName}`, importPath))
    eagerApis.push(`{ path: ((${importName} as any).metadata?.path ?? ${toLiteral(routePath)}), metadata: (${importName} as any).metadata, handlers: ${importName} as any${docsPart} }`)
    runtimeApis.push(`{ path: ${toLiteral(resolvedPath)}, metadata: ${metadataLiteral}, handlers: { ${exportedMethods.map((method) => `${method}: async (req: Request, ctx?: any) => { const mod = await ${buildDynamicImportExpression(importPath)}; return (mod as any).${method}(req, ctx) }`).join(', ')} } }`)
    manifestApis.push(`{ moduleId: ${toLiteral(modId)}, kind: ${toLiteral('route-file')}, path: ${toLiteral(resolvedPath)}, methods: [${exportedMethods.map((method) => toLiteral(method)).join(', ')}], load: async () => ${buildDynamicImportExpression(importPath)} }`)
  }

  // Single files (plain scripts, not route.*, not tests, skip method dirs)
  const plainFiles = scanModuleDir(roots, SCAN_CONFIGS.apiPlainFiles)
  for (const { relPath, fromApp } of plainFiles) {
    const segs = relPath.split('/')
    const file = segs.pop()!
    const pathWithoutExt = stripModuleCodeExtension(file)
    const fullSegs = [...segs, pathWithoutExt]
    const routePath = '/' + [modId, ...fullSegs].filter(Boolean).join('/')
    const importName = `R${importIdRef.value++}_${toVar(modId)}_${toVar(fullSegs.join('_') || 'index')}`
    const plainSegPath = fullSegs.join('/')
    const importPath = sanitizeGeneratedModuleSpecifier(
      `${fromApp ? appImportBase : pkgImportBase}/api${plainSegPath ? `/${plainSegPath}` : ''}`
    )
    const sourceFile = findExistingModuleFile(fromApp ? apiApp : apiPkg, relPath)
    if (!sourceFile) continue
    const sourceModule = await loadModuleExportsFromSource<Record<string, unknown>>(sourceFile)
    const metadata = sourceModule?.metadata ?? extractNamedObjectLiteralExport(sourceFile, 'metadata')
    const resolvedPath = resolveApiPathFromMetadata(metadata, routePath)
    const exportedMethods = detectExportedHttpMethods(sourceFile)
    if (exportedMethods.length === 0) continue
    const metadataLiteral = buildApiMetadataLiteral(metadata)
    const hasOpenApi = await moduleHasExport(sourceFile, 'openApi')
    const docsPart = hasOpenApi ? `, docs: ((${importName} as any).openApi as any)` : ''
    eagerImports.push(buildImportStatement(`* as ${importName}`, importPath))
    eagerApis.push(`{ path: ((${importName} as any).metadata?.path ?? ${toLiteral(routePath)}), metadata: (${importName} as any).metadata, handlers: ${importName} as any${docsPart} }`)
    runtimeApis.push(`{ path: ${toLiteral(resolvedPath)}, metadata: ${metadataLiteral}, handlers: { ${exportedMethods.map((entryMethod) => `${entryMethod}: async (req: Request, ctx?: any) => { const mod = await ${buildDynamicImportExpression(importPath)}; return (mod as any).${entryMethod}(req, ctx) }`).join(', ')} } }`)
    manifestApis.push(`{ moduleId: ${toLiteral(modId)}, kind: ${toLiteral('route-file')}, path: ${toLiteral(resolvedPath)}, methods: [${exportedMethods.map((entryMethod) => toLiteral(entryMethod)).join(', ')}], load: async () => ${buildDynamicImportExpression(importPath)} }`)
  }

  // Legacy per-method
  const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  for (const method of methods) {
    const methodDirSegment = path.posix.join('api', method.toLowerCase())
    const methodRoots: ModuleRoots = {
      appBase: path.join(roots.appBase, 'api', method.toLowerCase()),
      pkgBase: path.join(roots.pkgBase, 'api', method.toLowerCase()),
    }
    const methodConfig = {
      folder: '',
      include: (name: string) => ['.ts', '.js'].some((extension) => name.endsWith(extension)) && !/\.(test|spec)\.[jt]s$/.test(name),
    }
    const apiFiles = scanModuleDir(methodRoots, methodConfig)
    for (const { relPath } of apiFiles) {
      const resolved = resolveModuleFile(
        roots,
        { appBase: appImportBase, pkgBase: pkgImportBase },
        path.posix.join(methodDirSegment, relPath.replace(/\\/g, '/')),
      )
      if (!resolved) continue

      const segs = relPath.split('/')
      const file = segs.pop()!
      const pathWithoutExt = stripModuleCodeExtension(file)
      const fullSegs = [...segs, pathWithoutExt]
      const routePath = '/' + [modId, ...fullSegs].filter(Boolean).join('/')
      const importName = `H${importIdRef.value++}_${toVar(modId)}_${toVar(method)}_${toVar(fullSegs.join('_'))}`
      const importPath = sanitizeGeneratedModuleSpecifier(resolved.importPath)
      const metaName = `RM${importIdRef.value++}_${toVar(modId)}_${toVar(method)}_${toVar(fullSegs.join('_'))}`
      const sourceFile = resolved.absolutePath
      const sourceModule = await loadModuleExportsFromSource<Record<string, unknown>>(sourceFile)
      const metadata = sourceModule?.metadata ?? extractNamedObjectLiteralExport(sourceFile, 'metadata')
      const resolvedPath = resolveApiPathFromMetadata(metadata, routePath)
      const metadataLiteral = buildApiMetadataLiteral(metadata, method)
      const hasOpenApi = await moduleHasExport(sourceFile, 'openApi')
      const docsPart = hasOpenApi ? `, docs: ((${metaName} as any).openApi as any)` : ''
      eagerImports.push(buildImportStatement(`${importName}, * as ${metaName}`, importPath))
      eagerApis.push(`{ method: ${toLiteral(method)}, path: (${metaName}.metadata?.path ?? ${toLiteral(routePath)}), handler: ${importName}, metadata: ${metaName}.metadata${docsPart} }`)
      runtimeApis.push(`{ method: ${toLiteral(method)}, path: ${toLiteral(resolvedPath)}, handler: async (req: Request, ctx?: any) => { const mod = await ${buildDynamicImportExpression(importPath)}; const handler = ((mod as any).default ?? (mod as any).${method} ?? (mod as any).handler) as any; return handler(req, ctx) }, metadata: ${metadataLiteral} }`)
      manifestApis.push(`{ moduleId: ${toLiteral(modId)}, kind: ${toLiteral('legacy')}, method: ${toLiteral(method)}, path: ${toLiteral(resolvedPath)}, methods: [${toLiteral(method)}], load: async () => ${buildDynamicImportExpression(importPath)} }`)
    }
  }

  return {
    eagerApis,
    runtimeApis,
    manifestApis,
  }
}

async function processSubscribers(options: {
  roots: ModuleRoots
  modId: string
  appImportBase: string
  pkgImportBase: string
}): Promise<string[]> {
  const { roots, modId, appImportBase, pkgImportBase } = options
  const files = scanModuleDir(roots, SCAN_CONFIGS.subscribers)
  const subscribers: string[] = []
  for (const { relPath } of files) {
    const resolved = resolveModuleFile(
      roots,
      { appBase: appImportBase, pkgBase: pkgImportBase },
      path.posix.join('subscribers', relPath.replace(/\\/g, '/')),
    )
    if (!resolved) continue
    const segs = relPath.split('/')
    const file = segs.pop()!
    const name = stripModuleCodeExtension(file)
    const importPath = sanitizeGeneratedModuleSpecifier(resolved.importPath)
    const sid = [modId, ...segs, name].filter(Boolean).join(':')
    const sourceFile = resolved.absolutePath
    const metadata = await loadSubscriberMetadata(sourceFile)
    subscribers.push(
      `{ id: ${toLiteral(metadata?.id ?? sid)}, event: ${toLiteral(metadata?.event ?? '')}, persistent: ${metadata?.persistent === undefined ? 'undefined' : toLiteral(metadata.persistent)}, sync: ${metadata?.sync === undefined ? 'undefined' : toLiteral(metadata.sync)}, priority: ${metadata?.priority === undefined ? 'undefined' : toLiteral(metadata.priority)}, handler: createLazyModuleSubscriber(() => ${buildDynamicImportExpression(importPath)}, ${toLiteral(metadata?.id ?? sid)}) }`
    )
  }
  return subscribers
}

async function processWorkers(options: {
  roots: ModuleRoots
  modId: string
  appImportBase: string
  pkgImportBase: string
}): Promise<string[]> {
  const { roots, modId, appImportBase, pkgImportBase } = options
  const files = scanModuleDir(roots, SCAN_CONFIGS.workers)
  const workers: string[] = []
  for (const { relPath } of files) {
    const resolved = resolveModuleFile(
      roots,
      { appBase: appImportBase, pkgBase: pkgImportBase },
      path.posix.join('workers', relPath.replace(/\\/g, '/')),
    )
    if (!resolved) continue
    const segs = relPath.split('/')
    const file = segs.pop()!
    const name = stripModuleCodeExtension(file)
    const importPath = sanitizeGeneratedModuleSpecifier(resolved.importPath)
    const sourceFile = resolved.absolutePath
    const metadata = await loadWorkerMetadata(sourceFile)
    if (!metadata?.queue) continue
    const wid = [modId, 'workers', ...segs, name].filter(Boolean).join(':')
    workers.push(
      `{ id: ${toLiteral(metadata.id ?? wid)}, queue: ${toLiteral(metadata.queue)}, concurrency: ${toLiteral(metadata.concurrency ?? 1)}, handler: createLazyModuleWorker(() => ${buildDynamicImportExpression(importPath)}, ${toLiteral(metadata.id ?? wid)}) }`
    )
  }
  return workers
}

function processTranslations(options: {
  roots: ModuleRoots
  modId: string
  appImportBase: string
  pkgImportBase: string
  imports: string[]
  extraImports?: string[]
}): string[] {
  const { roots, modId, appImportBase, pkgImportBase, imports, extraImports } = options
  const i18nApp = path.join(roots.appBase, 'i18n')
  const pkgI18nBase = resolveStandaloneSourceMirrorBase(roots.pkgBase) ?? roots.pkgBase
  const i18nCore = path.join(pkgI18nBase, 'i18n')
  const locales = new Set<string>()
  if (fs.existsSync(i18nCore))
    for (const e of fs.readdirSync(i18nCore, { withFileTypes: true }))
      if (e.isFile() && e.name.endsWith('.json')) locales.add(e.name.replace(/\.json$/, ''))
  if (fs.existsSync(i18nApp))
    for (const e of fs.readdirSync(i18nApp, { withFileTypes: true }))
      if (e.isFile() && e.name.endsWith('.json')) locales.add(e.name.replace(/\.json$/, ''))
  const translations: string[] = []
  for (const locale of locales) {
    const coreHas = fs.existsSync(path.join(i18nCore, `${locale}.json`))
    const appHas = fs.existsSync(path.join(i18nApp, `${locale}.json`))
    if (coreHas && appHas) {
      const cName = `T_${toVar(modId)}_${toVar(locale)}_C`
      const aName = `T_${toVar(modId)}_${toVar(locale)}_A`
      imports.push(buildImportStatement(cName, `${pkgImportBase}/i18n/${locale}.json`))
      imports.push(buildImportStatement(aName, `${appImportBase}/i18n/${locale}.json`))
      extraImports?.push(buildImportStatement(cName, `${pkgImportBase}/i18n/${locale}.json`))
      extraImports?.push(buildImportStatement(aName, `${appImportBase}/i18n/${locale}.json`))
      translations.push(
        `'${locale}': { ...( ${cName} as unknown as Record<string,string> ), ...( ${aName} as unknown as Record<string,string> ) }`
      )
    } else if (appHas) {
      const aName = `T_${toVar(modId)}_${toVar(locale)}_A`
      imports.push(buildImportStatement(aName, `${appImportBase}/i18n/${locale}.json`))
      extraImports?.push(buildImportStatement(aName, `${appImportBase}/i18n/${locale}.json`))
      translations.push(`'${locale}': ${aName} as unknown as Record<string,string>`)
    } else if (coreHas) {
      const cName = `T_${toVar(modId)}_${toVar(locale)}_C`
      imports.push(buildImportStatement(cName, `${pkgImportBase}/i18n/${locale}.json`))
      extraImports?.push(buildImportStatement(cName, `${pkgImportBase}/i18n/${locale}.json`))
      translations.push(`'${locale}': ${cName} as unknown as Record<string,string>`)
    }
  }
  return translations
}

/**
 * Resolves a convention file and pushes its import + config entry to standalone arrays.
 * Used for files that produce their own generated output (notifications, AI tools, events, analytics, enrichers, etc.).
 *
 * @returns The generated import name, or null if the file was not found.
 */
function processStandaloneConfig(options: {
  roots: ModuleRoots
  imps: ModuleImports
  modId: string
  relativePath: string
  prefix: string
  importIdRef: { value: number }
  standaloneImports: string[]
  standaloneConfigs: string[]
  configExpr: (importName: string, modId: string) => string
  /** Also push the import to the shared imports array (used by modules.generated.ts) */
  sharedImports?: string[]
}): string | null {
  const { roots, imps, modId, relativePath, prefix, importIdRef, standaloneImports, standaloneConfigs, configExpr, sharedImports } = options
  const resolved = resolveModuleFile(roots, imps, relativePath)
  if (!resolved) return null
  const importName = `${prefix}_${toVar(modId)}_${importIdRef.value++}`
  const importPath = sanitizeGeneratedModuleSpecifier(resolved.importPath)
  const importStmt = buildImportStatement(`* as ${importName}`, importPath)
  standaloneImports.push(importStmt)
  if (sharedImports) sharedImports.push(importStmt)
  standaloneConfigs.push(configExpr(importName, modId))
  return importName
}

function resolveConventionFile(
  roots: ModuleRoots,
  imps: ModuleImports,
  relativePath: string,
  prefix: string,
  modId: string,
  importIdRef: { value: number },
  imports: string[],
  extraImports?: string[],
  importStyle: 'namespace' | 'default' = 'namespace'
): { importName: string; importPath: string; fromApp: boolean } | null {
  const resolved = resolveModuleFile(roots, imps, relativePath)
  if (!resolved) return null
  const importName = `${prefix}_${toVar(modId)}_${importIdRef.value++}`
  const importPath = sanitizeGeneratedModuleSpecifier(resolved.importPath)
  if (importStyle === 'default') {
    imports.push(buildImportStatement(importName, importPath))
    extraImports?.push(buildImportStatement(importName, importPath))
  } else {
    imports.push(buildImportStatement(`* as ${importName}`, importPath))
    extraImports?.push(buildImportStatement(`* as ${importName}`, importPath))
  }
  return { importName, importPath, fromApp: resolved.fromApp }
}

export async function generateModuleRegistry(options: ModuleRegistryOptions): Promise<GeneratorResult> {
  const { resolver, quiet = false } = options
  const result = createGeneratorResult()

  const outputDir = resolver.getOutputDir()
  const outFile = path.join(outputDir, 'modules.generated.ts')
  const checksumFile = path.join(outputDir, 'modules.generated.checksum')
  const runtimeOutFile = path.join(outputDir, 'modules.runtime.generated.ts')
  const runtimeChecksumFile = path.join(outputDir, 'modules.runtime.generated.checksum')
  const frontendRoutesOutFile = path.join(outputDir, 'frontend-routes.generated.ts')
  const frontendRoutesChecksumFile = path.join(outputDir, 'frontend-routes.generated.checksum')
  const backendRoutesOutFile = path.join(outputDir, 'backend-routes.generated.ts')
  const backendRoutesChecksumFile = path.join(outputDir, 'backend-routes.generated.checksum')
  const apiRoutesOutFile = path.join(outputDir, 'api-routes.generated.ts')
  const apiRoutesChecksumFile = path.join(outputDir, 'api-routes.generated.checksum')
  const widgetsOutFile = path.join(outputDir, 'dashboard-widgets.generated.ts')
  const widgetsChecksumFile = path.join(outputDir, 'dashboard-widgets.generated.checksum')
  const injectionWidgetsOutFile = path.join(outputDir, 'injection-widgets.generated.ts')
  const injectionWidgetsChecksumFile = path.join(outputDir, 'injection-widgets.generated.checksum')
  const injectionTablesOutFile = path.join(outputDir, 'injection-tables.generated.ts')
  const injectionTablesChecksumFile = path.join(outputDir, 'injection-tables.generated.checksum')
  const searchOutFile = path.join(outputDir, 'search.generated.ts')
  const searchChecksumFile = path.join(outputDir, 'search.generated.checksum')
  const notificationsOutFile = path.join(outputDir, 'notifications.generated.ts')
  const notificationsChecksumFile = path.join(outputDir, 'notifications.generated.checksum')
  const notificationsClientOutFile = path.join(outputDir, 'notifications.client.generated.ts')
  const notificationsClientChecksumFile = path.join(outputDir, 'notifications.client.generated.checksum')
  const paymentsClientOutFile = path.join(outputDir, 'payments.client.generated.ts')
  const paymentsClientChecksumFile = path.join(outputDir, 'payments.client.generated.checksum')
  const notificationHandlersOutFile = path.join(outputDir, 'notification-handlers.generated.ts')
  const notificationHandlersChecksumFile = path.join(outputDir, 'notification-handlers.generated.checksum')
  const messageTypesOutFile = path.join(outputDir, 'message-types.generated.ts')
  const messageTypesChecksumFile = path.join(outputDir, 'message-types.generated.checksum')
  const messageObjectsOutFile = path.join(outputDir, 'message-objects.generated.ts')
  const messageObjectsChecksumFile = path.join(outputDir, 'message-objects.generated.checksum')
  const messagesClientOutFile = path.join(outputDir, 'messages.client.generated.ts')
  const messagesClientChecksumFile = path.join(outputDir, 'messages.client.generated.checksum')
  const aiToolsOutFile = path.join(outputDir, 'ai-tools.generated.ts')
  const aiToolsChecksumFile = path.join(outputDir, 'ai-tools.generated.checksum')
  const eventsOutFile = path.join(outputDir, 'events.generated.ts')
  const eventsChecksumFile = path.join(outputDir, 'events.generated.checksum')
  const analyticsOutFile = path.join(outputDir, 'analytics.generated.ts')
  const analyticsChecksumFile = path.join(outputDir, 'analytics.generated.checksum')
  const bootstrapRegsOutFile = path.join(outputDir, 'bootstrap-registrations.generated.ts')
  const bootstrapRegsChecksumFile = path.join(outputDir, 'bootstrap-registrations.generated.checksum')
  const transFieldsOutFile = path.join(outputDir, 'translations-fields.generated.ts')
  const transFieldsChecksumFile = path.join(outputDir, 'translations-fields.generated.checksum')
  const enrichersOutFile = path.join(outputDir, 'enrichers.generated.ts')
  const enrichersChecksumFile = path.join(outputDir, 'enrichers.generated.checksum')
  const interceptorsOutFile = path.join(outputDir, 'interceptors.generated.ts')
  const interceptorsChecksumFile = path.join(outputDir, 'interceptors.generated.checksum')
  const componentOverridesOutFile = path.join(outputDir, 'component-overrides.generated.ts')
  const componentOverridesChecksumFile = path.join(outputDir, 'component-overrides.generated.checksum')
  const inboxActionsOutFile = path.join(outputDir, 'inbox-actions.generated.ts')
  const inboxActionsChecksumFile = path.join(outputDir, 'inbox-actions.generated.checksum')
  const guardsOutFile = path.join(outputDir, 'guards.generated.ts')
  const guardsChecksumFile = path.join(outputDir, 'guards.generated.checksum')
  const commandInterceptorsOutFile = path.join(outputDir, 'command-interceptors.generated.ts')
  const commandInterceptorsChecksumFile = path.join(outputDir, 'command-interceptors.generated.checksum')
  const frontendMiddlewareOutFile = path.join(outputDir, 'frontend-middleware.generated.ts')
  const frontendMiddlewareChecksumFile = path.join(outputDir, 'frontend-middleware.generated.checksum')
  const backendMiddlewareOutFile = path.join(outputDir, 'backend-middleware.generated.ts')
  const backendMiddlewareChecksumFile = path.join(outputDir, 'backend-middleware.generated.checksum')

  const enabled = resolver.loadEnabledModules()

  // Pre-pass: collect generator plugins from each enabled module's generators.ts
  const pluginRegistry = new Map<string, import('@open-mercato/shared/modules/generators').GeneratorPlugin>()
  const pluginState = new Map<string, { imports: string[]; configs: string[] }>()
  for (const entry of enabled) {
    const roots = resolver.getModulePaths(entry)
    const rawImps = resolver.getModuleImportBase(entry)
    const isAppMod = entry.from === '@app'
    const appImportBase = isAppMod ? `../../src/modules/${entry.id}` : rawImps.appBase
    const imps: ModuleImports = { appBase: appImportBase, pkgBase: rawImps.pkgBase }
    const resolved = resolveModuleFile(roots, imps, 'generators.ts')
    if (!resolved) continue
    try {
      const pluginMod = await import(buildCacheBustedSourceImportUrl(resolved.absolutePath))
      const plugins: import('@open-mercato/shared/modules/generators').GeneratorPlugin[] =
        pluginMod.generatorPlugins ?? pluginMod.default ?? []
      for (const plugin of plugins) {
        if (!pluginRegistry.has(plugin.id)) {
          pluginRegistry.set(plugin.id, plugin)
          pluginState.set(plugin.id, { imports: [], configs: [] })
        }
      }
    } catch {}
  }

  const imports: string[] = []
  const runtimeImports: string[] = []
  const frontendRouteManifestImports: string[] = []
  const backendRouteManifestImports: string[] = []
  const moduleDecls: string[] = []
  const runtimeModuleDecls: string[] = []
  const frontendRouteManifestDecls: string[] = []
  const backendRouteManifestDecls: string[] = []
  const apiRouteManifestDecls: string[] = []
  // Mutable ref so extracted helper functions can increment the shared counter
  const importIdRef = { value: 0 }
  const trackedRoots = new Set<string>()
  const requiresByModule = new Map<string, string[]>()
  const allDashboardWidgets = new Map<string, { moduleId: string; source: 'app' | 'package'; importPath: string }>()
  const allInjectionWidgets = new Map<string, { moduleId: string; source: 'app' | 'package'; importPath: string }>()
  const allInjectionTables: Array<{ moduleId: string; importPath: string; importName: string }> = []
  const searchConfigs: string[] = []
  const searchImports: string[] = []
  const notificationTypes: string[] = []
  const notificationImports: string[] = []
  const notificationClientTypes: string[] = []
  const notificationClientImports: string[] = []
  const paymentsClientImports: string[] = []
  const notificationHandlerEntries: string[] = []
  const notificationHandlerImports: string[] = []
  const messageTypeEntries: string[] = []
  const messageTypeImports: string[] = []
  const messageObjectTypeEntries: string[] = []
  const messageObjectTypeImports: string[] = []
  const aiToolsConfigs: string[] = []
  const aiToolsImports: string[] = []
  const eventsConfigs: string[] = []
  const eventsImports: string[] = []
  const analyticsConfigs: string[] = []
  const analyticsImports: string[] = []
  const transFieldsConfigs: string[] = []
  const transFieldsImports: string[] = []
  const enricherConfigs: string[] = []
  const enricherImports: string[] = []
  const interceptorConfigs: string[] = []
  const interceptorImports: string[] = []
  const componentOverrideConfigs: string[] = []
  const componentOverrideImports: string[] = []
  const inboxActionsConfigs: string[] = []
  const inboxActionsImports: string[] = []
  const guardConfigs: string[] = []
  const guardImports: string[] = []
  const commandInterceptorConfigs: string[] = []
  const commandInterceptorImports: string[] = []
  const frontendMiddlewareConfigs: string[] = []
  const frontendMiddlewareImports: string[] = []
  const backendMiddlewareConfigs: string[] = []
  const backendMiddlewareImports: string[] = []

  // UMES conflict detection: collect file paths during module processing
  const umesConflictSources: Array<{
    moduleId: string
    componentOverridesPath?: string
    interceptorsPath?: string
    aclPath?: string
  }> = []

  for (const entry of enabled) {
    const modId = entry.id
    const roots = resolver.getModulePaths(entry)
    const rawImps = resolver.getModuleImportBase(entry)
    trackedRoots.add(roots.appBase)
    trackedRoots.add(roots.pkgBase)

    const isAppModule = entry.from === '@app'
    const appImportBase = isAppModule ? `../../src/modules/${modId}` : rawImps.appBase
    const imps: ModuleImports = { appBase: appImportBase, pkgBase: rawImps.pkgBase }

    const frontendRoutes: string[] = []
    const backendRoutes: string[] = []
    const apis: string[] = []
    const runtimeFrontendRoutes: string[] = []
    const runtimeBackendRoutes: string[] = []
    const runtimeApis: string[] = []
    let cliImportName: string | null = null
    const translations: string[] = []
    const subscribers: string[] = []
    const workers: string[] = []
    let infoImportName: string | null = null
    let extensionsImportName: string | null = null
    let fieldsImportName: string | null = null
    let featuresImportName: string | null = null
    let customEntitiesImportName: string | null = null
    let searchImportName: string | null = null
    let eventsImportName: string | null = null
    let analyticsImportName: string | null = null
    let customFieldSetsExpr: string = '[]'
    const dashboardWidgets: string[] = []
    const injectionWidgets: string[] = []
    let injectionTableImportName: string | null = null
    let setupImportName: string | null = null
    let integrationImportName: string | null = null

    // === Processing order MUST match original import ID sequence ===

    // 1. Module metadata: index.ts (overrideable)
    const indexResolved = resolveModuleFile(roots, imps, 'index.ts')
    if (indexResolved) {
      infoImportName = `I${importIdRef.value++}_${toVar(modId)}`
      const importPath = sanitizeGeneratedModuleSpecifier(indexResolved.importPath)
      imports.push(buildImportStatement(`* as ${infoImportName}`, importPath))
      runtimeImports.push(buildImportStatement(`* as ${infoImportName}`, importPath))
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(indexResolved.absolutePath)
        const reqs: string[] | undefined =
          mod?.metadata && Array.isArray(mod.metadata.requires) ? mod.metadata.requires : undefined
        if (reqs && reqs.length) requiresByModule.set(modId, reqs)
      } catch {}
    }

    // 2. Pages: frontend
    {
      const feApp = path.join(roots.appBase, 'frontend')
      const fePkg = path.join(roots.pkgBase, 'frontend')
      const feFiles = scanModuleDir(roots, SCAN_CONFIGS.frontendPages)
      if (feFiles.length) {
        const generatedFrontendRoutes = await processPageFiles({
          files: feFiles,
          type: 'frontend',
          modId,
          appDir: feApp,
          pkgDir: fePkg,
          appImportBase,
          pkgImportBase: imps.pkgBase,
          eagerImports: imports,
          runtimeImports,
          manifestImports: frontendRouteManifestImports,
          importIdRef,
        })
        frontendRoutes.push(...generatedFrontendRoutes.eagerRoutes)
        runtimeFrontendRoutes.push(...generatedFrontendRoutes.runtimeRoutes)
        frontendRouteManifestDecls.push(...generatedFrontendRoutes.manifestRoutes)
      }
    }

    // 3. Entity extensions: data/extensions.ts
    {
      const ext = resolveConventionFile(roots, imps, 'data/extensions.ts', 'X', modId, importIdRef, imports, runtimeImports)
      if (ext) extensionsImportName = ext.importName
    }

    // 4. RBAC: acl.ts
    {
      const aclResolved = resolveModuleFile(roots, imps, 'acl.ts')
      if (aclResolved) {
        const importName = `ACL_${toVar(modId)}_${importIdRef.value++}`
        const importPath = sanitizeGeneratedModuleSpecifier(aclResolved.importPath)
        imports.push(buildImportStatement(`* as ${importName}`, importPath))
        runtimeImports.push(buildImportStatement(`* as ${importName}`, importPath))
        featuresImportName = importName
      }
    }

    // 5. Custom entities: ce.ts
    {
      const ce = resolveConventionFile(roots, imps, 'ce.ts', 'CE', modId, importIdRef, imports, runtimeImports)
      if (ce) customEntitiesImportName = ce.importName
    }

    // 6. Search: search.ts
    {
      const resolved = resolveModuleFile(roots, imps, 'search.ts')
      if (resolved) {
        const importName = `SEARCH_${toVar(modId)}_${importIdRef.value++}`
        const importStmt = buildImportStatement(`* as ${importName}`, resolved.importPath)
        imports.push(importStmt)
        searchImports.push(importStmt)
        searchImportName = importName
      }
    }

    // 7. Notifications: notifications.ts
    processStandaloneConfig({
      roots, imps, modId, importIdRef,
      relativePath: 'notifications.ts',
      prefix: 'NOTIF',
      standaloneImports: notificationImports,
      standaloneConfigs: notificationTypes,
      configExpr: (n, id) => `{ moduleId: '${id}', types: ((${n}.default ?? ${n}.notificationTypes ?? (${n} as any).types ?? []) as NotificationTypeDefinition[]) }`,
    })

    // Notification client renderers: notifications.client.ts
    processStandaloneConfig({
      roots, imps, modId, importIdRef,
      relativePath: 'notifications.client.ts',
      prefix: 'NOTIF_CLIENT',
      standaloneImports: notificationClientImports,
      standaloneConfigs: notificationClientTypes,
      configExpr: (n, id) => `{ moduleId: '${id}', types: (${n}.default ?? []) }`,
    })

    {
      const resolved = resolveFirstModuleFile(roots, imps, [
        'widgets/payments/client.tsx',
        'widgets/payments/client.ts',
      ])
      if (resolved) {
        paymentsClientImports.push(buildBareImportStatement(resolved.importPath))
      }
    }

    processStandaloneConfig({
      roots, imps, modId, importIdRef,
      relativePath: 'notifications.handlers.ts',
      prefix: 'NOTIF_HANDLERS',
      standaloneImports: notificationHandlerImports,
      standaloneConfigs: notificationHandlerEntries,
      configExpr: (n, id) => `{ moduleId: '${id}', handlers: ((${n}.default ?? ${n}.notificationHandlers ?? []) as NotificationHandler[]) }`,
    })
    // Message types: module root message-types.ts
    {
      const resolved = resolveModuleFile(roots, imps, 'message-types.ts')
      if (resolved) {
        const importName = `MSG_TYPES_${toVar(modId)}_${importIdRef.value++}`
        const importStmt = buildImportStatement(`* as ${importName}`, resolved.importPath)
        messageTypeImports.push(importStmt)
        messageTypeEntries.push(
          `{ moduleId: '${modId}', types: ((${importName}.default ?? (${importName} as any).messageTypes ?? (${importName} as any).types ?? []) as MessageTypeDefinition[]) }`
        )
      }
    }

    // Message object types: module root message-objects.ts
    {
      const resolved = resolveModuleFile(roots, imps, 'message-objects.ts')
      if (resolved) {
        const importName = `MSG_OBJECTS_${toVar(modId)}_${importIdRef.value++}`
        const importStmt = buildImportStatement(`* as ${importName}`, resolved.importPath)
        messageObjectTypeImports.push(importStmt)
        messageObjectTypeEntries.push(
          `{ moduleId: '${modId}', types: ((${importName}.default ?? (${importName} as any).messageObjectTypes ?? (${importName} as any).objectTypes ?? (${importName} as any).types ?? []) as MessageObjectTypeDefinition[]) }`
        )
      }
    }

    // 8. AI Tools: ai-tools.ts
    processStandaloneConfig({
      roots, imps, modId, importIdRef,
      relativePath: 'ai-tools.ts',
      prefix: 'AI_TOOLS',
      standaloneImports: aiToolsImports,
      standaloneConfigs: aiToolsConfigs,
      configExpr: (n, id) => `{ moduleId: '${id}', tools: (${n}.aiTools ?? ${n}.default ?? []) }`,
    })

    // 9. Events: events.ts (also referenced in module declarations)
    eventsImportName = processStandaloneConfig({
      roots, imps, modId, importIdRef,
      relativePath: 'events.ts',
      prefix: 'EVENTS',
      standaloneImports: eventsImports,
      standaloneConfigs: eventsConfigs,
      sharedImports: imports,
      configExpr: (n, id) => `{ moduleId: '${id}', config: (${n}.default ?? ${n}.eventsConfig ?? null) as EventModuleConfigBase | null }`,
    })

    // 10. Analytics: analytics.ts (also referenced in module declarations)
    analyticsImportName = processStandaloneConfig({
      roots, imps, modId, importIdRef,
      relativePath: 'analytics.ts',
      prefix: 'ANALYTICS',
      standaloneImports: analyticsImports,
      standaloneConfigs: analyticsConfigs,
      sharedImports: imports,
      configExpr: (n, id) => `{ moduleId: '${id}', config: (${n}.default ?? ${n}.analyticsConfig ?? ${n}.config ?? null) }`,
    })

    // 10b. Enrichers: data/enrichers.ts
    processStandaloneConfig({
      roots, imps, modId, importIdRef,
      relativePath: 'data/enrichers.ts',
      prefix: 'ENRICHERS',
      standaloneImports: enricherImports,
      standaloneConfigs: enricherConfigs,
      configExpr: (n, id) => `{ moduleId: '${id}', enrichers: ((${n} as any).enrichers ?? (${n} as any).default ?? []) }`,
    })

    // 10c. API interceptors: api/interceptors.ts
    processStandaloneConfig({
      roots, imps, modId, importIdRef,
      relativePath: 'api/interceptors.ts',
      prefix: 'INTERCEPTORS',
      standaloneImports: interceptorImports,
      standaloneConfigs: interceptorConfigs,
      configExpr: (n, id) => `{ moduleId: '${id}', interceptors: ((${n} as any).interceptors ?? (${n} as any).default ?? []) }`,
    })

    // 10d. Component overrides: widgets/components.ts
    processStandaloneConfig({
      roots, imps, modId, importIdRef,
      relativePath: 'widgets/components.ts',
      prefix: 'COMPONENT_OVERRIDES',
      standaloneImports: componentOverrideImports,
      standaloneConfigs: componentOverrideConfigs,
      configExpr: (n, id) => `{ moduleId: '${id}', componentOverrides: ((${n} as any).componentOverrides ?? (${n} as any).default ?? []) }`,
    })

    // Track file paths for UMES conflict detection
    {
      const compOverridesFile = resolveModuleFile(roots, imps, 'widgets/components.ts')
      const interceptorsFile = resolveModuleFile(roots, imps, 'api/interceptors.ts')
      const aclFile = resolveModuleFile(roots, imps, 'acl.ts')
      umesConflictSources.push({
        moduleId: modId,
        componentOverridesPath: compOverridesFile?.absolutePath,
        interceptorsPath: interceptorsFile?.absolutePath,
        aclPath: aclFile?.absolutePath,
      })
    }

    // Translatable fields: translations.ts (also referenced in module declarations)
    let transFieldsImportName: string | null = null
    transFieldsImportName = processStandaloneConfig({
      roots, imps, modId, importIdRef,
      relativePath: 'translations.ts',
      prefix: 'TRANS_FIELDS',
      standaloneImports: transFieldsImports,
      standaloneConfigs: transFieldsConfigs,
      sharedImports: imports,
      configExpr: (n, id) => `{ moduleId: '${id}', fields: (${n}.default ?? ${n}.translatableFields ?? {}) as Record<string, string[]> }`,
    })

    // Generator plugins: process each registered plugin's convention file
    for (const plugin of pluginRegistry.values()) {
      processStandaloneConfig({
        roots, imps, modId, importIdRef,
        relativePath: plugin.conventionFile,
        prefix: plugin.importPrefix,
        standaloneImports: pluginState.get(plugin.id)!.imports,
        standaloneConfigs: pluginState.get(plugin.id)!.configs,
        configExpr: plugin.configExpr,
      })
    }

    // Inbox Actions: inbox-actions.ts
    {
      const resolved = resolveModuleFile(roots, imps, 'inbox-actions.ts')
      if (resolved) {
        const importName = `INBOX_ACTIONS_${toVar(modId)}_${importIdRef.value++}`
        const importStmt = buildImportStatement(`* as ${importName}`, resolved.importPath)
        inboxActionsImports.push(importStmt)
        inboxActionsConfigs.push(
          `{ moduleId: '${modId}', actions: (${importName}.default ?? ${importName}.inboxActions ?? []) }`
        )
      }
    }

    // 10e. Mutation guards: data/guards.ts
    processStandaloneConfig({
      roots, imps, modId, importIdRef,
      relativePath: 'data/guards.ts',
      prefix: 'GUARDS',
      standaloneImports: guardImports,
      standaloneConfigs: guardConfigs,
      configExpr: (n, id) => `{ moduleId: '${id}', guards: ((${n} as any).guards ?? (${n} as any).default ?? []) }`,
    })

    // 10f. Command interceptors: commands/interceptors.ts
    processStandaloneConfig({
      roots, imps, modId, importIdRef,
      relativePath: 'commands/interceptors.ts',
      prefix: 'CMD_INTERCEPTORS',
      standaloneImports: commandInterceptorImports,
      standaloneConfigs: commandInterceptorConfigs,
      configExpr: (n, id) => `{ moduleId: '${id}', interceptors: ((${n} as any).interceptors ?? (${n} as any).default ?? []) }`,
    })

    // 10g. Frontend page middleware: frontend/middleware.ts
    processStandaloneConfig({
      roots, imps, modId, importIdRef,
      relativePath: 'frontend/middleware.ts',
      prefix: 'FRONTEND_MIDDLEWARE',
      standaloneImports: frontendMiddlewareImports,
      standaloneConfigs: frontendMiddlewareConfigs,
      configExpr: (n, id) => `{ moduleId: '${id}', middleware: ((${n} as any).middleware ?? (${n} as any).default ?? []) }`,
    })

    // 10h. Backend page middleware: backend/middleware.ts
    processStandaloneConfig({
      roots, imps, modId, importIdRef,
      relativePath: 'backend/middleware.ts',
      prefix: 'BACKEND_MIDDLEWARE',
      standaloneImports: backendMiddlewareImports,
      standaloneConfigs: backendMiddlewareConfigs,
      configExpr: (n, id) => `{ moduleId: '${id}', middleware: ((${n} as any).middleware ?? (${n} as any).default ?? []) }`,
    })

    // 11. Setup: setup.ts
    {
      const setup = resolveConventionFile(roots, imps, 'setup.ts', 'SETUP', modId, importIdRef, imports, runtimeImports)
      if (setup) setupImportName = setup.importName
    }

    // 11b. Integration manifest: integration.ts
    {
      const resolved = resolveModuleFile(roots, imps, 'integration.ts')
      if (resolved) {
        const importName = `INTEGRATION_${toVar(modId)}_${importIdRef.value++}`
        imports.push(buildImportStatement(`* as ${importName}`, resolved.importPath))
        runtimeImports.push(buildImportStatement(`* as ${importName}`, resolved.importPath))
        integrationImportName = importName
      }
    }

    // 12. Custom fields: data/fields.ts
    {
      const fields = resolveConventionFile(roots, imps, 'data/fields.ts', 'F', modId, importIdRef, imports, runtimeImports)
      if (fields) fieldsImportName = fields.importName
    }

    // 13. Pages: backend
    {
      const beApp = path.join(roots.appBase, 'backend')
      const bePkg = path.join(roots.pkgBase, 'backend')
      const beFiles = scanModuleDir(roots, SCAN_CONFIGS.backendPages)
      if (beFiles.length) {
        const generatedBackendRoutes = await processPageFiles({
          files: beFiles,
          type: 'backend',
          modId,
          appDir: beApp,
          pkgDir: bePkg,
          appImportBase,
          pkgImportBase: imps.pkgBase,
          eagerImports: imports,
          runtimeImports,
          manifestImports: backendRouteManifestImports,
          importIdRef,
        })
        backendRoutes.push(...generatedBackendRoutes.eagerRoutes)
        runtimeBackendRoutes.push(...generatedBackendRoutes.runtimeRoutes)
        backendRouteManifestDecls.push(...generatedBackendRoutes.manifestRoutes)
      }
    }

    // 14. API routes
    {
      const generatedApis = await processApiRoutes({
      roots,
      modId,
      appImportBase,
      pkgImportBase: imps.pkgBase,
      eagerImports: imports,
      importIdRef,
      })
      apis.push(...generatedApis.eagerApis)
      runtimeApis.push(...generatedApis.runtimeApis)
      apiRouteManifestDecls.push(...generatedApis.manifestApis)
    }

    // 15. CLI
    {
      const cliResolved = resolveModuleFile(roots, imps, 'cli.ts')
      if (cliResolved) {
        const importName = `CLI_${toVar(modId)}`
        imports.push(buildImportStatement(importName, sanitizeGeneratedModuleSpecifier(cliResolved.importPath)))
        cliImportName = importName
      }
    }

    // 16. Translations
    translations.push(...processTranslations({
      roots,
      modId,
      appImportBase,
      pkgImportBase: imps.pkgBase,
      imports,
      extraImports: runtimeImports,
    }))

    // 17. Subscribers
    subscribers.push(...await processSubscribers({
      roots,
      modId,
      appImportBase,
      pkgImportBase: imps.pkgBase,
    }))

    // 18. Workers
    workers.push(...await processWorkers({
      roots,
      modId,
      appImportBase,
      pkgImportBase: imps.pkgBase,
    }))

    // Build combined customFieldSets expression
    {
      const parts: string[] = []
      if (fieldsImportName)
        parts.push(`(( ${fieldsImportName}.default ?? ${fieldsImportName}.fieldSets) as any) || []`)
      if (customEntitiesImportName)
        parts.push(
          `((( ${customEntitiesImportName}.default ?? ${customEntitiesImportName}.entities) as any) || []).filter((e: any) => Array.isArray(e.fields) && e.fields.length).map((e: any) => ({ entity: e.id, fields: e.fields, source: ${toLiteral(modId)} }))`
        )
      customFieldSetsExpr = parts.length ? `[...${parts.join(', ...')}]` : '[]'
    }

    // 19. Dashboard widgets
    {
      const entries = scanDashboardWidgetEntries({
        modId,
        roots,
        appImportBase,
        pkgImportBase: imps.pkgBase,
      })
      for (const entry of entries) {
        dashboardWidgets.push(
          `{ moduleId: ${toLiteral(entry.moduleId)}, key: ${toLiteral(entry.key)}, source: ${toLiteral(entry.source)}, loader: () => ${buildDynamicImportExpression(entry.importPath)}.then((mod) => mod.default ?? mod) }`
        )
        const existing = allDashboardWidgets.get(entry.key)
        if (!existing || (existing.source !== 'app' && entry.source === 'app')) {
          allDashboardWidgets.set(entry.key, {
            moduleId: entry.moduleId,
            source: entry.source,
            importPath: entry.importPath,
          })
        }
      }
    }

    // 20. Injection widgets
    {
      const files = scanModuleDir(roots, SCAN_CONFIGS.injectionWidgets)
      const widgetApp = path.join(roots.appBase, 'widgets', 'injection')
      for (const { relPath, fromApp } of files) {
        const segs = relPath.split('/')
        const file = segs.pop()!
        const base = file.replace(/\.(t|j)sx?$/, '')
        const importPath = sanitizeGeneratedModuleSpecifier(
          `${fromApp ? appImportBase : imps.pkgBase}/widgets/injection/${[...segs, base].join('/')}`
        )
        const key = [modId, ...segs, base].filter(Boolean).join(':')
        const source = fromApp ? 'app' : 'package'
        injectionWidgets.push(
          `{ moduleId: ${toLiteral(modId)}, key: ${toLiteral(key)}, source: ${toLiteral(source)}, loader: () => ${buildDynamicImportExpression(importPath)}.then((mod) => mod.default ?? mod) }`
        )
        const existing = allInjectionWidgets.get(key)
        if (!existing || (existing.source !== 'app' && source === 'app')) {
          allInjectionWidgets.set(key, { moduleId: modId, source, importPath })
        }
      }
    }

    // 21. Injection table
    {
      const resolved = resolveModuleFile(roots, imps, 'widgets/injection-table.ts')
      if (resolved) {
        const importName = `InjTable_${toVar(modId)}_${importIdRef.value++}`
        const importPath = sanitizeGeneratedModuleSpecifier(resolved.importPath)
        imports.push(buildImportStatement(`* as ${importName}`, importPath))
        injectionTableImportName = importName
        allInjectionTables.push({ moduleId: modId, importPath, importName })
      }
    }

    if (searchImportName) {
      searchConfigs.push(`{ moduleId: '${modId}', config: (${searchImportName}.default ?? ${searchImportName}.searchConfig ?? ${searchImportName}.config ?? null) }`)
    }

    // Note: events, analytics, enrichers, notifications, AI tools, and translatable fields
    // configs are pushed inside processStandaloneConfig() above — no separate push needed here.

    moduleDecls.push(`{
      id: ${toLiteral(modId)},
      ${infoImportName ? `info: ${infoImportName}.metadata,` : ''}
      ${frontendRoutes.length ? `frontendRoutes: [${frontendRoutes.join(', ')}],` : ''}
      ${backendRoutes.length ? `backendRoutes: [${backendRoutes.join(', ')}],` : ''}
      ${apis.length ? `apis: [${apis.join(', ')}],` : ''}
      ${cliImportName ? `cli: ${cliImportName},` : ''}
      ${translations.length ? `translations: { ${translations.join(', ')} },` : ''}
      ${subscribers.length ? `subscribers: [${subscribers.join(', ')}],` : ''}
      ${workers.length ? `workers: [${workers.join(', ')}],` : ''}
      ${extensionsImportName ? `entityExtensions: ((${extensionsImportName}.default ?? ${extensionsImportName}.extensions) as import('@open-mercato/shared/modules/entities').EntityExtension[]) || [],` : ''}
      customFieldSets: ${customFieldSetsExpr},
      ${featuresImportName ? `features: ((${featuresImportName}.default ?? ${featuresImportName}.features) as any) || [],` : ''}
      ${customEntitiesImportName ? `customEntities: ((${customEntitiesImportName}.default ?? ${customEntitiesImportName}.entities) as any) || [],` : ''}
      ${dashboardWidgets.length ? `dashboardWidgets: [${dashboardWidgets.join(', ')}],` : ''}
      ${setupImportName ? `setup: (${setupImportName}.default ?? ${setupImportName}.setup) || undefined,` : ''}
      ${integrationImportName ? `integrations: (( ${integrationImportName}.integrations ?? (${integrationImportName}.integration ? [${integrationImportName}.integration] : []) ) as import('@open-mercato/shared/modules/integrations/types').IntegrationDefinition[]),` : ''}
      ${integrationImportName ? `bundles: (( ${integrationImportName}.bundles ?? (${integrationImportName}.bundle ? [${integrationImportName}.bundle] : []) ) as import('@open-mercato/shared/modules/integrations/types').IntegrationBundle[]),` : ''}
    }`)
    runtimeModuleDecls.push(`{
      id: ${toLiteral(modId)},
      ${infoImportName ? `info: ${infoImportName}.metadata,` : ''}
      ${runtimeFrontendRoutes.length ? `frontendRoutes: [${runtimeFrontendRoutes.join(', ')}],` : ''}
      ${runtimeBackendRoutes.length ? `backendRoutes: [${runtimeBackendRoutes.join(', ')}],` : ''}
      ${runtimeApis.length ? `apis: [${runtimeApis.join(', ')}],` : ''}
      ${translations.length ? `translations: { ${translations.join(', ')} },` : ''}
      ${subscribers.length ? `subscribers: [${subscribers.join(', ')}],` : ''}
      ${workers.length ? `workers: [${workers.join(', ')}],` : ''}
      ${extensionsImportName ? `entityExtensions: ((${extensionsImportName}.default ?? ${extensionsImportName}.extensions) as import('@open-mercato/shared/modules/entities').EntityExtension[]) || [],` : ''}
      customFieldSets: ${customFieldSetsExpr},
      ${featuresImportName ? `features: ((${featuresImportName}.default ?? ${featuresImportName}.features) as any) || [],` : ''}
      ${customEntitiesImportName ? `customEntities: ((${customEntitiesImportName}.default ?? ${customEntitiesImportName}.entities) as any) || [],` : ''}
      ${setupImportName ? `setup: (${setupImportName}.default ?? ${setupImportName}.setup) || undefined,` : ''}
      ${integrationImportName ? `integrations: (( ${integrationImportName}.integrations ?? (${integrationImportName}.integration ? [${integrationImportName}.integration] : []) ) as import('@open-mercato/shared/modules/integrations/types').IntegrationDefinition[]),` : ''}
      ${integrationImportName ? `bundles: (( ${integrationImportName}.bundles ?? (${integrationImportName}.bundle ? [${integrationImportName}.bundle] : []) ) as import('@open-mercato/shared/modules/integrations/types').IntegrationBundle[]),` : ''}
    }`)
  }

  // === UMES Conflict Detection ===
  {
    const { detectConflicts } = await import('@open-mercato/shared/lib/umes/conflict-detection')
    const componentOverrideInputs: Array<{ moduleId: string; componentId: string; priority: number }> = []
    const interceptorInputs: Array<{ moduleId: string; id: string; targetRoute: string; methods: string[]; priority: number }> = []
    const declaredFeatures = new Set<string>()
    const gatedExtensions: Array<{ moduleId: string; extensionId: string; features: string[] }> = []

    for (const source of umesConflictSources) {
      // Collect declared features from acl.ts
      if (source.aclPath) {
        try {
          const aclMod = await import(buildCacheBustedSourceImportUrl(source.aclPath))
          const features = aclMod.features ?? aclMod.default ?? []
          if (Array.isArray(features)) {
            for (const feat of features) {
              if (typeof feat === 'string') declaredFeatures.add(feat)
              else if (feat?.id) declaredFeatures.add(feat.id)
            }
          }
        } catch {}
      }

      // Collect component overrides
      if (source.componentOverridesPath) {
        try {
          const overridesMod = await import(buildCacheBustedSourceImportUrl(source.componentOverridesPath))
          const overrides = overridesMod.componentOverrides ?? overridesMod.default ?? []
          if (Array.isArray(overrides)) {
            for (const override of overrides) {
              const componentId = override?.target?.componentId
              const priority = override?.priority ?? 0
              if (componentId) {
                componentOverrideInputs.push({ moduleId: source.moduleId, componentId, priority })
              }
              const features = override?.features
              if (Array.isArray(features) && features.length > 0) {
                gatedExtensions.push({
                  moduleId: source.moduleId,
                  extensionId: `component-override:${componentId}`,
                  features,
                })
              }
            }
          }
        } catch {}
      }

      // Collect interceptors
      if (source.interceptorsPath) {
        try {
          const interceptorsMod = await import(buildCacheBustedSourceImportUrl(source.interceptorsPath))
          const interceptors = interceptorsMod.interceptors ?? interceptorsMod.default ?? []
          if (Array.isArray(interceptors)) {
            for (const interceptor of interceptors) {
              if (interceptor?.id && interceptor?.targetRoute) {
                interceptorInputs.push({
                  moduleId: source.moduleId,
                  id: interceptor.id,
                  targetRoute: interceptor.targetRoute,
                  methods: interceptor.methods ?? [],
                  priority: interceptor.priority ?? 0,
                })
              }
              const features = interceptor?.features
              if (Array.isArray(features) && features.length > 0) {
                gatedExtensions.push({
                  moduleId: source.moduleId,
                  extensionId: `interceptor:${interceptor.id}`,
                  features,
                })
              }
            }
          }
        } catch {}
      }
    }

    const conflictResult = detectConflicts({
      componentOverrides: componentOverrideInputs,
      interceptors: interceptorInputs,
      gatedExtensions,
      declaredFeatures,
    })

    for (const warning of conflictResult.warnings) {
      console.warn(`\x1b[33m[UMES Warning]\x1b[0m ${warning.message}`)
    }
    for (const error of conflictResult.errors) {
      console.error(`\x1b[31m[UMES Error]\x1b[0m ${error.message}`)
    }
    if (conflictResult.errors.length > 0) {
      throw new Error(
        `UMES conflict detection found ${conflictResult.errors.length} error(s). Fix conflicts before proceeding.`
      )
    }
  }

  const output = `// AUTO-GENERATED by mercato generate registry
import { createLazyModuleSubscriber, createLazyModuleWorker, type Module } from '@open-mercato/shared/modules/registry'
${imports.join('\n')}

export const modules: Module[] = [
  ${moduleDecls.join(',\n  ')}
]
export const modulesInfo = modules.map(m => ({ id: m.id, ...(m.info || {}) }))
export default modules
`
  const runtimeOutput = `// AUTO-GENERATED by mercato generate registry
import { createElement } from 'react'
import { createLazyModuleSubscriber, createLazyModuleWorker, type Module } from '@open-mercato/shared/modules/registry'
${runtimeImports.join('\n')}

export const modules: Module[] = [
  ${runtimeModuleDecls.join(',\n  ')}
]
export const modulesInfo = modules.map(m => ({ id: m.id, ...(m.info || {}) }))
export default modules
`
  const frontendRoutesOutput = `// AUTO-GENERATED by mercato generate registry
import type { FrontendRouteManifestEntry } from '@open-mercato/shared/modules/registry'
${frontendRouteManifestImports.join('\n')}

export const frontendRoutes: FrontendRouteManifestEntry[] = [
  ${frontendRouteManifestDecls.join(',\n  ')}
]

export default frontendRoutes
`
  const backendRoutesOutput = `// AUTO-GENERATED by mercato generate registry
import type { BackendRouteManifestEntry } from '@open-mercato/shared/modules/registry'
${backendRouteManifestImports.join('\n')}

export const backendRoutes: BackendRouteManifestEntry[] = [
  ${backendRouteManifestDecls.join(',\n  ')}
]

export default backendRoutes
`
  const apiRoutesOutput = `// AUTO-GENERATED by mercato generate registry
import type { ApiRouteManifestEntry } from '@open-mercato/shared/modules/registry'

export const apiRoutes: ApiRouteManifestEntry[] = [
  ${apiRouteManifestDecls.join(',\n  ')}
]

export default apiRoutes
`
  const widgetEntriesList = Array.from(allDashboardWidgets.entries()).sort(([a], [b]) => a.localeCompare(b))
  const widgetDecls = widgetEntriesList.map(
    ([key, data]) =>
      `  { moduleId: ${toLiteral(data.moduleId)}, key: ${toLiteral(key)}, source: ${toLiteral(data.source)}, loader: () => ${buildDynamicImportExpression(data.importPath)}.then((mod) => mod.default ?? mod) }`
  )
  const widgetsOutput = `// AUTO-GENERATED by mercato generate registry
import type { ModuleDashboardWidgetEntry } from '@open-mercato/shared/modules/registry'

export const dashboardWidgetEntries: ModuleDashboardWidgetEntry[] = [
${widgetDecls.join(',\n')}
]
`
  const searchEntriesLiteral = searchConfigs.join(',\n  ')
  const searchImportSection = searchImports.join('\n')
  const searchOutput = `// AUTO-GENERATED by mercato generate registry
import type { SearchModuleConfig } from '@open-mercato/shared/modules/search'
${searchImportSection ? `\n${searchImportSection}\n` : '\n'}type SearchConfigEntry = { moduleId: string; config: SearchModuleConfig | null }

const entriesRaw: SearchConfigEntry[] = [
${searchEntriesLiteral ? `  ${searchEntriesLiteral}\n` : ''}]
const entries = entriesRaw.filter((entry): entry is { moduleId: string; config: SearchModuleConfig } => entry.config != null)

export const searchModuleConfigEntries = entries
export const searchModuleConfigs: SearchModuleConfig[] = entries.map((entry) => entry.config)
`
  const eventsEntriesLiteral = eventsConfigs.join(',\n  ')
  const eventsImportSection = eventsImports.join('\n')
  const eventsOutput = `// AUTO-GENERATED by mercato generate registry
import type { EventModuleConfigBase, EventDefinition } from '@open-mercato/shared/modules/events'
${eventsImportSection ? `\n${eventsImportSection}\n` : '\n'}type EventConfigEntry = { moduleId: string; config: EventModuleConfigBase | null }

const entriesRaw: EventConfigEntry[] = [
${eventsEntriesLiteral ? `  ${eventsEntriesLiteral}\n` : ''}]
const entries = entriesRaw.filter((e): e is { moduleId: string; config: EventModuleConfigBase } => e.config != null)

export const eventModuleConfigEntries = entries
export const eventModuleConfigs: EventModuleConfigBase[] = entries.map((e) => e.config)
export const allEvents: EventDefinition[] = entries.flatMap((e) => e.config.events)

// Runtime registry for validation
const allDeclaredEventIds = new Set(allEvents.map((e) => e.id))
export function isEventDeclared(eventId: string): boolean {
  return allDeclaredEventIds.has(eventId)
}
`

  const analyticsEntriesLiteral = analyticsConfigs.join(',\n  ')
  const analyticsImportSection = analyticsImports.join('\n')
  const analyticsOutput = `// AUTO-GENERATED by mercato generate registry
import type { AnalyticsModuleConfig } from '@open-mercato/shared/modules/analytics'
${analyticsImportSection ? `\n${analyticsImportSection}\n` : '\n'}type AnalyticsConfigEntry = { moduleId: string; config: AnalyticsModuleConfig | null }

const entriesRaw: AnalyticsConfigEntry[] = [
${analyticsEntriesLiteral ? `  ${analyticsEntriesLiteral}\n` : ''}]
const entries = entriesRaw.filter((entry): entry is { moduleId: string; config: AnalyticsModuleConfig } => entry.config != null)

export const analyticsModuleConfigEntries = entries
export const analyticsModuleConfigs: AnalyticsModuleConfig[] = entries.map((entry) => entry.config)
`

  const transFieldsEntriesLiteral = transFieldsConfigs.join(',\n  ')
  const transFieldsImportSection = transFieldsImports.join('\n')
  const transFieldsOutput = `// AUTO-GENERATED by mercato generate registry
import { registerTranslatableFields } from '@open-mercato/shared/lib/localization/translatable-fields'
${transFieldsImportSection ? `\n${transFieldsImportSection}\n` : '\n'}type TransFieldsEntry = { moduleId: string; fields: Record<string, string[]> }

const entries: TransFieldsEntry[] = [
${transFieldsEntriesLiteral ? `  ${transFieldsEntriesLiteral}\n` : ''}]

const allFields: Record<string, string[]> = {}
for (const entry of entries) {
  for (const [key, value] of Object.entries(entry.fields)) {
    allFields[key] = value
  }
}

export const translatableFieldEntries = entries
export const allTranslatableFields = allFields
export const allTranslatableEntityTypes = Object.keys(allFields)

// Auto-register on import (side-effect)
registerTranslatableFields(allFields)
`

  const notificationEntriesLiteral = notificationTypes.join(',\n  ')
  const notificationImportSection = notificationImports.join('\n')
  const notificationsOutput = `// AUTO-GENERATED by mercato generate registry
import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'
${notificationImportSection ? `\n${notificationImportSection}\n` : '\n'}type NotificationTypeEntry = { moduleId: string; types: NotificationTypeDefinition[] }

const entriesRaw: NotificationTypeEntry[] = [
${notificationEntriesLiteral ? `  ${notificationEntriesLiteral}\n` : ''}]

const allTypes = entriesRaw.flatMap((entry) => entry.types)

export const notificationTypeEntries = entriesRaw
export const notificationTypes = allTypes

export function getNotificationTypes(): NotificationTypeDefinition[] {
  return allTypes
}

export function getNotificationType(type: string): NotificationTypeDefinition | undefined {
  return allTypes.find((t) => t.type === type)
}
`
  const notificationClientEntriesLiteral = notificationClientTypes.join(',\n  ')
  const notificationClientImportSection = notificationClientImports.join('\n')
  const notificationsClientOutput = `// AUTO-GENERATED by mercato generate registry
import type { ComponentType } from 'react'
import type { NotificationTypeDefinition, NotificationRendererProps } from '@open-mercato/shared/modules/notifications/types'
${notificationClientImportSection ? `\n${notificationClientImportSection}\n` : '\n'}type NotificationTypeEntry = { moduleId: string; types: NotificationTypeDefinition[] }
export type NotificationRenderers = Record<string, ComponentType<NotificationRendererProps>>

const entriesRaw: NotificationTypeEntry[] = [
${notificationClientEntriesLiteral ? `  ${notificationClientEntriesLiteral}\n` : ''}]

const allTypes = entriesRaw.flatMap((entry) => entry.types)
const renderers: NotificationRenderers = Object.fromEntries(
  allTypes
    .filter((typeDef) => Boolean(typeDef.Renderer))
    .map((typeDef) => [typeDef.type, typeDef.Renderer!]),
)

export const notificationClientTypeEntries = entriesRaw
export const notificationClientTypes = allTypes
export const notificationRenderers = renderers

export function getNotificationRenderers(): NotificationRenderers {
  return renderers
}
`

  const notificationHandlersEntriesLiteral = notificationHandlerEntries.join(',\n  ')
  const notificationHandlersImportSection = notificationHandlerImports.join('\n')
  const notificationHandlersOutput = `// AUTO-GENERATED by mercato generate registry
import type { NotificationHandler } from '@open-mercato/shared/modules/notifications/handler'
${notificationHandlersImportSection ? `\n${notificationHandlersImportSection}\n` : '\n'}type NotificationHandlerEntry = { moduleId: string; handlers: NotificationHandler[] }

export const notificationHandlerEntries: NotificationHandlerEntry[] = [
${notificationHandlersEntriesLiteral ? `  ${notificationHandlersEntriesLiteral}\n` : ''}]
`

  const paymentsClientOutput = `// AUTO-GENERATED by mercato generate registry
${paymentsClientImports.length ? paymentsClientImports.join('\n') + '\n' : '\n'}export const paymentGatewayClientModuleCount = ${paymentsClientImports.length}
`

  const messageTypeEntriesLiteral = messageTypeEntries.join(',\n  ')
  const messageTypeImportSection = messageTypeImports.join('\n')
  const messageTypesOutput = `// AUTO-GENERATED by mercato generate registry
import type { MessageTypeDefinition } from '@open-mercato/shared/modules/messages/types'
${messageTypeImportSection ? `\n${messageTypeImportSection}\n` : '\n'}type MessageTypeEntry = { moduleId: string; types: MessageTypeDefinition[] }

const entriesRaw: MessageTypeEntry[] = [
${messageTypeEntriesLiteral ? `  ${messageTypeEntriesLiteral}\n` : ''}]

const allTypes = entriesRaw.flatMap((entry) => entry.types)

export const messageTypeEntries = entriesRaw
export const messageTypes = allTypes

export function getMessageTypes(): MessageTypeDefinition[] {
  return allTypes
}

export function getMessageType(type: string): MessageTypeDefinition | undefined {
  return allTypes.find((entry) => entry.type === type)
}
`

  const messageObjectEntriesLiteral = messageObjectTypeEntries.join(',\n  ')
  const messageObjectImportSection = messageObjectTypeImports.join('\n')
  const messageObjectsOutput = `// AUTO-GENERATED by mercato generate registry
import type { MessageObjectTypeDefinition } from '@open-mercato/shared/modules/messages/types'
${messageObjectImportSection ? `\n${messageObjectImportSection}\n` : '\n'}type MessageObjectTypeEntry = { moduleId: string; types: MessageObjectTypeDefinition[] }

const entriesRaw: MessageObjectTypeEntry[] = [
${messageObjectEntriesLiteral ? `  ${messageObjectEntriesLiteral}\n` : ''}]

const allTypes = entriesRaw.flatMap((entry) => entry.types)

export const messageObjectTypeEntries = entriesRaw
export const messageObjectTypes = allTypes

export function getMessageObjectTypes(): MessageObjectTypeDefinition[] {
  return allTypes
}

export function getMessageObjectType(module: string, entityType: string): MessageObjectTypeDefinition | undefined {
  return allTypes.find((entry) => entry.module === module && entry.entityType === entityType)
}
`
  const messagesClientOutput = `// AUTO-GENERATED by mercato generate registry
import type { ComponentType } from 'react'
import type {
  MessageTypeDefinition,
  MessageObjectTypeDefinition,
  MessageListItemProps,
  MessageContentProps,
  MessageActionsProps,
  ObjectDetailProps,
  ObjectPreviewProps,
} from '@open-mercato/shared/modules/messages/types'
import { registerMessageObjectTypes } from '@open-mercato/core/modules/messages/lib/message-objects-registry'
import { configureMessageUiComponentRegistry } from '@open-mercato/core/modules/messages/components/utils/typeUiRegistry'
${messageTypeImportSection ? `\n${messageTypeImportSection}\n` : '\n'}${messageObjectImportSection ? `\n${messageObjectImportSection}\n` : ''}type MessageTypeEntry = { moduleId: string; types: MessageTypeDefinition[] }
type MessageObjectTypeEntry = { moduleId: string; types: MessageObjectTypeDefinition[] }

export type MessageListItemRenderers = Record<string, ComponentType<MessageListItemProps>>
export type MessageContentRenderers = Record<string, ComponentType<MessageContentProps>>
export type MessageActionsRenderers = Record<string, ComponentType<MessageActionsProps>>
export type MessageObjectDetailRenderers = Record<string, ComponentType<ObjectDetailProps>>
export type MessageObjectPreviewRenderers = Record<string, ComponentType<ObjectPreviewProps>>

export type MessageUiComponentRegistry = {
  listItemComponents: MessageListItemRenderers
  contentComponents: MessageContentRenderers
  actionsComponents: MessageActionsRenderers
  objectDetailComponents: MessageObjectDetailRenderers
  objectPreviewComponents: MessageObjectPreviewRenderers
}

const messageTypeEntriesRaw: MessageTypeEntry[] = [
${messageTypeEntriesLiteral ? `  ${messageTypeEntriesLiteral}\n` : ''}]
const messageObjectTypeEntriesRaw: MessageObjectTypeEntry[] = [
${messageObjectEntriesLiteral ? `  ${messageObjectEntriesLiteral}\n` : ''}]

const allMessageTypes = messageTypeEntriesRaw.flatMap((entry) => entry.types)
const allMessageObjectTypes = messageObjectTypeEntriesRaw.flatMap((entry) => entry.types)

const listItemComponents: MessageListItemRenderers = Object.fromEntries(
  allMessageTypes
    .filter((typeDef) => Boolean(typeDef.ui?.listItemComponent) && Boolean(typeDef.ListItemComponent))
    .map((typeDef) => [typeDef.ui!.listItemComponent!, typeDef.ListItemComponent!]),
)

const contentComponents: MessageContentRenderers = Object.fromEntries(
  allMessageTypes
    .filter((typeDef) => Boolean(typeDef.ui?.contentComponent) && Boolean(typeDef.ContentComponent))
    .map((typeDef) => [typeDef.ui!.contentComponent!, typeDef.ContentComponent!]),
)

const actionsComponents: MessageActionsRenderers = Object.fromEntries(
  allMessageTypes
    .filter((typeDef) => Boolean(typeDef.ui?.actionsComponent) && Boolean(typeDef.ActionsComponent))
    .map((typeDef) => [typeDef.ui!.actionsComponent!, typeDef.ActionsComponent!]),
)

const objectDetailComponents: MessageObjectDetailRenderers = Object.fromEntries(
  allMessageObjectTypes
    .filter((typeDef) => Boolean(typeDef.DetailComponent))
    .map((typeDef) => [\`\${typeDef.module}:\${typeDef.entityType}\`, typeDef.DetailComponent!]),
)

const objectPreviewComponents: MessageObjectPreviewRenderers = Object.fromEntries(
  allMessageObjectTypes
    .filter((typeDef) => Boolean(typeDef.PreviewComponent))
    .map((typeDef) => [\`\${typeDef.module}:\${typeDef.entityType}\`, typeDef.PreviewComponent!]),
)

const registry: MessageUiComponentRegistry = {
  listItemComponents,
  contentComponents,
  actionsComponents,
  objectDetailComponents,
  objectPreviewComponents,
}

export const messageClientTypeEntries = messageTypeEntriesRaw
export const messageClientObjectTypeEntries = messageObjectTypeEntriesRaw
export const messageUiComponentRegistry = registry

export function getMessageUiComponentRegistry(): MessageUiComponentRegistry {
  return registry
}

// Side-effects: register all message object types and configure the UI component registry on import.
for (const entry of messageObjectTypeEntriesRaw) {
  registerMessageObjectTypes(entry.types)
}
configureMessageUiComponentRegistry(registry)
`

  // Validate module dependencies declared via ModuleInfo.requires
  {
    const enabledIds = new Set(enabled.map((e) => e.id))
    const problems: string[] = []
    for (const [modId, reqs] of requiresByModule.entries()) {
      const missing = reqs.filter((r) => !enabledIds.has(r))
      if (missing.length) {
        problems.push(`- Module "${modId}" requires: ${missing.join(', ')}`)
      }
    }
    if (problems.length) {
      console.error('\nModule dependency check failed:')
      for (const p of problems) console.error(p)
      console.error('\nFix: Enable required module(s) in src/modules.ts. Example:')
      console.error(
        '  export const enabledModules = [ { id: \'' +
          Array.from(new Set(requiresByModule.values()).values()).join("' }, { id: '") +
          "' } ]"
      )
      process.exit(1)
    }
  }

  const structureChecksum = calculateStructureChecksum([
    ...Array.from(trackedRoots),
  ])

  writeGeneratedFile({ outFile, checksumFile, content: output, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: runtimeOutFile, checksumFile: runtimeChecksumFile, content: runtimeOutput, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: frontendRoutesOutFile, checksumFile: frontendRoutesChecksumFile, content: frontendRoutesOutput, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: backendRoutesOutFile, checksumFile: backendRoutesChecksumFile, content: backendRoutesOutput, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: apiRoutesOutFile, checksumFile: apiRoutesChecksumFile, content: apiRoutesOutput, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: widgetsOutFile, checksumFile: widgetsChecksumFile, content: widgetsOutput, structureChecksum, result, quiet })

  const injectionWidgetEntriesList = Array.from(allInjectionWidgets.entries()).sort(([a], [b]) => a.localeCompare(b))
  const injectionWidgetDecls = injectionWidgetEntriesList.map(
    ([key, data]) =>
      `  { moduleId: ${toLiteral(data.moduleId)}, key: ${toLiteral(key)}, source: ${toLiteral(data.source)}, loader: () => ${buildDynamicImportExpression(data.importPath)}.then((mod) => mod.default ?? mod) }`
  )
  const injectionWidgetsOutput = `// AUTO-GENERATED by mercato generate registry
import type { ModuleInjectionWidgetEntry } from '@open-mercato/shared/modules/registry'

export const injectionWidgetEntries: ModuleInjectionWidgetEntry[] = [
${injectionWidgetDecls.join(',\n')}
]
`
  const injectionTableImports = allInjectionTables.map(
    (entry) => buildImportStatement(`* as ${entry.importName}`, entry.importPath)
  )
  const injectionTableDecls = allInjectionTables.map(
    (entry) =>
      `  { moduleId: ${toLiteral(entry.moduleId)}, table: ((${entry.importName}.default ?? ${entry.importName}.injectionTable) as any) || {} }`
  )
  const injectionTablesOutput = `// AUTO-GENERATED by mercato generate registry
import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
${injectionTableImports.join('\n')}

export const injectionTables: Array<{ moduleId: string; table: ModuleInjectionTable }> = [
${injectionTableDecls.join(',\n')}
]
`
  writeGeneratedFile({ outFile: injectionWidgetsOutFile, checksumFile: injectionWidgetsChecksumFile, content: injectionWidgetsOutput, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: injectionTablesOutFile, checksumFile: injectionTablesChecksumFile, content: injectionTablesOutput, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: searchOutFile, checksumFile: searchChecksumFile, content: searchOutput, structureChecksum, result, quiet })

  // AI Tools generated file
  const aiToolsOutput = `// AUTO-GENERATED by mercato generate registry
${aiToolsImports.length ? aiToolsImports.join('\n') + '\n' : ''}
type AiToolConfigEntry = { moduleId: string; tools: unknown[] }

const aiToolConfigEntriesRaw: AiToolConfigEntry[] = [
${aiToolsConfigs.length ? '  ' + aiToolsConfigs.join(',\n  ') + '\n' : ''}]

export const aiToolConfigEntries: AiToolConfigEntry[] = aiToolConfigEntriesRaw.filter(
  (entry): entry is AiToolConfigEntry => Array.isArray(entry.tools) && entry.tools.length > 0,
)

export const allAiTools = aiToolConfigEntries.flatMap(e => e.tools)
`
  writeGeneratedFile({ outFile: aiToolsOutFile, checksumFile: aiToolsChecksumFile, content: aiToolsOutput, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: notificationsOutFile, checksumFile: notificationsChecksumFile, content: notificationsOutput, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: notificationsClientOutFile, checksumFile: notificationsClientChecksumFile, content: notificationsClientOutput, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: paymentsClientOutFile, checksumFile: paymentsClientChecksumFile, content: paymentsClientOutput, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: notificationHandlersOutFile, checksumFile: notificationHandlersChecksumFile, content: notificationHandlersOutput, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: messageTypesOutFile, checksumFile: messageTypesChecksumFile, content: messageTypesOutput, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: messageObjectsOutFile, checksumFile: messageObjectsChecksumFile, content: messageObjectsOutput, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: messagesClientOutFile, checksumFile: messagesClientChecksumFile, content: messagesClientOutput, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: eventsOutFile, checksumFile: eventsChecksumFile, content: eventsOutput, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: analyticsOutFile, checksumFile: analyticsChecksumFile, content: analyticsOutput, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: transFieldsOutFile, checksumFile: transFieldsChecksumFile, content: transFieldsOutput, structureChecksum, result, quiet })

  // Generator plugin outputs (registered via modules' generators.ts)
  for (const [pluginId, plugin] of pluginRegistry) {
    const state = pluginState.get(pluginId)!
    const importSection = state.imports.join('\n')
    const entriesLiteral = state.configs.join(',\n  ')
    const content = plugin.buildOutput({ importSection, entriesLiteral })
    const outFile = path.join(outputDir, plugin.outputFileName)
    const checksumFile = outFile.replace('.ts', '.checksum')
    writeGeneratedFile({ outFile, checksumFile, content, structureChecksum, result, quiet })
  }

  // Bootstrap registrations: aggregate all plugin bootstrap-registration hooks into one file.
  // Always written (even when empty) so bootstrap.ts can unconditionally import it.
  {
    const bootstrapPlugins = [...pluginRegistry.values()].filter((p) => p.bootstrapRegistration)
    const allEntryImports: string[] = []
    const allRegImports: string[] = []
    const allCalls: string[] = []
    for (const plugin of bootstrapPlugins) {
      const reg = plugin.bootstrapRegistration!
      const outputBase = plugin.outputFileName.replace('.ts', '')
      allEntryImports.push(buildImportStatement(`{ ${reg.entriesExportName} }`, `./${outputBase}`))
      allRegImports.push(...reg.registrationImports)
      allCalls.push(reg.buildCall(reg.entriesExportName))
    }
    const uniqueImports = [...new Set([...allEntryImports, ...allRegImports])]
    const importSection = uniqueImports.join('\n')
    const body = allCalls.length ? `  ${allCalls.join('\n  ')}` : ''
    const bootstrapRegsOutput = `// AUTO-GENERATED by mercato generate registry
${importSection ? `${importSection}\n` : ''}
export function runBootstrapRegistrations(): void {
${body}
}
`
    writeGeneratedFile({ outFile: bootstrapRegsOutFile, checksumFile: bootstrapRegsChecksumFile, content: bootstrapRegsOutput, structureChecksum, result, quiet })
  }

  // Enrichers generated file
  const enricherEntriesLiteral = enricherConfigs.join(',\n  ')
  const enricherImportSection = enricherImports.join('\n')
  const enrichersOutput = `// AUTO-GENERATED by mercato generate registry
import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
${enricherImportSection ? `\n${enricherImportSection}\n` : '\n'}type EnricherEntry = { moduleId: string; enrichers: ResponseEnricher[] }

export const enricherEntries: EnricherEntry[] = [
${enricherEntriesLiteral ? `  ${enricherEntriesLiteral}\n` : ''}]
`
  writeGeneratedFile({ outFile: enrichersOutFile, checksumFile: enrichersChecksumFile, content: enrichersOutput, structureChecksum, result, quiet })
  // Inbox Actions generated file
  const inboxActionsEntriesLiteral = inboxActionsConfigs.join(',\n  ')
  const inboxActionsImportSection = inboxActionsImports.join('\n')
  const inboxActionsOutput = `// AUTO-GENERATED by mercato generate registry — do not edit
import type { InboxActionDefinition } from '@open-mercato/shared/modules/inbox-actions'
${inboxActionsImportSection ? `\n${inboxActionsImportSection}\n` : '\n'}
type InboxActionConfigEntry = { moduleId: string; actions: InboxActionDefinition[] }

const entriesRaw: InboxActionConfigEntry[] = [
${inboxActionsEntriesLiteral ? `  ${inboxActionsEntriesLiteral}\n` : ''}]

const entries = entriesRaw.filter((e): e is InboxActionConfigEntry => Array.isArray(e.actions) && e.actions.length > 0)

export const inboxActionConfigEntries = entries
export const inboxActions: InboxActionDefinition[] = entries.flatMap((e) => e.actions)

const actionTypeMap = new Map(inboxActions.map((a) => [a.type, a]))
export function getInboxAction(type: string): InboxActionDefinition | undefined {
  return actionTypeMap.get(type)
}
export function getRegisteredActionTypes(): string[] {
  return Array.from(actionTypeMap.keys())
}
`
  writeGeneratedFile({ outFile: inboxActionsOutFile, checksumFile: inboxActionsChecksumFile, content: inboxActionsOutput, structureChecksum, result, quiet })

  const interceptorEntriesLiteral = interceptorConfigs.join(',\n  ')
  const interceptorImportSection = interceptorImports.join('\n')
  const interceptorsOutput = `// AUTO-GENERATED by mercato generate registry
import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
${interceptorImportSection ? `\n${interceptorImportSection}\n` : '\n'}type InterceptorEntry = { moduleId: string; interceptors: ApiInterceptor[] }

export const interceptorEntries: InterceptorEntry[] = [
${interceptorEntriesLiteral ? `  ${interceptorEntriesLiteral}\n` : ''}]
`
  writeGeneratedFile({ outFile: interceptorsOutFile, checksumFile: interceptorsChecksumFile, content: interceptorsOutput, structureChecksum, result, quiet })

  const componentOverrideEntriesLiteral = componentOverrideConfigs.join(',\n  ')
  const componentOverrideImportSection = componentOverrideImports.join('\n')
  const componentOverridesOutput = `// AUTO-GENERATED by mercato generate registry
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
${componentOverrideImportSection ? `\n${componentOverrideImportSection}\n` : '\n'}type ComponentOverrideEntry = { moduleId: string; componentOverrides: ComponentOverride[] }

export const componentOverrideEntries: ComponentOverrideEntry[] = [
${componentOverrideEntriesLiteral ? `  ${componentOverrideEntriesLiteral}\n` : ''}]
`
  writeGeneratedFile({
    outFile: componentOverridesOutFile,
    checksumFile: componentOverridesChecksumFile,
    content: componentOverridesOutput,
    structureChecksum,
    result,
    quiet,
  })

  const guardEntriesLiteral = guardConfigs.join(',\n  ')
  const guardImportSection = guardImports.join('\n')
  const guardsOutput = `// AUTO-GENERATED by mercato generate registry
import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
${guardImportSection ? `\n${guardImportSection}\n` : '\n'}type GuardEntry = { moduleId: string; guards: MutationGuard[] }

export const guardEntries: GuardEntry[] = [
${guardEntriesLiteral ? `  ${guardEntriesLiteral}\n` : ''}]
`
  writeGeneratedFile({ outFile: guardsOutFile, checksumFile: guardsChecksumFile, content: guardsOutput, structureChecksum, result, quiet })

  const commandInterceptorEntriesLiteral = commandInterceptorConfigs.join(',\n  ')
  const commandInterceptorImportSection = commandInterceptorImports.join('\n')
  const commandInterceptorsOutput = `// AUTO-GENERATED by mercato generate registry
import type { CommandInterceptor } from '@open-mercato/shared/lib/commands/command-interceptor'
${commandInterceptorImportSection ? `\n${commandInterceptorImportSection}\n` : '\n'}type CommandInterceptorEntry = { moduleId: string; interceptors: CommandInterceptor[] }

export const commandInterceptorEntries: CommandInterceptorEntry[] = [
${commandInterceptorEntriesLiteral ? `  ${commandInterceptorEntriesLiteral}\n` : ''}]
`
  writeGeneratedFile({ outFile: commandInterceptorsOutFile, checksumFile: commandInterceptorsChecksumFile, content: commandInterceptorsOutput, structureChecksum, result, quiet })

  const frontendMiddlewareEntriesLiteral = frontendMiddlewareConfigs.join(',\n  ')
  const frontendMiddlewareImportSection = frontendMiddlewareImports.join('\n')
  const frontendMiddlewareOutput = `// AUTO-GENERATED by mercato generate registry
import type { PageMiddlewareRegistryEntry, PageRouteMiddleware } from '@open-mercato/shared/modules/middleware/page'
${frontendMiddlewareImportSection ? `\n${frontendMiddlewareImportSection}\n` : '\n'}type FrontendMiddlewareEntry = { moduleId: string; middleware: PageRouteMiddleware[] }

const entriesRaw: FrontendMiddlewareEntry[] = [
${frontendMiddlewareEntriesLiteral ? `  ${frontendMiddlewareEntriesLiteral}\n` : ''}]

export const frontendMiddlewareEntries: PageMiddlewareRegistryEntry[] = entriesRaw
`
  writeGeneratedFile({
    outFile: frontendMiddlewareOutFile,
    checksumFile: frontendMiddlewareChecksumFile,
    content: frontendMiddlewareOutput,
    structureChecksum,
    result,
    quiet,
  })

  const backendMiddlewareEntriesLiteral = backendMiddlewareConfigs.join(',\n  ')
  const backendMiddlewareImportSection = backendMiddlewareImports.join('\n')
  const backendMiddlewareOutput = `// AUTO-GENERATED by mercato generate registry
import type { PageMiddlewareRegistryEntry, PageRouteMiddleware } from '@open-mercato/shared/modules/middleware/page'
${backendMiddlewareImportSection ? `\n${backendMiddlewareImportSection}\n` : '\n'}type BackendMiddlewareEntry = { moduleId: string; middleware: PageRouteMiddleware[] }

const entriesRaw: BackendMiddlewareEntry[] = [
${backendMiddlewareEntriesLiteral ? `  ${backendMiddlewareEntriesLiteral}\n` : ''}]

export const backendMiddlewareEntries: PageMiddlewareRegistryEntry[] = entriesRaw
`
  writeGeneratedFile({
    outFile: backendMiddlewareOutFile,
    checksumFile: backendMiddlewareChecksumFile,
    content: backendMiddlewareOutput,
    structureChecksum,
    result,
    quiet,
  })

  return result
}

export async function generateModuleRegistryApp(options: ModuleRegistryOptions): Promise<GeneratorResult> {
  const { resolver, quiet = false } = options
  const result = createGeneratorResult()

  const outputDir = resolver.getOutputDir()
  const outFile = path.join(outputDir, 'modules.app.generated.ts')
  const checksumFile = path.join(outputDir, 'modules.app.generated.checksum')

  const enabled = resolver.loadEnabledModules()
  const imports: string[] = []
  const moduleDecls: string[] = []
  const importIdRef = { value: 0 }
  const trackedRoots = new Set<string>()
  const requiresByModule = new Map<string, string[]>()

  for (const entry of enabled) {
    const modId = entry.id
    const roots = resolver.getModulePaths(entry)
    const rawImps = resolver.getModuleImportBase(entry)
    trackedRoots.add(roots.appBase)
    trackedRoots.add(roots.pkgBase)

    const isAppModule = entry.from === '@app'
    const appImportBase = isAppModule ? `../../src/modules/${modId}` : rawImps.appBase
    const imps: ModuleImports = { appBase: appImportBase, pkgBase: rawImps.pkgBase }

    const translations: string[] = []
    const subscribers: string[] = []
    const workers: string[] = []
    let infoImportName: string | null = null
    let extensionsImportName: string | null = null
    let fieldsImportName: string | null = null
    let featuresImportName: string | null = null
    let customEntitiesImportName: string | null = null
    const dashboardWidgets: string[] = []
    let setupImportName: string | null = null
    let integrationImportName: string | null = null
    let customFieldSetsExpr = '[]'

    const indexResolved = resolveModuleFile(roots, imps, 'index.ts')
    if (indexResolved) {
      infoImportName = `I${importIdRef.value++}_${toVar(modId)}`
      const importPath = sanitizeGeneratedModuleSpecifier(indexResolved.importPath)
      imports.push(buildImportStatement(`* as ${infoImportName}`, importPath))
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(indexResolved.absolutePath)
        const reqs: string[] | undefined =
          mod?.metadata && Array.isArray(mod.metadata.requires) ? mod.metadata.requires : undefined
        if (reqs && reqs.length) requiresByModule.set(modId, reqs)
      } catch {}
    }

    {
      const setup = resolveConventionFile(roots, imps, 'setup.ts', 'SETUP', modId, importIdRef, imports)
      if (setup) setupImportName = setup.importName
    }

    {
      const resolved = resolveModuleFile(roots, imps, 'integration.ts')
      if (resolved) {
        const importName = `INTEGRATION_${toVar(modId)}_${importIdRef.value++}`
        imports.push(buildImportStatement(`* as ${importName}`, resolved.importPath))
        integrationImportName = importName
      }
    }

    {
      const ext = resolveConventionFile(roots, imps, 'data/extensions.ts', 'X', modId, importIdRef, imports)
      if (ext) extensionsImportName = ext.importName
    }

    {
      const aclResolved = resolveModuleFile(roots, imps, 'acl.ts')
      if (aclResolved) {
        const importName = `ACL_${toVar(modId)}_${importIdRef.value++}`
        const importPath = sanitizeGeneratedModuleSpecifier(aclResolved.importPath)
        imports.push(buildImportStatement(`* as ${importName}`, importPath))
        featuresImportName = importName
      }
    }

    {
      const ce = resolveConventionFile(roots, imps, 'ce.ts', 'CE', modId, importIdRef, imports)
      if (ce) customEntitiesImportName = ce.importName
    }

    {
      const fields = resolveConventionFile(roots, imps, 'data/fields.ts', 'F', modId, importIdRef, imports)
      if (fields) fieldsImportName = fields.importName
    }

    translations.push(...processTranslations({
      roots,
      modId,
      appImportBase,
      pkgImportBase: imps.pkgBase,
      imports,
    }))

    subscribers.push(...await processSubscribers({
      roots,
      modId,
      appImportBase,
      pkgImportBase: imps.pkgBase,
    }))

    workers.push(...await processWorkers({
      roots,
      modId,
      appImportBase,
      pkgImportBase: imps.pkgBase,
    }))

    {
      const parts: string[] = []
      if (fieldsImportName) {
        parts.push(`(( ${fieldsImportName}.default ?? ${fieldsImportName}.fieldSets) as any) || []`)
      }
      if (customEntitiesImportName) {
        parts.push(
          `((( ${customEntitiesImportName}.default ?? ${customEntitiesImportName}.entities) as any) || []).filter((e: any) => Array.isArray(e.fields) && e.fields.length).map((e: any) => ({ entity: e.id, fields: e.fields, source: ${toLiteral(modId)} }))`
        )
      }
      customFieldSetsExpr = parts.length ? `[...${parts.join(', ...')}]` : '[]'
    }

    {
      const entries = scanDashboardWidgetEntries({
        modId,
        roots,
        appImportBase,
        pkgImportBase: imps.pkgBase,
      })
      for (const entry of entries) {
        dashboardWidgets.push(
          `{ moduleId: ${toLiteral(entry.moduleId)}, key: ${toLiteral(entry.key)}, source: ${toLiteral(entry.source)}, loader: () => ${buildDynamicImportExpression(entry.importPath)}.then((mod) => mod.default ?? mod) }`
        )
      }
    }

    moduleDecls.push(`{
      id: ${toLiteral(modId)},
      ${infoImportName ? `info: ${infoImportName}.metadata,` : ''}
      ${translations.length ? `translations: { ${translations.join(', ')} },` : ''}
      ${subscribers.length ? `subscribers: [${subscribers.join(', ')}],` : ''}
      ${workers.length ? `workers: [${workers.join(', ')}],` : ''}
      ${extensionsImportName ? `entityExtensions: ((${extensionsImportName}.default ?? ${extensionsImportName}.extensions) as any) || [],` : ''}
      customFieldSets: ${customFieldSetsExpr},
      ${featuresImportName ? `features: ((${featuresImportName}.default ?? ${featuresImportName}.features) as any) || [],` : ''}
      ${customEntitiesImportName ? `customEntities: ((${customEntitiesImportName}.default ?? ${customEntitiesImportName}.entities) as any) || [],` : ''}
      ${dashboardWidgets.length ? `dashboardWidgets: [${dashboardWidgets.join(', ')}],` : ''}
      ${setupImportName ? `setup: (${setupImportName}.default ?? ${setupImportName}.setup) || undefined,` : ''}
      ${integrationImportName ? `integrations: (( ${integrationImportName}.integrations ?? (${integrationImportName}.integration ? [${integrationImportName}.integration] : []) ) as import('@open-mercato/shared/modules/integrations/types').IntegrationDefinition[]),` : ''}
      ${integrationImportName ? `bundles: (( ${integrationImportName}.bundles ?? (${integrationImportName}.bundle ? [${integrationImportName}.bundle] : []) ) as import('@open-mercato/shared/modules/integrations/types').IntegrationBundle[]),` : ''}
    }`)
  }

  const output = `// AUTO-GENERATED by mercato generate registry (app version)
// This file excludes route handlers and CLI commands from the request bootstrap path.
import { createLazyModuleSubscriber, createLazyModuleWorker, type Module } from '@open-mercato/shared/modules/registry'
${imports.join('\n')}

export const modules: Module[] = [
  ${moduleDecls.join(',\n  ')}
]
export const modulesInfo = modules.map(m => ({ id: m.id, ...(m.info || {}) }))
export default modules
`

  {
    const enabledIds = new Set(enabled.map((e) => e.id))
    const problems: string[] = []
    for (const [modId, reqs] of requiresByModule.entries()) {
      const missing = reqs.filter((r) => !enabledIds.has(r))
      if (missing.length) {
        problems.push(`- Module "${modId}" requires: ${missing.join(', ')}`)
      }
    }
    if (problems.length) {
      console.error('\nModule dependency check failed:')
      for (const p of problems) console.error(p)
      console.error('\nFix: Enable required module(s) in src/modules.ts. Example:')
      console.error(
        '  export const enabledModules = [ { id: \'' +
          Array.from(new Set(requiresByModule.values()).values()).join("' }, { id: '") +
          "' } ]"
      )
      process.exit(1)
    }
  }

  const structureChecksum = calculateStructureChecksum(Array.from(trackedRoots))
  writeGeneratedFile({ outFile, checksumFile, content: output, structureChecksum, result, quiet })

  return result
}

/**
 * Generate a CLI-specific module registry that excludes Next.js dependent code.
 * This produces modules.cli.generated.ts which can be loaded without Next.js runtime.
 *
 * Includes: module metadata, CLI commands, translations, subscribers, workers, entity extensions,
 *           features/ACL, custom entities, vector config, custom fields, dashboard widgets
 * Excludes: frontend routes, backend routes, API handlers, injection widgets
 */
export async function generateModuleRegistryCli(options: ModuleRegistryOptions): Promise<GeneratorResult> {
  const { resolver, quiet = false } = options
  const result = createGeneratorResult()

  const outputDir = resolver.getOutputDir()
  const outFile = path.join(outputDir, 'modules.cli.generated.ts')
  const checksumFile = path.join(outputDir, 'modules.cli.generated.checksum')

  const enabled = resolver.loadEnabledModules()
  const imports: string[] = []
  const moduleDecls: string[] = []
  // Mutable ref so extracted helper functions can increment the shared counter
  const importIdRef = { value: 0 }
  const trackedRoots = new Set<string>()
  const requiresByModule = new Map<string, string[]>()

  for (const entry of enabled) {
    const modId = entry.id
    const roots = resolver.getModulePaths(entry)
    const rawImps = resolver.getModuleImportBase(entry)
    trackedRoots.add(roots.appBase)
    trackedRoots.add(roots.pkgBase)

    const isAppModule = entry.from === '@app'
    const appImportBase = isAppModule ? `../../src/modules/${modId}` : rawImps.appBase
    const imps: ModuleImports = { appBase: appImportBase, pkgBase: rawImps.pkgBase }

    let cliImportName: string | null = null
    const translations: string[] = []
    const subscribers: string[] = []
    const workers: string[] = []
    let infoImportName: string | null = null
    let extensionsImportName: string | null = null
    let fieldsImportName: string | null = null
    let featuresImportName: string | null = null
    let customEntitiesImportName: string | null = null
    let vectorImportName: string | null = null
    const dashboardWidgets: string[] = []
    let setupImportName: string | null = null
    let integrationImportName: string | null = null
    let customFieldSetsExpr: string = '[]'

    // Module metadata: index.ts (overrideable)
    const indexResolved = resolveModuleFile(roots, imps, 'index.ts')
    if (indexResolved) {
      infoImportName = `I${importIdRef.value++}_${toVar(modId)}`
      const importPath = sanitizeGeneratedModuleSpecifier(indexResolved.importPath)
      imports.push(buildImportStatement(`* as ${infoImportName}`, importPath))
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(indexResolved.absolutePath)
        const reqs: string[] | undefined =
          mod?.metadata && Array.isArray(mod.metadata.requires) ? mod.metadata.requires : undefined
        if (reqs && reqs.length) requiresByModule.set(modId, reqs)
      } catch {}
    }

    // Module setup configuration: setup.ts
    {
      const setup = resolveConventionFile(roots, imps, 'setup.ts', 'SETUP', modId, importIdRef, imports)
      if (setup) setupImportName = setup.importName
    }

    // Integration manifest: integration.ts
    {
      const resolved = resolveModuleFile(roots, imps, 'integration.ts')
      if (resolved) {
        const importName = `INTEGRATION_${toVar(modId)}_${importIdRef.value++}`
        imports.push(buildImportStatement(`* as ${importName}`, resolved.importPath))
        integrationImportName = importName
      }
    }

    // Entity extensions: data/extensions.ts
    {
      const ext = resolveConventionFile(roots, imps, 'data/extensions.ts', 'X', modId, importIdRef, imports)
      if (ext) extensionsImportName = ext.importName
    }

    // RBAC: acl.ts
    {
      const aclResolved = resolveModuleFile(roots, imps, 'acl.ts')
      if (aclResolved) {
        const importName = `ACL_${toVar(modId)}_${importIdRef.value++}`
        const importPath = sanitizeGeneratedModuleSpecifier(aclResolved.importPath)
        imports.push(buildImportStatement(`* as ${importName}`, importPath))
        featuresImportName = importName
      }
    }

    // Custom entities: ce.ts
    {
      const ce = resolveConventionFile(roots, imps, 'ce.ts', 'CE', modId, importIdRef, imports)
      if (ce) customEntitiesImportName = ce.importName
    }

    // Vector search configuration: vector.ts
    {
      const vec = resolveConventionFile(roots, imps, 'vector.ts', 'VECTOR', modId, importIdRef, imports)
      if (vec) vectorImportName = vec.importName
    }

    // Custom fields: data/fields.ts
    {
      const fields = resolveConventionFile(roots, imps, 'data/fields.ts', 'F', modId, importIdRef, imports)
      if (fields) fieldsImportName = fields.importName
    }

    // CLI
    {
      const cliResolved = resolveModuleFile(roots, imps, 'cli.ts')
      if (cliResolved) {
        const importName = `CLI_${toVar(modId)}`
        imports.push(buildImportStatement(importName, sanitizeGeneratedModuleSpecifier(cliResolved.importPath)))
        cliImportName = importName
      }
    }

    // Translations
    translations.push(...processTranslations({
      roots,
      modId,
      appImportBase,
      pkgImportBase: imps.pkgBase,
      imports,
    }))

    // Subscribers
    subscribers.push(...await processSubscribers({
      roots,
      modId,
      appImportBase,
      pkgImportBase: imps.pkgBase,
    }))

    // Workers
    workers.push(...await processWorkers({
      roots,
      modId,
      appImportBase,
      pkgImportBase: imps.pkgBase,
    }))

    // Build combined customFieldSets expression
    {
      const parts: string[] = []
      if (fieldsImportName)
        parts.push(`(( ${fieldsImportName}.default ?? ${fieldsImportName}.fieldSets) as any) || []`)
      if (customEntitiesImportName)
        parts.push(
          `((( ${customEntitiesImportName}.default ?? ${customEntitiesImportName}.entities) as any) || []).filter((e: any) => Array.isArray(e.fields) && e.fields.length).map((e: any) => ({ entity: e.id, fields: e.fields, source: ${toLiteral(modId)} }))`
        )
      customFieldSetsExpr = parts.length ? `[...${parts.join(', ...')}]` : '[]'
    }

    // Dashboard widgets
    {
      const entries = scanDashboardWidgetEntries({
        modId,
        roots,
        appImportBase,
        pkgImportBase: imps.pkgBase,
      })
      for (const entry of entries) {
        dashboardWidgets.push(
          `{ moduleId: ${toLiteral(entry.moduleId)}, key: ${toLiteral(entry.key)}, source: ${toLiteral(entry.source)}, loader: () => ${buildDynamicImportExpression(entry.importPath)}.then((mod) => mod.default ?? mod) }`
        )
      }
    }

    moduleDecls.push(`{
      id: ${toLiteral(modId)},
      ${infoImportName ? `info: ${infoImportName}.metadata,` : ''}
      ${cliImportName ? `cli: ${cliImportName},` : ''}
      ${translations.length ? `translations: { ${translations.join(', ')} },` : ''}
      ${subscribers.length ? `subscribers: [${subscribers.join(', ')}],` : ''}
      ${workers.length ? `workers: [${workers.join(', ')}],` : ''}
      ${extensionsImportName ? `entityExtensions: ((${extensionsImportName}.default ?? ${extensionsImportName}.extensions) as any) || [],` : ''}
      customFieldSets: ${customFieldSetsExpr},
      ${featuresImportName ? `features: ((${featuresImportName}.default ?? ${featuresImportName}.features) as any) || [],` : ''}
      ${customEntitiesImportName ? `customEntities: ((${customEntitiesImportName}.default ?? ${customEntitiesImportName}.entities) as any) || [],` : ''}
      ${dashboardWidgets.length ? `dashboardWidgets: [${dashboardWidgets.join(', ')}],` : ''}
      ${vectorImportName ? `vector: (${vectorImportName}.default ?? ${vectorImportName}.vectorConfig ?? ${vectorImportName}.config ?? undefined),` : ''}
      ${setupImportName ? `setup: (${setupImportName}.default ?? ${setupImportName}.setup) || undefined,` : ''}
      ${integrationImportName ? `integrations: (( ${integrationImportName}.integrations ?? (${integrationImportName}.integration ? [${integrationImportName}.integration] : []) ) as import('@open-mercato/shared/modules/integrations/types').IntegrationDefinition[]),` : ''}
      ${integrationImportName ? `bundles: (( ${integrationImportName}.bundles ?? (${integrationImportName}.bundle ? [${integrationImportName}.bundle] : []) ) as import('@open-mercato/shared/modules/integrations/types').IntegrationBundle[]),` : ''}
    }`)
  }

  const output = `// AUTO-GENERATED by mercato generate registry (CLI version)
// This file excludes Next.js dependent code (routes, APIs, injection widgets)
import { createLazyModuleSubscriber, createLazyModuleWorker, type Module } from '@open-mercato/shared/modules/registry'
${imports.join('\n')}

export const modules: Module[] = [
  ${moduleDecls.join(',\n  ')}
]
export const modulesInfo = modules.map(m => ({ id: m.id, ...(m.info || {}) }))
export default modules
`

  // Validate module dependencies declared via ModuleInfo.requires
  {
    const enabledIds = new Set(enabled.map((e) => e.id))
    const problems: string[] = []
    for (const [modId, reqs] of requiresByModule.entries()) {
      const missing = reqs.filter((r) => !enabledIds.has(r))
      if (missing.length) {
        problems.push(`- Module "${modId}" requires: ${missing.join(', ')}`)
      }
    }
    if (problems.length) {
      console.error('\nModule dependency check failed:')
      for (const p of problems) console.error(p)
      console.error('\nFix: Enable required module(s) in src/modules.ts. Example:')
      console.error(
        '  export const enabledModules = [ { id: \'' +
          Array.from(new Set(requiresByModule.values()).values()).join("' }, { id: '") +
          "' } ]"
      )
      process.exit(1)
    }
  }

  const structureChecksum = calculateStructureChecksum(Array.from(trackedRoots))
  writeGeneratedFile({ outFile, checksumFile, content: output, structureChecksum, result, quiet })

  return result
}
