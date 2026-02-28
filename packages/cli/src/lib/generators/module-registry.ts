import fs from 'node:fs'
import path from 'node:path'
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
  SCAN_CONFIGS,
  type ModuleRoots,
  type ModuleImports,
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
    const importPath = `${fromApp ? appImportBase : pkgImportBase}/widgets/dashboard/${[...segs, base].join('/')}`
    const key = [modId, ...segs, base].filter(Boolean).join(':')
    const source = fromApp ? 'app' : 'package'
    return { moduleId: modId, key, source, importPath }
  })
}

function processPageFiles(options: {
  files: Array<{ relPath: string; fromApp: boolean }>
  type: 'frontend' | 'backend'
  modId: string
  appDir: string
  pkgDir: string
  appImportBase: string
  pkgImportBase: string
  imports: string[]
  importIdRef: { value: number }
}): string[] {
  const { files, type, modId, appDir, pkgDir, appImportBase, pkgImportBase, imports, importIdRef } = options
  const prefix = type === 'frontend' ? 'C' : 'B'
  const modPrefix = type === 'frontend' ? 'CM' : 'BM'
  const metaPrefix = type === 'frontend' ? 'M' : 'BM'
  const routes: string[] = []

  // Next-style page.tsx files
  for (const { relPath, fromApp } of files.filter(({ relPath: f }) => f.endsWith('/page.tsx') || f === 'page.tsx')) {
    const segs = relPath.split('/')
    segs.pop()
    const importName = `${prefix}${importIdRef.value++}_${toVar(modId)}_${toVar(segs.join('_') || 'index')}`
    const pageModName = `${modPrefix}${importIdRef.value++}_${toVar(modId)}_${toVar(segs.join('_') || 'index')}`
    const sub = segs.length ? `${segs.join('/')}/page` : 'page'
    const importPath = `${fromApp ? appImportBase : pkgImportBase}/${type}/${sub}`
    const routePath = type === 'frontend'
      ? '/' + (segs.join('/') || '')
      : '/backend/' + (segs.join('/') || modId)
    const metaCandidates = [
      path.join(fromApp ? appDir : pkgDir, ...segs, 'page.meta.ts'),
      path.join(fromApp ? appDir : pkgDir, ...segs, 'meta.ts'),
    ]
    const metaPath = metaCandidates.find((p) => fs.existsSync(p))
    let metaExpr = 'undefined'
    if (metaPath) {
      const metaImportName = `${metaPrefix}${importIdRef.value++}_${toVar(modId)}_${toVar(segs.join('_') || 'index')}`
      const metaImportPath = `${fromApp ? appImportBase : pkgImportBase}/${type}/${[...segs, path.basename(metaPath).replace(/\.ts$/, '')].join('/')}`
      imports.push(`import * as ${metaImportName} from '${metaImportPath}'`)
      metaExpr = `(${metaImportName}.metadata as any)`
      imports.push(`import ${importName} from '${importPath}'`)
    } else {
      metaExpr = `(${pageModName} as any).metadata`
      imports.push(`import ${importName}, * as ${pageModName} from '${importPath}'`)
    }
    const baseProps = `pattern: '${routePath || '/'}', requireAuth: (${metaExpr})?.requireAuth, requireRoles: (${metaExpr})?.requireRoles, requireFeatures: (${metaExpr})?.requireFeatures, title: (${metaExpr})?.pageTitle ?? (${metaExpr})?.title, titleKey: (${metaExpr})?.pageTitleKey ?? (${metaExpr})?.titleKey, group: (${metaExpr})?.pageGroup ?? (${metaExpr})?.group, groupKey: (${metaExpr})?.pageGroupKey ?? (${metaExpr})?.groupKey, icon: (${metaExpr})?.icon, order: (${metaExpr})?.pageOrder ?? (${metaExpr})?.order, priority: (${metaExpr})?.pagePriority ?? (${metaExpr})?.priority, navHidden: (${metaExpr})?.navHidden, visible: (${metaExpr})?.visible, enabled: (${metaExpr})?.enabled, breadcrumb: (${metaExpr})?.breadcrumb`
    const extraProps = type === 'backend' ? `, pageContext: (${metaExpr})?.pageContext` : ''
    routes.push(`{ ${baseProps}${extraProps}, Component: ${importName} }`)
  }

  // Back-compat direct files (old-style pages like login.tsx instead of login/page.tsx)
  for (const { relPath, fromApp } of files.filter(({ relPath: f }) => !f.endsWith('/page.tsx') && f !== 'page.tsx')) {
    const segs = relPath.split('/')
    const file = segs.pop()!
    const name = file.replace(/\.tsx$/, '')
    const routeSegs = [...segs, name].filter(Boolean)
    const importName = `${prefix}${importIdRef.value++}_${toVar(modId)}_${toVar(routeSegs.join('_') || 'index')}`
    const pageModName = `${modPrefix}${importIdRef.value++}_${toVar(modId)}_${toVar(routeSegs.join('_') || 'index')}`
    const importPath = `${fromApp ? appImportBase : pkgImportBase}/${type}/${[...segs, name].join('/')}`
    const routePath = type === 'frontend'
      ? '/' + (routeSegs.join('/') || '')
      : '/backend/' + [modId, ...segs, name].filter(Boolean).join('/')
    const metaCandidates = [
      path.join(fromApp ? appDir : pkgDir, ...segs, `${name}.meta.ts`),
      path.join(fromApp ? appDir : pkgDir, ...segs, 'meta.ts'),
    ]
    const metaPath = metaCandidates.find((p) => fs.existsSync(p))
    let metaExpr = 'undefined'
    if (metaPath) {
      const metaImportName = `${metaPrefix}${importIdRef.value++}_${toVar(modId)}_${toVar(routeSegs.join('_') || 'index')}`
      const metaBase = path.basename(metaPath)
      const metaImportSub = metaBase === 'meta.ts' ? 'meta' : name + '.meta'
      const metaImportPath = `${fromApp ? appImportBase : pkgImportBase}/${type}/${[...segs, metaImportSub].join('/')}`
      imports.push(`import * as ${metaImportName} from '${metaImportPath}'`)
      metaExpr = type === 'frontend' ? `(${metaImportName}.metadata as any)` : `${metaImportName}.metadata`
      imports.push(`import ${importName} from '${importPath}'`)
    } else {
      metaExpr = `(${pageModName} as any).metadata`
      imports.push(`import ${importName}, * as ${pageModName} from '${importPath}'`)
    }
    const baseProps = `pattern: '${routePath || '/'}', requireAuth: (${metaExpr})?.requireAuth, requireRoles: (${metaExpr})?.requireRoles, requireFeatures: (${metaExpr})?.requireFeatures, title: (${metaExpr})?.pageTitle ?? (${metaExpr})?.title, titleKey: (${metaExpr})?.pageTitleKey ?? (${metaExpr})?.titleKey, group: (${metaExpr})?.pageGroup ?? (${metaExpr})?.group, groupKey: (${metaExpr})?.pageGroupKey ?? (${metaExpr})?.groupKey`
    const extraFe = type === 'frontend' ? `, visible: (${metaExpr})?.visible, enabled: (${metaExpr})?.enabled` : `, icon: (${metaExpr})?.icon, order: (${metaExpr})?.pageOrder ?? (${metaExpr})?.order, priority: (${metaExpr})?.pagePriority ?? (${metaExpr})?.priority, navHidden: (${metaExpr})?.navHidden, visible: (${metaExpr})?.visible, enabled: (${metaExpr})?.enabled, breadcrumb: (${metaExpr})?.breadcrumb, pageContext: (${metaExpr})?.pageContext`
    routes.push(`{ ${baseProps}${extraFe}, Component: ${importName} }`)
  }

  return routes
}

async function processApiRoutes(options: {
  roots: ModuleRoots
  modId: string
  appImportBase: string
  pkgImportBase: string
  imports: string[]
  importIdRef: { value: number }
}): Promise<string[]> {
  const { roots, modId, appImportBase, pkgImportBase, imports, importIdRef } = options
  const apiApp = path.join(roots.appBase, 'api')
  const apiPkg = path.join(roots.pkgBase, 'api')
  if (!fs.existsSync(apiApp) && !fs.existsSync(apiPkg)) return []

  const apis: string[] = []

  // route.ts aggregations
  const routeFiles = scanModuleDir(roots, SCAN_CONFIGS.apiRoutes)
  for (const { relPath, fromApp } of routeFiles) {
    const segs = relPath.split('/')
    segs.pop()
    const reqSegs = [modId, ...segs]
    const importName = `R${importIdRef.value++}_${toVar(modId)}_${toVar(segs.join('_') || 'index')}`
    const appFile = path.join(apiApp, ...segs, 'route.ts')
    const apiSegPath = segs.join('/')
    const importPath = `${fromApp ? appImportBase : pkgImportBase}/api${apiSegPath ? `/${apiSegPath}` : ''}/route`
    const routePath = '/' + reqSegs.filter(Boolean).join('/')
    const sourceFile = fromApp ? appFile : path.join(apiPkg, ...segs, 'route.ts')
    const hasOpenApi = await moduleHasExport(sourceFile, 'openApi')
    const docsPart = hasOpenApi ? `, docs: ${importName}.openApi` : ''
    imports.push(`import * as ${importName} from '${importPath}'`)
    apis.push(`{ path: '${routePath}', metadata: (${importName} as any).metadata, handlers: ${importName} as any${docsPart} }`)
  }

  // Single files (plain .ts, not route.ts, not tests, skip method dirs)
  const plainFiles = scanModuleDir(roots, SCAN_CONFIGS.apiPlainFiles)
  for (const { relPath, fromApp } of plainFiles) {
    const segs = relPath.split('/')
    const file = segs.pop()!
    const pathWithoutExt = file.replace(/\.ts$/, '')
    const fullSegs = [...segs, pathWithoutExt]
    const routePath = '/' + [modId, ...fullSegs].filter(Boolean).join('/')
    const importName = `R${importIdRef.value++}_${toVar(modId)}_${toVar(fullSegs.join('_') || 'index')}`
    const appFile = path.join(apiApp, ...fullSegs) + '.ts'
    const plainSegPath = fullSegs.join('/')
    const importPath = `${fromApp ? appImportBase : pkgImportBase}/api${plainSegPath ? `/${plainSegPath}` : ''}`
    const pkgFile = path.join(apiPkg, ...fullSegs) + '.ts'
    const sourceFile = fromApp ? appFile : pkgFile
    const hasOpenApi = await moduleHasExport(sourceFile, 'openApi')
    const docsPart = hasOpenApi ? `, docs: ${importName}.openApi` : ''
    imports.push(`import * as ${importName} from '${importPath}'`)
    apis.push(`{ path: '${routePath}', metadata: (${importName} as any).metadata, handlers: ${importName} as any${docsPart} }`)
  }

  // Legacy per-method
  const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  for (const method of methods) {
    const coreMethodDir = path.join(apiPkg, method.toLowerCase())
    const appMethodDir = path.join(apiApp, method.toLowerCase())
    const methodDir = fs.existsSync(appMethodDir) ? appMethodDir : coreMethodDir
    if (!fs.existsSync(methodDir)) continue
    const methodRoots: ModuleRoots = { appBase: methodDir, pkgBase: methodDir }
    const methodConfig = {
      folder: '',
      include: (name: string) => name.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(name),
    }
    const apiFiles = scanModuleDir(methodRoots, methodConfig)
    for (const { relPath } of apiFiles) {
      const segs = relPath.split('/')
      const file = segs.pop()!
      const pathWithoutExt = file.replace(/\.ts$/, '')
      const fullSegs = [...segs, pathWithoutExt]
      const routePath = '/' + [modId, ...fullSegs].filter(Boolean).join('/')
      const importName = `H${importIdRef.value++}_${toVar(modId)}_${toVar(method)}_${toVar(fullSegs.join('_'))}`
      const fromApp = methodDir === appMethodDir
      const importPath = `${fromApp ? appImportBase : pkgImportBase}/api/${method.toLowerCase()}/${fullSegs.join('/')}`
      const metaName = `RM${importIdRef.value++}_${toVar(modId)}_${toVar(method)}_${toVar(fullSegs.join('_'))}`
      const sourceFile = path.join(methodDir, ...segs, file)
      const hasOpenApi = await moduleHasExport(sourceFile, 'openApi')
      const docsPart = hasOpenApi ? `, docs: ${metaName}.openApi` : ''
      imports.push(`import ${importName}, * as ${metaName} from '${importPath}'`)
      apis.push(`{ method: '${method}', path: '${routePath}', handler: ${importName}, metadata: ${metaName}.metadata${docsPart} }`)
    }
  }

  return apis
}

function processSubscribers(options: {
  roots: ModuleRoots
  modId: string
  appImportBase: string
  pkgImportBase: string
  imports: string[]
  importIdRef: { value: number }
}): string[] {
  const { roots, modId, appImportBase, pkgImportBase, imports, importIdRef } = options
  const files = scanModuleDir(roots, SCAN_CONFIGS.subscribers)
  const subscribers: string[] = []
  for (const { relPath, fromApp } of files) {
    const segs = relPath.split('/')
    const file = segs.pop()!
    const name = file.replace(/\.ts$/, '')
    const importName = `Subscriber${importIdRef.value++}_${toVar(modId)}_${toVar([...segs, name].join('_') || 'index')}`
    const metaName = `SubscriberMeta${importIdRef.value++}_${toVar(modId)}_${toVar([...segs, name].join('_') || 'index')}`
    const importPath = `${fromApp ? appImportBase : pkgImportBase}/subscribers/${[...segs, name].join('/')}`
    imports.push(`import ${importName}, * as ${metaName} from '${importPath}'`)
    const sid = [modId, ...segs, name].filter(Boolean).join(':')
    subscribers.push(
      `{ id: (((${metaName}.metadata) as any)?.id || '${sid}'), event: ((${metaName}.metadata) as any)?.event, persistent: ((${metaName}.metadata) as any)?.persistent, handler: ${importName} }`
    )
  }
  return subscribers
}

async function processWorkers(options: {
  roots: ModuleRoots
  modId: string
  appImportBase: string
  pkgImportBase: string
  imports: string[]
  importIdRef: { value: number }
}): Promise<string[]> {
  const { roots, modId, appImportBase, pkgImportBase, imports, importIdRef } = options
  const files = scanModuleDir(roots, SCAN_CONFIGS.workers)
  const workers: string[] = []
  for (const { relPath, fromApp } of files) {
    const segs = relPath.split('/')
    const file = segs.pop()!
    const name = file.replace(/\.ts$/, '')
    const importPath = `${fromApp ? appImportBase : pkgImportBase}/workers/${[...segs, name].join('/')}`
    if (!(await moduleHasExport(importPath, 'metadata'))) continue
    const importName = `Worker${importIdRef.value++}_${toVar(modId)}_${toVar([...segs, name].join('_') || 'index')}`
    const metaName = `WorkerMeta${importIdRef.value++}_${toVar(modId)}_${toVar([...segs, name].join('_') || 'index')}`
    imports.push(`import ${importName}, * as ${metaName} from '${importPath}'`)
    const wid = [modId, 'workers', ...segs, name].filter(Boolean).join(':')
    workers.push(
      `{ id: (${metaName}.metadata as { id?: string })?.id || '${wid}', queue: (${metaName}.metadata as { queue: string }).queue, concurrency: (${metaName}.metadata as { concurrency?: number })?.concurrency ?? 1, handler: ${importName} as (job: unknown, ctx: unknown) => Promise<void> }`
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
}): string[] {
  const { roots, modId, appImportBase, pkgImportBase, imports } = options
  const i18nApp = path.join(roots.appBase, 'i18n')
  const i18nCore = path.join(roots.pkgBase, 'i18n')
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
      imports.push(`import ${cName} from '${pkgImportBase}/i18n/${locale}.json'`)
      imports.push(`import ${aName} from '${appImportBase}/i18n/${locale}.json'`)
      translations.push(
        `'${locale}': { ...( ${cName} as unknown as Record<string,string> ), ...( ${aName} as unknown as Record<string,string> ) }`
      )
    } else if (appHas) {
      const aName = `T_${toVar(modId)}_${toVar(locale)}_A`
      imports.push(`import ${aName} from '${appImportBase}/i18n/${locale}.json'`)
      translations.push(`'${locale}': ${aName} as unknown as Record<string,string>`)
    } else if (coreHas) {
      const cName = `T_${toVar(modId)}_${toVar(locale)}_C`
      imports.push(`import ${cName} from '${pkgImportBase}/i18n/${locale}.json'`)
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
  const importStmt = `import * as ${importName} from '${resolved.importPath}'`
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
  importStyle: 'namespace' | 'default' = 'namespace'
): { importName: string; importPath: string; fromApp: boolean } | null {
  const resolved = resolveModuleFile(roots, imps, relativePath)
  if (!resolved) return null
  const importName = `${prefix}_${toVar(modId)}_${importIdRef.value++}`
  if (importStyle === 'default') {
    imports.push(`import ${importName} from '${resolved.importPath}'`)
  } else {
    imports.push(`import * as ${importName} from '${resolved.importPath}'`)
  }
  return { importName, importPath: resolved.importPath, fromApp: resolved.fromApp }
}

export async function generateModuleRegistry(options: ModuleRegistryOptions): Promise<GeneratorResult> {
  const { resolver, quiet = false } = options
  const result = createGeneratorResult()

  const outputDir = resolver.getOutputDir()
  const outFile = path.join(outputDir, 'modules.generated.ts')
  const checksumFile = path.join(outputDir, 'modules.generated.checksum')
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

  const enabled = resolver.loadEnabledModules()
  const imports: string[] = []
  const moduleDecls: string[] = []
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

    // === Processing order MUST match original import ID sequence ===

    // 1. Module metadata: index.ts (overrideable)
    const appIndex = path.join(roots.appBase, 'index.ts')
    const pkgIndex = path.join(roots.pkgBase, 'index.ts')
    const indexTs = fs.existsSync(appIndex) ? appIndex : fs.existsSync(pkgIndex) ? pkgIndex : null
    if (indexTs) {
      infoImportName = `I${importIdRef.value++}_${toVar(modId)}`
      const importPath = indexTs.startsWith(roots.appBase) ? `${appImportBase}/index` : `${imps.pkgBase}/index`
      imports.push(`import * as ${infoImportName} from '${importPath}'`)
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(indexTs)
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
        frontendRoutes.push(...processPageFiles({
          files: feFiles,
          type: 'frontend',
          modId,
          appDir: feApp,
          pkgDir: fePkg,
          appImportBase,
          pkgImportBase: imps.pkgBase,
          imports,
          importIdRef,
        }))
      }
    }

    // 3. Entity extensions: data/extensions.ts
    {
      const ext = resolveConventionFile(roots, imps, 'data/extensions.ts', 'X', modId, importIdRef, imports)
      if (ext) extensionsImportName = ext.importName
    }

    // 4. RBAC: acl.ts
    {
      const rootApp = path.join(roots.appBase, 'acl.ts')
      const rootPkg = path.join(roots.pkgBase, 'acl.ts')
      const hasRoot = fs.existsSync(rootApp) || fs.existsSync(rootPkg)
      if (hasRoot) {
        const importName = `ACL_${toVar(modId)}_${importIdRef.value++}`
        const useApp = fs.existsSync(rootApp) ? rootApp : rootPkg
        const importPath = useApp.startsWith(roots.appBase) ? `${appImportBase}/acl` : `${imps.pkgBase}/acl`
        imports.push(`import * as ${importName} from '${importPath}'`)
        featuresImportName = importName
      }
    }

    // 5. Custom entities: ce.ts
    {
      const ce = resolveConventionFile(roots, imps, 'ce.ts', 'CE', modId, importIdRef, imports)
      if (ce) customEntitiesImportName = ce.importName
    }

    // 6. Search: search.ts
    {
      const resolved = resolveModuleFile(roots, imps, 'search.ts')
      if (resolved) {
        const importName = `SEARCH_${toVar(modId)}_${importIdRef.value++}`
        const importStmt = `import * as ${importName} from '${resolved.importPath}'`
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
    // Message types: module root message-types.ts
    {
      const resolved = resolveModuleFile(roots, imps, 'message-types.ts')
      if (resolved) {
        const importName = `MSG_TYPES_${toVar(modId)}_${importIdRef.value++}`
        const importStmt = `import * as ${importName} from '${resolved.importPath}'`
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
        const importStmt = `import * as ${importName} from '${resolved.importPath}'`
        messageObjectTypeImports.push(importStmt)
        messageObjectTypeEntries.push(
          `{ moduleId: '${modId}', types: ((${importName}.default ?? (${importName} as any).messageObjectTypes ?? (${importName} as any).objectTypes ?? (${importName} as any).types ?? []) as MessageObjectTypeDefinition[]) }`
        )
      }
    }

    // AI Tools: module root ai-tools.ts
    {
      const resolved = resolveModuleFile(roots, imps, 'notifications.client.ts')
      if (resolved) {
        const importName = `NOTIF_CLIENT_${toVar(modId)}_${importIdRef.value++}`
        const importStmt = `import * as ${importName} from '${resolved.importPath}'`
        notificationClientImports.push(importStmt)
        notificationClientTypes.push(
          `{ moduleId: '${modId}', types: (${importName}.default ?? []) }`
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

    // Inbox Actions: inbox-actions.ts
    {
      const resolved = resolveModuleFile(roots, imps, 'inbox-actions.ts')
      if (resolved) {
        const importName = `INBOX_ACTIONS_${toVar(modId)}_${importIdRef.value++}`
        const importStmt = `import * as ${importName} from '${resolved.importPath}'`
        inboxActionsImports.push(importStmt)
        inboxActionsConfigs.push(
          `{ moduleId: '${modId}', actions: (${importName}.default ?? ${importName}.inboxActions ?? []) }`
        )
      }
    }

    // 11. Setup: setup.ts
    {
      const setup = resolveConventionFile(roots, imps, 'setup.ts', 'SETUP', modId, importIdRef, imports)
      if (setup) setupImportName = setup.importName
    }

    // 12. Custom fields: data/fields.ts
    {
      const fields = resolveConventionFile(roots, imps, 'data/fields.ts', 'F', modId, importIdRef, imports)
      if (fields) fieldsImportName = fields.importName
    }

    // 13. Pages: backend
    {
      const beApp = path.join(roots.appBase, 'backend')
      const bePkg = path.join(roots.pkgBase, 'backend')
      const beFiles = scanModuleDir(roots, SCAN_CONFIGS.backendPages)
      if (beFiles.length) {
        backendRoutes.push(...processPageFiles({
          files: beFiles,
          type: 'backend',
          modId,
          appDir: beApp,
          pkgDir: bePkg,
          appImportBase,
          pkgImportBase: imps.pkgBase,
          imports,
          importIdRef,
        }))
      }
    }

    // 14. API routes
    apis.push(...await processApiRoutes({
      roots,
      modId,
      appImportBase,
      pkgImportBase: imps.pkgBase,
      imports,
      importIdRef,
    }))

    // 15. CLI
    {
      const cliApp = path.join(roots.appBase, 'cli.ts')
      const cliPkg = path.join(roots.pkgBase, 'cli.ts')
      const cliPath = fs.existsSync(cliApp) ? cliApp : fs.existsSync(cliPkg) ? cliPkg : null
      if (cliPath) {
        const importName = `CLI_${toVar(modId)}`
        const importPath = cliPath.startsWith(roots.appBase) ? `${appImportBase}/cli` : `${imps.pkgBase}/cli`
        imports.push(`import ${importName} from '${importPath}'`)
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
    }))

    // 17. Subscribers
    subscribers.push(...processSubscribers({
      roots,
      modId,
      appImportBase,
      pkgImportBase: imps.pkgBase,
      imports,
      importIdRef,
    }))

    // 18. Workers
    workers.push(...await processWorkers({
      roots,
      modId,
      appImportBase,
      pkgImportBase: imps.pkgBase,
      imports,
      importIdRef,
    }))

    // Build combined customFieldSets expression
    {
      const parts: string[] = []
      if (fieldsImportName)
        parts.push(`(( ${fieldsImportName}.default ?? ${fieldsImportName}.fieldSets) as any) || []`)
      if (customEntitiesImportName)
        parts.push(
          `((( ${customEntitiesImportName}.default ?? ${customEntitiesImportName}.entities) as any) || []).filter((e: any) => Array.isArray(e.fields) && e.fields.length).map((e: any) => ({ entity: e.id, fields: e.fields, source: '${modId}' }))`
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
          `{ moduleId: '${entry.moduleId}', key: '${entry.key}', source: '${entry.source}', loader: () => import('${entry.importPath}').then((mod) => mod.default ?? mod) }`
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
        const importPath = `${fromApp ? appImportBase : imps.pkgBase}/widgets/injection/${[...segs, base].join('/')}`
        const key = [modId, ...segs, base].filter(Boolean).join(':')
        const source = fromApp ? 'app' : 'package'
        injectionWidgets.push(
          `{ moduleId: '${modId}', key: '${key}', source: '${source}', loader: () => import('${importPath}').then((mod) => mod.default ?? mod) }`
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
        imports.push(`import * as ${importName} from '${resolved.importPath}'`)
        injectionTableImportName = importName
        allInjectionTables.push({ moduleId: modId, importPath: resolved.importPath, importName })
      }
    }

    if (searchImportName) {
      searchConfigs.push(`{ moduleId: '${modId}', config: (${searchImportName}.default ?? ${searchImportName}.searchConfig ?? ${searchImportName}.config ?? null) }`)
    }

    // Note: events, analytics, enrichers, notifications, AI tools, and translatable fields
    // configs are pushed inside processStandaloneConfig() above — no separate push needed here.

    if (transFieldsImportName) {
      transFieldsConfigs.push(`{ moduleId: '${modId}', fields: (${transFieldsImportName}.default ?? ${transFieldsImportName}.translatableFields ?? {}) as Record<string, string[]> }`)
    }

    moduleDecls.push(`{
      id: '${modId}',
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
    }`)
  }

  const output = `// AUTO-GENERATED by mercato generate registry
import type { Module } from '@open-mercato/shared/modules/registry'
${imports.join('\n')}

export const modules: Module[] = [
  ${moduleDecls.join(',\n  ')}
]
export const modulesInfo = modules.map(m => ({ id: m.id, ...(m.info || {}) }))
export default modules
`
  const widgetEntriesList = Array.from(allDashboardWidgets.entries()).sort(([a], [b]) => a.localeCompare(b))
  const widgetDecls = widgetEntriesList.map(
    ([key, data]) =>
      `  { moduleId: '${data.moduleId}', key: '${key}', source: '${data.source}', loader: () => import('${data.importPath}').then((mod) => mod.default ?? mod) }`
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
  writeGeneratedFile({ outFile: widgetsOutFile, checksumFile: widgetsChecksumFile, content: widgetsOutput, structureChecksum, result, quiet })

  const injectionWidgetEntriesList = Array.from(allInjectionWidgets.entries()).sort(([a], [b]) => a.localeCompare(b))
  const injectionWidgetDecls = injectionWidgetEntriesList.map(
    ([key, data]) =>
      `  { moduleId: '${data.moduleId}', key: '${key}', source: '${data.source}', loader: () => import('${data.importPath}').then((mod) => mod.default ?? mod) }`
  )
  const injectionWidgetsOutput = `// AUTO-GENERATED by mercato generate registry
import type { ModuleInjectionWidgetEntry } from '@open-mercato/shared/modules/registry'

export const injectionWidgetEntries: ModuleInjectionWidgetEntry[] = [
${injectionWidgetDecls.join(',\n')}
]
`
  const injectionTableImports = allInjectionTables.map(
    (entry) => `import * as ${entry.importName} from '${entry.importPath}'`
  )
  const injectionTableDecls = allInjectionTables.map(
    (entry) =>
      `  { moduleId: '${entry.moduleId}', table: ((${entry.importName}.default ?? ${entry.importName}.injectionTable) as any) || {} }`
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

export const aiToolConfigEntries: AiToolConfigEntry[] = [
${aiToolsConfigs.length ? '  ' + aiToolsConfigs.join(',\n  ') + '\n' : ''}].filter(e => Array.isArray(e.tools) && e.tools.length > 0)

export const allAiTools = aiToolConfigEntries.flatMap(e => e.tools)
`
  writeGeneratedFile({ outFile: aiToolsOutFile, checksumFile: aiToolsChecksumFile, content: aiToolsOutput, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: notificationsOutFile, checksumFile: notificationsChecksumFile, content: notificationsOutput, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: notificationsClientOutFile, checksumFile: notificationsClientChecksumFile, content: notificationsClientOutput, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: messageTypesOutFile, checksumFile: messageTypesChecksumFile, content: messageTypesOutput, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: messageObjectsOutFile, checksumFile: messageObjectsChecksumFile, content: messageObjectsOutput, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: messagesClientOutFile, checksumFile: messagesClientChecksumFile, content: messagesClientOutput, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: eventsOutFile, checksumFile: eventsChecksumFile, content: eventsOutput, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: analyticsOutFile, checksumFile: analyticsChecksumFile, content: analyticsOutput, structureChecksum, result, quiet })
  writeGeneratedFile({ outFile: transFieldsOutFile, checksumFile: transFieldsChecksumFile, content: transFieldsOutput, structureChecksum, result, quiet })

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
    let customFieldSetsExpr: string = '[]'

    // Module metadata: index.ts (overrideable)
    const appIndex = path.join(roots.appBase, 'index.ts')
    const pkgIndex = path.join(roots.pkgBase, 'index.ts')
    const indexTs = fs.existsSync(appIndex) ? appIndex : fs.existsSync(pkgIndex) ? pkgIndex : null
    if (indexTs) {
      infoImportName = `I${importIdRef.value++}_${toVar(modId)}`
      const importPath = indexTs.startsWith(roots.appBase) ? `${appImportBase}/index` : `${imps.pkgBase}/index`
      imports.push(`import * as ${infoImportName} from '${importPath}'`)
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(indexTs)
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

    // Entity extensions: data/extensions.ts
    {
      const ext = resolveConventionFile(roots, imps, 'data/extensions.ts', 'X', modId, importIdRef, imports)
      if (ext) extensionsImportName = ext.importName
    }

    // RBAC: acl.ts
    {
      const rootApp = path.join(roots.appBase, 'acl.ts')
      const rootPkg = path.join(roots.pkgBase, 'acl.ts')
      const hasRoot = fs.existsSync(rootApp) || fs.existsSync(rootPkg)
      if (hasRoot) {
        const importName = `ACL_${toVar(modId)}_${importIdRef.value++}`
        const useApp = fs.existsSync(rootApp) ? rootApp : rootPkg
        const importPath = useApp.startsWith(roots.appBase) ? `${appImportBase}/acl` : `${imps.pkgBase}/acl`
        imports.push(`import * as ${importName} from '${importPath}'`)
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
      const cliApp = path.join(roots.appBase, 'cli.ts')
      const cliPkg = path.join(roots.pkgBase, 'cli.ts')
      const cliPath = fs.existsSync(cliApp) ? cliApp : fs.existsSync(cliPkg) ? cliPkg : null
      if (cliPath) {
        const importName = `CLI_${toVar(modId)}`
        const importPath = cliPath.startsWith(roots.appBase) ? `${appImportBase}/cli` : `${imps.pkgBase}/cli`
        imports.push(`import ${importName} from '${importPath}'`)
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
    subscribers.push(...processSubscribers({
      roots,
      modId,
      appImportBase,
      pkgImportBase: imps.pkgBase,
      imports,
      importIdRef,
    }))

    // Workers
    workers.push(...await processWorkers({
      roots,
      modId,
      appImportBase,
      pkgImportBase: imps.pkgBase,
      imports,
      importIdRef,
    }))

    // Build combined customFieldSets expression
    {
      const parts: string[] = []
      if (fieldsImportName)
        parts.push(`(( ${fieldsImportName}.default ?? ${fieldsImportName}.fieldSets) as any) || []`)
      if (customEntitiesImportName)
        parts.push(
          `((( ${customEntitiesImportName}.default ?? ${customEntitiesImportName}.entities) as any) || []).filter((e: any) => Array.isArray(e.fields) && e.fields.length).map((e: any) => ({ entity: e.id, fields: e.fields, source: '${modId}' }))`
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
          `{ moduleId: '${entry.moduleId}', key: '${entry.key}', source: '${entry.source}', loader: () => import('${entry.importPath}').then((mod) => mod.default ?? mod) }`
        )
      }
    }

    moduleDecls.push(`{
      id: '${modId}',
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
    }`)
  }

  const output = `// AUTO-GENERATED by mercato generate registry (CLI version)
// This file excludes Next.js dependent code (routes, APIs, injection widgets)
import type { Module } from '@open-mercato/shared/modules/registry'
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
