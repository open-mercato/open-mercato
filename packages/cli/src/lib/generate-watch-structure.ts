import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  MODULE_CODE_EXTENSIONS,
  SCAN_CONFIGS,
  resolveStandaloneSourceMirrorBase,
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
  'runtime.ts',
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

function addFileRecord(
  records: string[],
  prefix: string,
  filePath: string,
  base: string,
  mode: 'content' | 'shape',
): void {
  const record = fileRecord(filePath, base, mode)
  if (record) records.push(`${prefix}:${record}`)
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

function resolveRuntimeCounterpart(
  pkgBase: string,
  sourceBase: string,
  sourceFile: string,
): string | null {
  if (sourceBase === pkgBase) return null
  const relativePath = path.relative(sourceBase, sourceFile).replace(/\\/g, '/')
  return resolveCodeFile(pkgBase, relativePath)
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
  const packageSourceBase = resolveStandaloneSourceMirrorBase(roots.pkgBase) ?? roots.pkgBase
  for (const base of [roots.pkgBase, roots.appBase]) {
    records.push(`module-root:${base}:${fs.existsSync(base) ? 'present' : 'missing'}`)
  }
  if (packageSourceBase !== roots.pkgBase) {
    records.push(
      `module-root:${packageSourceBase}:${fs.existsSync(packageSourceBase) ? 'present' : 'missing'}`,
    )
  }

  for (const relativePath of STRUCTURAL_CONVENTION_FILES) {
    const appFile = resolveCodeFile(roots.appBase, relativePath)
    if (appFile) {
      addFileRecord(records, 'convention:app', appFile, roots.appBase, 'content')
      continue
    }

    const sourceFile = resolveCodeFile(packageSourceBase, relativePath)
    if (!sourceFile) {
      const runtimeFile = packageSourceBase === roots.pkgBase
        ? null
        : resolveCodeFile(roots.pkgBase, relativePath)
      if (runtimeFile) {
        addFileRecord(records, 'convention:package-runtime', runtimeFile, roots.pkgBase, 'content')
      } else {
        records.push(`convention:missing:${relativePath}`)
      }
      continue
    }

    const packagePrefix = packageSourceBase === roots.pkgBase ? 'package' : 'package-source'
    addFileRecord(records, `convention:${packagePrefix}`, sourceFile, packageSourceBase, 'content')
    const runtimeFile = resolveRuntimeCounterpart(roots.pkgBase, packageSourceBase, sourceFile)
    if (runtimeFile) {
      addFileRecord(records, 'convention:package-runtime', runtimeFile, roots.pkgBase, 'content')
    } else if (packageSourceBase !== roots.pkgBase) {
      records.push(`convention:package-runtime:missing:${relativePath}`)
    }
  }
}

function addScannedRecords(records: string[], roots: ModuleRoots): void {
  const packageSourceBase = resolveStandaloneSourceMirrorBase(roots.pkgBase) ?? roots.pkgBase
  for (const config of CONTENT_SENSITIVE_SCAN_CONFIGS) {
    for (const scanned of scanModuleDir(roots, config)) {
      const base = scanned.fromApp ? roots.appBase : packageSourceBase
      const filePath = path.join(base, ...config.folder.split('/'), ...scanned.relPath.split('/'))
      let sourceOrigin = 'app'
      if (!scanned.fromApp) {
        sourceOrigin = packageSourceBase === roots.pkgBase ? 'package' : 'package-source'
      }
      addFileRecord(records, `${config.folder}:${sourceOrigin}`, filePath, base, 'content')

      if (!scanned.fromApp && packageSourceBase !== roots.pkgBase) {
        const runtimeFile = resolveRuntimeCounterpart(roots.pkgBase, packageSourceBase, filePath)
        if (runtimeFile) {
          addFileRecord(
            records,
            `${config.folder}:package-runtime`,
            runtimeFile,
            roots.pkgBase,
            'content',
          )
        } else {
          records.push(`${config.folder}:package-runtime:missing:${scanned.relPath}`)
        }
      }
    }
  }

  for (const config of ROUTE_SHAPE_SCAN_CONFIGS) {
    for (const scanned of scanModuleDir(roots, config)) {
      const base = scanned.fromApp ? roots.appBase : packageSourceBase
      const folderPath = path.join(base, ...config.folder.split('/'))
      const filePath = path.join(folderPath, ...scanned.relPath.split('/'))
      let sourceOrigin = 'app'
      if (!scanned.fromApp) {
        sourceOrigin = packageSourceBase === roots.pkgBase ? 'package' : 'package-source'
      }
      addFileRecord(
        records,
        `${config.folder}:${sourceOrigin}`,
        filePath,
        base,
        hasInlinePageMetadata(filePath) ? 'content' : 'shape',
      )

      let runtimeFile: string | null = null
      if (!scanned.fromApp && packageSourceBase !== roots.pkgBase) {
        runtimeFile = resolveRuntimeCounterpart(roots.pkgBase, packageSourceBase, filePath)
        if (runtimeFile) {
          addFileRecord(
            records,
            `${config.folder}:package-runtime`,
            runtimeFile,
            roots.pkgBase,
            hasInlinePageMetadata(runtimeFile) ? 'content' : 'shape',
          )
        } else {
          records.push(`${config.folder}:package-runtime:missing:${scanned.relPath}`)
        }
      }

      const stem = stripModuleCodeExtension(path.basename(filePath))
      const metaCandidates = stem === 'page'
        ? ['page.meta', 'meta']
        : [`${stem}.meta`, 'meta']
      for (const candidate of metaCandidates) {
        const metaPath = resolveCodeFile(path.dirname(filePath), candidate)
        if (!metaPath) continue
        addFileRecord(records, `${config.folder}:meta:${sourceOrigin}`, metaPath, base, 'content')
      }

      if (runtimeFile) {
        for (const candidate of metaCandidates) {
          const runtimeMetaPath = resolveCodeFile(path.dirname(runtimeFile), candidate)
          if (!runtimeMetaPath) continue
          addFileRecord(
            records,
            `${config.folder}:meta:package-runtime`,
            runtimeMetaPath,
            roots.pkgBase,
            'content',
          )
        }
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
