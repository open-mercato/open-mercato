import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  MODULE_CODE_EXTENSIONS,
  SCAN_CONFIGS,
  scanModuleDir,
  stripModuleCodeExtension,
  type ModuleRoots,
} from './generators/scanner'

const STRUCTURAL_CONVENTION_FILES = [
  'index.ts',
  'cli.ts',
  'di.ts',
  'acl.ts',
  'setup.ts',
  'encryption.ts',
  'ce.ts',
  'search.ts',
  'events.ts',
  'notifications.ts',
  'notifications.client.ts',
  'notifications.handlers.ts',
  'translations.ts',
  'generators.ts',
  'ai-tools.ts',
  'ai-agents.ts',
  'analytics.ts',
  'workflows.ts',
  'inbox-actions.ts',
  'message-types.ts',
  'message-objects.ts',
  'integration.ts',
  'security.mfa-providers.ts',
  'security.sudo.ts',
  'data/entities.ts',
  'data/extensions.ts',
  'data/fields.ts',
  'data/enrichers.ts',
  'data/guards.ts',
  'api/interceptors.ts',
  'commands/interceptors.ts',
  'widgets/components.ts',
  'widgets/injection-table.ts',
  'frontend/middleware.ts',
  'backend/middleware.ts',
] as const

const CONTENT_SENSITIVE_SCAN_CONFIGS = [
  SCAN_CONFIGS.apiRoutes,
  SCAN_CONFIGS.apiPlainFiles,
  SCAN_CONFIGS.subscribers,
  SCAN_CONFIGS.workers,
  SCAN_CONFIGS.dashboardWidgets,
  SCAN_CONFIGS.injectionWidgets,
] as const

const ROUTE_SHAPE_SCAN_CONFIGS = [
  SCAN_CONFIGS.frontendPages,
  SCAN_CONFIGS.backendPages,
] as const

function checksum(value: string): string {
  return crypto.createHash('md5').update(value).digest('hex')
}

function fileRecord(filePath: string, base: string, mode: 'content' | 'shape'): string | null {
  if (!fs.existsSync(filePath)) return null
  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
  } catch {
    return null
  }
  if (!stat.isFile()) return null
  const rel = path.relative(base, filePath).replace(/\\/g, '/')
  if (mode === 'shape') {
    return `file:${rel}`
  }
  try {
    return `file:${rel}:${stat.size}:${checksum(fs.readFileSync(filePath, 'utf8'))}`
  } catch {
    return `file:${rel}:unreadable`
  }
}

function resolveCodeFile(base: string, relativePath: string): string | null {
  const stripped = stripModuleCodeExtension(relativePath)
  const candidates = MODULE_CODE_EXTENSIONS.map((extension) => `${stripped}${extension}`)
  for (const candidate of candidates) {
    const filePath = path.join(base, ...candidate.split('/'))
    if (fs.existsSync(filePath)) return filePath
  }
  return null
}

function hasInlinePageMetadata(filePath: string): boolean {
  try {
    const source = fs.readFileSync(filePath, 'utf8')
    return /\bexport\s+(?:const|let|var|function|class)\s+metadata\b/.test(source)
      || /\bexport\s+\{[^}]*\bmetadata\b[^}]*\}/.test(source)
  } catch {
    return false
  }
}

function addConventionRecords(records: string[], roots: ModuleRoots): void {
  for (const base of [roots.pkgBase, roots.appBase]) {
    records.push(`module-root:${base}:${fs.existsSync(base) ? 'present' : 'missing'}`)
    for (const relativePath of STRUCTURAL_CONVENTION_FILES) {
      const filePath = resolveCodeFile(base, relativePath)
      if (!filePath) {
        records.push(`missing:${base}:${relativePath}`)
        continue
      }
      const record = fileRecord(filePath, base, 'content')
      if (record) records.push(record)
    }
  }
}

function addScannedRecords(records: string[], roots: ModuleRoots): void {
  for (const config of CONTENT_SENSITIVE_SCAN_CONFIGS) {
    for (const scanned of scanModuleDir(roots, config)) {
      const base = scanned.fromApp ? roots.appBase : roots.pkgBase
      const filePath = path.join(base, ...config.folder.split('/'), ...scanned.relPath.split('/'))
      const record = fileRecord(filePath, base, 'content')
      if (record) records.push(`${config.folder}:${record}`)
    }
  }

  for (const config of ROUTE_SHAPE_SCAN_CONFIGS) {
    for (const scanned of scanModuleDir(roots, config)) {
      const base = scanned.fromApp ? roots.appBase : roots.pkgBase
      const folderPath = path.join(base, ...config.folder.split('/'))
      const filePath = path.join(folderPath, ...scanned.relPath.split('/'))
      const pageRecord = fileRecord(filePath, base, hasInlinePageMetadata(filePath) ? 'content' : 'shape')
      if (pageRecord) records.push(`${config.folder}:${pageRecord}`)

      const dir = path.dirname(filePath)
      const stem = stripModuleCodeExtension(path.basename(filePath))
      const metaCandidates = stem === 'page'
        ? ['page.meta', 'meta']
        : [`${stem}.meta`, 'meta']
      for (const candidate of metaCandidates) {
        const metaPath = resolveCodeFile(dir, candidate)
        if (!metaPath) continue
        const record = fileRecord(metaPath, base, 'content')
        if (record) records.push(`${config.folder}:meta:${record}`)
      }
    }
  }
}

export function calculateGenerateWatchStructureChecksum(options: {
  modulesFile: string
  moduleRoots: ModuleRoots[]
}): string {
  const records: string[] = []
  const modulesRecord = fileRecord(options.modulesFile, path.dirname(options.modulesFile), 'content')
  records.push(modulesRecord ?? `missing:${options.modulesFile}`)

  for (const roots of options.moduleRoots) {
    addConventionRecords(records, roots)
    addScannedRecords(records, roots)
  }

  return checksum(records.sort((a, b) => a.localeCompare(b)).join('\n'))
}
