import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript-js'
import {
  MODULE_CODE_EXTENSIONS,
  SCAN_CONFIGS,
  resolveModuleFile,
  resolveStandaloneSourceMirrorBase,
  scanModuleDir,
  stripModuleCodeExtension,
  type ModuleRoots,
  type ScanConfig,
  type ScannedFile,
} from './generators/scanner'
import type {
  GenerateWatchCategory, GenerateWatchChange, GenerateWatchRecord, GenerateWatchSnapshot,
} from './generate-watch-plan'

type InputKind = { category: GenerateWatchCategory; extensionId?: string }
type WatchRoots = ModuleRoots & { moduleId?: string; from?: string }
export type GenerateWatchStructureOptions = {
  modulesFile: string
  moduleRoots: WatchRoots[]
  additionalInputs?: string[]
}

const REGISTRY_CONVENTIONS = [
  'index', 'acl', 'setup', 'runtime', 'encryption', 'ce', 'integration', 'vector',
  'data/extensions', 'data/fields',
]
const EXTENSION_CONVENTIONS: Readonly<Record<string, string>> = {
  notifications: 'registry.notifications',
  'notifications.client': 'registry.notifications',
  'notifications.handlers': 'registry.notifications',
  'message-types': 'registry.messages',
  'message-objects': 'registry.messages',
  'ai-tools': 'registry.ai-tools',
  'ai-agents': 'registry.ai-agents',
  analytics: 'registry.analytics',
  translations: 'registry.translatable-fields',
  workflows: 'registry.workflows',
  'inbox-actions': 'registry.inbox-actions',
  'data/enrichers': 'registry.enrichers',
  'data/guards': 'registry.guards',
  'api/interceptors': 'registry.interceptors',
  'commands/interceptors': 'registry.command-interceptors',
  'widgets/components': 'registry.component-overrides',
  'frontend/middleware': 'registry.page-middleware',
  'backend/middleware': 'registry.page-middleware',
}

// These two policies mirror the registry's command/legacy-API scans; all other
// directory discovery is shared with the generator through SCAN_CONFIGS.
const COMMAND_SCAN_CONFIG: ScanConfig = {
  folder: 'commands',
  include: (name) => MODULE_CODE_EXTENSIONS.some((extension) => name.endsWith(extension))
    && !name.endsWith('.d.ts') && !/\.(test|spec)\.[jt]sx?$/.test(name)
    && !['index', 'shared', 'factory'].includes(stripModuleCodeExtension(name)),
}
const LEGACY_API_SCAN_CONFIGS: ScanConfig[] = ['get', 'post', 'put', 'patch', 'delete'].map((method) => ({
  folder: `api/${method}`,
  include: (name) => /\.[jt]s$/.test(name) && !/\.(test|spec)\.[jt]s$/.test(name),
}))

function checksum(value: string): string {
  return crypto.createHash('md5').update(value).digest('hex')
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}

function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
    || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression
  return node
}

/** Read only static declaration data; never execute a plugin to watch it. */
function pluginConventions(file: ts.SourceFile): string[] | null {
  const declarations = new Map<string, ts.Expression>()
  let exported: ts.Expression | undefined
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          declarations.set(declaration.name.text, declaration.initializer)
          if (declaration.name.text === 'generatorPlugins'
            && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
            exported = declaration.initializer
          }
        }
      }
    } else if (ts.isExportAssignment(statement)) {
      exported ??= statement.expression
    } else if (ts.isImportDeclaration(statement)) {
      if (!statement.importClause?.isTypeOnly) return null
    } else if (!ts.isFunctionDeclaration(statement) && !ts.isInterfaceDeclaration(statement)
      && !ts.isTypeAliasDeclaration(statement) && !ts.isEmptyStatement(statement)) return null
  }
  if (!exported) return null
  const resolve = (expression: ts.Expression, seen = new Set<string>()): ts.Expression | null => {
    const node = unwrap(expression)
    if (!ts.isIdentifier(node)) return node
    if (seen.has(node.text)) return null
    seen.add(node.text)
    const value = declarations.get(node.text)
    return value ? resolve(value, seen) : null
  }
  const plugins = resolve(exported)
  if (!plugins || !ts.isArrayLiteralExpression(plugins)) return null
  const conventions: string[] = []
  for (const element of plugins.elements) {
    const plugin = resolve(element)
    if (!plugin || !ts.isObjectLiteralExpression(plugin)) return null
    let convention: string | undefined
    for (const property of plugin.properties) {
      if (ts.isSpreadAssignment(property) || ts.isComputedPropertyName(property.name)) return null
      if (property.name.getText(file).replace(/^['"]|['"]$/g, '') !== 'conventionFile') continue
      const value = ts.isPropertyAssignment(property) ? resolve(property.initializer) : null
      if (!value || !ts.isStringLiteralLike(value)) return null
      convention = value.text
    }
    if (!convention) return null
    conventions.push(convention)
  }
  return conventions
}

class SnapshotCollector {
  readonly records = new Map<string, GenerateWatchRecord>()
  readonly fullReasons = new Set<string>()
  private readonly contents = new Map<string, string | null>()
  private readonly stats = new Map<string, fs.Stats | null>()
  private readonly parsedFiles = new Map<string, ts.SourceFile>()
  readonly uncertainDependencies = new Set<string>()
  readonly uncertainPluginDescriptors = new Set<string>()
  private readonly dependencySeeds = new Set<string>()

  stat(file: string): fs.Stats | null {
    if (this.stats.has(file)) return this.stats.get(file) ?? null
    try {
      const stat = fs.statSync(file)
      this.stats.set(file, stat)
      return stat
    } catch (error) {
      if (!isMissing(error)) this.fullReasons.add(`Cannot inspect generator input: ${file}`)
      this.stats.set(file, null)
      return null
    }
  }

  read(file: string): string | null {
    if (this.contents.has(file)) return this.contents.get(file) ?? null
    let source: string | null = null
    try {
      source = fs.readFileSync(file, 'utf8')
    } catch {
      this.fullReasons.add(`Cannot read generator input: ${file}`)
    }
    this.contents.set(file, source)
    return source
  }

  parse(file: string, source: string): ts.SourceFile {
    const cached = this.parsedFiles.get(file)
    if (cached) return cached
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    const diagnostics = (parsed as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics
    if (diagnostics?.length) this.fullReasons.add(`Cannot parse generator input: ${file}`)
    this.parsedFiles.set(file, parsed)
    return parsed
  }

  record(key: string, file: string, kind: InputKind, fingerprint: string): void {
    this.records.set(key, { key, path: file, ...kind, fingerprint })
  }

  file(key: string, file: string, kind: InputKind, mode: 'content' | 'page' | 'membership' = 'content'): void {
    if (!this.stat(file)?.isFile()) return
    if (mode === 'membership') {
      this.record(key, file, kind, 'present')
      return
    }
    const source = this.read(file)
    if (source === null) {
      this.record(key, file, kind, 'unreadable')
      return
    }
    if (mode === 'page') {
      const parsed = this.parse(file, source)
      const metadata = parsed.statements.some((statement) => {
        if (ts.isExportDeclaration(statement)) {
          return !statement.exportClause || (ts.isNamedExports(statement.exportClause)
            && statement.exportClause.elements.some((element) => element.name.text === 'metadata'))
        }
        if (!ts.canHaveModifiers(statement)
          || !ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) return false
        if (ts.isVariableStatement(statement)) {
          return statement.declarationList.declarations.some((declaration) => /\bmetadata\b/.test(declaration.name.getText(parsed)))
        }
        return (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === 'metadata'
      })
      if (!metadata) {
        const hasDefault = parsed.statements.some((statement) =>
          (ts.isExportAssignment(statement) && !statement.isExportEquals)
          || (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword))
          || (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)
            && statement.exportClause.elements.some((element) => element.name.text === 'default')),
        )
        this.record(key, file, kind, `page:default:${hasDefault}`)
        return
      }
    }
    this.record(key, file, kind, checksum(source))
    if (/\.[cm]?[jt]sx?$/.test(file)) {
      this.dependencySeeds.add(file)
    }
  }

  codeFile(base: string, relativePath: string): string | null {
    const stripped = stripModuleCodeExtension(relativePath)
    const candidates = [relativePath, ...MODULE_CODE_EXTENSIONS.map((extension) => `${stripped}${extension}`)]
    for (const candidate of candidates) {
      const file = path.join(base, candidate)
      if (this.stat(file)?.isFile()) return file
    }
    return null
  }

  scan(roots: ModuleRoots, config: ScanConfig): ScannedFile[] {
    try {
      return scanModuleDir(roots, config)
    } catch {
      this.fullReasons.add(`Cannot scan generator inputs: ${roots.appBase}, ${roots.pkgBase}/${config.folder}`)
      return []
    }
  }

  entries(directory: string): fs.Dirent[] {
    if (!this.stat(directory)?.isDirectory()) return []
    try {
      return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      this.fullReasons.add(`Cannot scan generator inputs: ${directory}`)
      return []
    }
  }

  pair(identity: string, roots: ModuleRoots, relativePath: string, kind: InputKind, mode: 'content' | 'page' = 'content'): string[] {
    const sourceBase = resolveStandaloneSourceMirrorBase(roots.pkgBase) ?? roots.pkgBase
    const app = this.codeFile(roots.appBase, relativePath)
    const source = app ?? this.codeFile(sourceBase, relativePath)
    if (!source) return []
    const logical = stripModuleCodeExtension(relativePath).replace(/\\/g, '/')
    const key = `${identity}:${kind.category}:${kind.extensionId ?? ''}:${logical}`
    this.file(`${key}:source`, source, kind, mode)
    const resolved = resolveModuleFile(roots, { appBase: roots.appBase, pkgBase: roots.pkgBase }, relativePath)
    const runtime = resolved?.absolutePath
    if (runtime && runtime !== source) this.file(`${key}:runtime`, runtime, kind, mode)
    // Physical ownership is part of the fingerprint even for identical bytes.
    this.record(`${key}:authority`, source, kind, JSON.stringify([source, runtime ?? null]))
    return runtime && runtime !== source ? [source, runtime] : [source]
  }

  tree(identity: string, directory: string, kind: InputKind, skipTests = true): void {
    for (const entry of this.entries(directory)) {
      if (skipTests && (entry.name === '__tests__' || entry.name === '__mocks__')) continue
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) this.tree(identity, file, kind, skipTests)
      else if (entry.isFile()) this.file(`${identity}:${file}`, file, kind)
    }
  }

  supervisor(appSource: string): void {
    const pending = [appSource]
    let found = false
    while (pending.length > 0 && !found) {
      const directory = pending.pop()!
      for (const entry of this.entries(directory)) {
        const file = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__' && entry.name !== 'node_modules') pending.push(file)
          continue
        }
        if (!/\.[cm]?tsx?$/.test(entry.name) || /(?:^|\.)test\.[cm]?tsx?$/.test(entry.name)) continue
        const source = this.read(file)
        if (!source?.includes('@open-mercato/shared/modules/overrides')) continue
        const parsed = this.parse(file, source)
        const direct = new Set<string>()
        const namespaces = new Set<string>()
        for (const statement of parsed.statements) {
          if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)
            || statement.moduleSpecifier.text !== '@open-mercato/shared/modules/overrides') continue
          const bindings = statement.importClause?.namedBindings
          if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
          if (bindings && ts.isNamedImports(bindings)) {
            for (const element of bindings.elements) {
              if (['applyWorkerOverrides', 'applyCliOverrides'].includes(element.propertyName?.text ?? element.name.text)) {
                direct.add(element.name.text)
              }
            }
          }
        }
        const visit = (node: ts.Node): void => {
          if (ts.isCallExpression(node)) {
            const expression = node.expression
            if (ts.isIdentifier(expression) && direct.has(expression.text)) found = true
            if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)
              && namespaces.has(expression.expression.text)
              && ['applyWorkerOverrides', 'applyCliOverrides'].includes(expression.name.text)) found = true
          }
          if (!found) ts.forEachChild(node, visit)
        }
        visit(parsed)
        if (found) break
      }
    }
    this.record('supervisor-overrides', appSource, { category: 'registry-convention', extensionId: 'supervisor' }, String(found))
  }

  dependencies(appSource: string): void {
    const visited = new Set<string>()
    const pending = [...this.dependencySeeds]
    while (pending.length > 0) {
      const file = pending.pop()!
      if (visited.has(file)) continue
      visited.add(file)
      const source = this.read(file)
      if (source === null) continue
      const parsed = this.parse(file, source)
      const imports: string[] = []
      const visit = (node: ts.Node): void => {
        // Handler/component bodies are not evaluated to discover registrations.
        // Static imports are still tracked, including imports used by metadata.
        if (ts.isFunctionLike(node)) return
        if (ts.isImportDeclaration(node)) {
          if (node.importClause?.isTypeOnly) return
          const bindings = node.importClause?.namedBindings
          if (!node.importClause?.name && bindings && ts.isNamedImports(bindings)
            && bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly)) return
          if (ts.isStringLiteralLike(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text)
          return
        }
        if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier
          && ts.isStringLiteralLike(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text)
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
          || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
          const argument = node.arguments[0]
          if (argument && ts.isStringLiteralLike(argument)) imports.push(argument.text)
          else this.uncertainDependencies.add(file)
        }
        ts.forEachChild(node, visit)
      }
      visit(parsed)
      for (const specifier of imports) {
        if (!specifier.startsWith('.') && !specifier.startsWith('@/')) continue
        const target = specifier.startsWith('@/')
          ? path.join(appSource, specifier.slice(2)) : path.resolve(path.dirname(file), specifier)
        const resolved = this.codeFile(path.dirname(target), path.basename(target))
          ?? this.codeFile(target, 'index')
        const dependencyKey = `dependency:${file}:${target}`
        if (!resolved) {
          // Keep an absence record so a newly supplied helper invalidates the plan.
          this.record(dependencyKey, target, { category: 'unknown' }, 'missing')
          continue
        }
        // A generator's own outputs must not feed back into its watcher baseline.
        if (resolved.includes(`${path.sep}.mercato${path.sep}`) || resolved.includes(`${path.sep}generated${path.sep}`)) continue
        const text = this.read(resolved)
        this.record(dependencyKey, resolved, { category: 'unknown' }, `${resolved}:${text === null ? 'unreadable' : checksum(text)}`)
        if (/\.[cm]?[jt]sx?$/.test(resolved)) pending.push(resolved)
      }
    }
  }
}

function addModule(collector: SnapshotCollector, roots: WatchRoots, index: number, plugins: Set<string>): void {
  const distMarker = `${path.sep}dist${path.sep}modules${path.sep}`
  const distIndex = roots.pkgBase.lastIndexOf(distMarker)
  if (distIndex >= 0) {
    const packageRoot = roots.pkgBase.slice(0, distIndex)
    collector.stat(path.join(packageRoot, 'src', 'modules', roots.pkgBase.slice(distIndex + distMarker.length)))
  }
  const sourceBase = resolveStandaloneSourceMirrorBase(roots.pkgBase) ?? roots.pkgBase
  const identity = `module:${index}:${roots.moduleId ?? path.basename(roots.appBase)}:${roots.appBase}:${roots.pkgBase}`
  collector.record(`${identity}:roots`, roots.appBase, { category: 'configuration' }, JSON.stringify([
    Object.entries(roots).sort(([left], [right]) => left.localeCompare(right)), sourceBase,
    collector.stat(roots.appBase)?.isDirectory() ?? false, collector.stat(roots.pkgBase)?.isDirectory() ?? false,
  ]))
  const convention = (relativePath: string, kind: InputKind) => collector.pair(identity, roots, `${relativePath}.ts`, kind)
  for (const relativePath of REGISTRY_CONVENTIONS) convention(relativePath, { category: 'registry-convention' })
  for (const [relativePath, extensionId] of Object.entries(EXTENSION_CONVENTIONS)) {
    convention(relativePath, { category: 'extension', extensionId })
  }
  collector.pair(identity, roots, 'widgets/payments/client.tsx', { category: 'extension', extensionId: 'registry.notifications' })
  for (const category of ['cli', 'di', 'search', 'events'] as const) convention(category, { category })
  convention('widgets/injection-table', { category: 'injection-widgets' })
  for (const descriptor of convention('generators', { category: 'generator-plugin' })) {
    const source = collector.read(descriptor)
    const discovered = source === null ? null : pluginConventions(collector.parse(descriptor, source))
    if (discovered === null) collector.uncertainPluginDescriptors.add(descriptor)
    else for (const file of discovered) plugins.add(file)
  }

  // Entity generators use direct app/package candidates, including legacy db and
  // override/schema fallbacks, rather than resolveModuleFile's source authority.
  for (const base of new Set([roots.appBase, roots.pkgBase, sourceBase])) {
    for (const directory of ['data', 'db']) {
      for (const stem of ['entities.override', 'entities', 'schema']) {
        for (const extension of MODULE_CODE_EXTENSIONS) {
          const file = path.join(base, directory, `${stem}${extension}`)
          collector.file(`${identity}:entities:${file}`, file, { category: 'entities' })
        }
      }
    }
  }
  if (distIndex >= 0) {
    const packageRoot = roots.pkgBase.slice(0, distIndex)
    const direct = path.join(packageRoot, 'generated')
    collector.record(`${identity}:package-entities-direct-root`, direct, { category: 'entities' },
      collector.stat(direct)?.isDirectory() ? 'directory' : 'missing')
    const generated = collector.stat(direct)?.isDirectory() ? direct : path.join(packageRoot, 'dist', 'generated')
    collector.record(`${identity}:package-entities-root`, generated, { category: 'entities' }, generated)
    for (const extension of ['.ts', '.js']) {
      const ids = path.join(generated, `entities.ids.generated${extension}`)
      collector.file(`${identity}:package-entities:${ids}`, ids, { category: 'entities' })
      for (const entry of collector.entries(path.join(generated, 'entities'))) {
        if (!entry.isDirectory()) continue
        const fields = path.join(generated, 'entities', entry.name, `index${extension}`)
        collector.file(`${identity}:package-entities:${fields}`, fields, { category: 'entities' })
      }
    }
  }
  const scans: Array<[ScanConfig, GenerateWatchCategory]> = [
    [SCAN_CONFIGS.apiRoutes, 'api-route'], [SCAN_CONFIGS.apiPlainFiles, 'api-route'],
    ...LEGACY_API_SCAN_CONFIGS.map((config): [ScanConfig, GenerateWatchCategory] => [config, 'api-route']),
    [COMMAND_SCAN_CONFIG, 'commands'], [SCAN_CONFIGS.subscribers, 'subscribers'],
    [SCAN_CONFIGS.workers, 'workers'], [SCAN_CONFIGS.dashboardWidgets, 'dashboard-widgets'],
    [SCAN_CONFIGS.injectionWidgets, 'injection-widgets'],
    [SCAN_CONFIGS.frontendPages, 'frontend-page'], [SCAN_CONFIGS.backendPages, 'backend-page'],
  ]
  for (const [config, category] of scans) {
    for (const scanned of collector.scan(roots, config)) {
      const relativePath = `${config.folder}/${scanned.relPath}`
      // Exact conventions in route/page directories are not route registrations.
      if (EXTENSION_CONVENTIONS[stripModuleCodeExtension(relativePath)]) continue
      const page = category === 'frontend-page' || category === 'backend-page'
      const files = collector.pair(identity, roots, relativePath, { category }, page ? 'page' : 'content')
      if (!page) continue
      for (const file of files) {
        const stem = stripModuleCodeExtension(path.basename(file))
        for (const candidate of [stem === 'page' ? 'page.meta' : `${stem}.meta`, 'meta']) {
          const metadata = collector.codeFile(path.dirname(file), candidate)
          if (metadata) collector.file(`${identity}:${category}:metadata:${metadata}`, metadata, { category })
        }
      }
    }
  }
  for (const base of new Set([sourceBase, roots.appBase])) {
    const directory = path.join(base, 'i18n')
    for (const entry of collector.entries(directory)) {
      if (!entry.isFile() || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.json$/.test(entry.name)) continue
      const file = path.join(directory, entry.name)
      collector.file(`${identity}:i18n:${file}`, file, { category: 'i18n' }, 'membership')
      if (base === sourceBase && sourceBase !== roots.pkgBase) {
        const runtime = path.join(roots.pkgBase, 'i18n', entry.name)
        collector.file(`${identity}:i18n:runtime:${runtime}`, runtime, { category: 'i18n' }, 'membership')
      }
    }
    collector.tree(`${identity}:agents`, path.join(base, 'agents'), { category: 'extension', extensionId: 'registry.agent-files' })
  }
}

export function collectGenerateWatchStructureSnapshot(options: GenerateWatchStructureOptions): GenerateWatchSnapshot {
  const collector = new SnapshotCollector()
  collector.file(`configuration:${options.modulesFile}`, options.modulesFile, { category: 'configuration' })
  const plugins = new Set<string>()
  options.moduleRoots.forEach((roots, index) => addModule(collector, roots, index, plugins))
  options.moduleRoots.forEach((roots, index) => {
    const identity = `module:${index}:${roots.moduleId ?? path.basename(roots.appBase)}:${roots.appBase}:${roots.pkgBase}`
    for (const relativePath of plugins) collector.pair(identity, roots, relativePath, { category: 'generator-plugin' })
  })
  const knownInputs = new Map<string, GenerateWatchRecord>()
  for (const record of collector.records.values()) {
    if (record.category !== 'configuration') knownInputs.set(record.path, record)
  }
  for (const input of [...new Set(options.additionalInputs ?? [])].sort()) {
    const known = knownInputs.get(input)
    if (known) {
      if (known.category !== 'api-route') {
        collector.file(`additional-input:${input}`, input, { category: known.category, extensionId: known.extensionId })
      }
      continue
    }
    const stat = collector.stat(input)
    if (stat?.isFile()) collector.file(`configuration:${input}`, input, { category: 'configuration' })
    else collector.record(`configuration:${input}`, input, { category: 'configuration' }, stat?.isDirectory() ? 'directory' : 'missing')
  }
  collector.supervisor(path.dirname(options.modulesFile))
  collector.dependencies(path.dirname(options.modulesFile))
  // A dynamic descriptor is valid source, not a transient failed capture. Until
  // its dependencies can be proven, watch all potential module contributions.
  // Changes require a full suite, but an unchanged successful baseline is clean.
  if (collector.uncertainPluginDescriptors.size > 0 || collector.uncertainDependencies.size > 0) {
    const category = collector.uncertainPluginDescriptors.size > 0 ? 'generator-plugin' : 'unknown'
    for (const roots of options.moduleRoots) {
      for (const base of new Set([roots.appBase, roots.pkgBase, resolveStandaloneSourceMirrorBase(roots.pkgBase)])) {
        if (base) collector.tree(`uncertain-dependencies:${base}`, base, { category }, false)
      }
    }
    for (const descriptor of collector.uncertainPluginDescriptors) {
      collector.record(`uncertain-plugin:${descriptor}`, descriptor, { category: 'generator-plugin' }, 'unresolved-conventions')
    }
    for (const dependency of collector.uncertainDependencies) {
      collector.record(`uncertain-dependency:${dependency}`, dependency, { category: 'unknown' }, 'unresolved-import')
    }
  }
  const records = new Map([...collector.records].sort(([left], [right]) => left.localeCompare(right)))
  const fullReasons = [...collector.fullReasons].sort()
  return {
    checksum: checksum(JSON.stringify([[...records.values()], fullReasons])),
    records,
    fullReasons,
  }
}

export function diffGenerateWatchStructureSnapshots(
  previous: GenerateWatchSnapshot,
  next: GenerateWatchSnapshot,
): GenerateWatchChange[] {
  const changes: GenerateWatchChange[] = []
  for (const key of [...new Set([...previous.records.keys(), ...next.records.keys()])].sort()) {
    const before = previous.records.get(key)
    const after = next.records.get(key)
    if (before && after && before.fingerprint === after.fingerprint && before.path === after.path
      && before.category === after.category && before.extensionId === after.extensionId) continue
    const record = after ?? before!
    changes.push({
      key, kind: !before ? 'add' : !after ? 'delete' : 'change',
      category: record.category, path: record.path,
      ...(record.extensionId ? { extensionId: record.extensionId } : {}),
    })
  }
  return changes
}

/** Legacy callers intentionally receive only the opaque snapshot checksum. */
export function calculateGenerateWatchStructureChecksum(options: GenerateWatchStructureOptions): string {
  return collectGenerateWatchStructureSnapshot(options).checksum
}
