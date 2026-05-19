import fs from 'node:fs'
import path from 'node:path'

const DECORATOR_EXPORT_NAMES = [
  'Entity',
  'PrimaryKey',
  'Property',
  'ManyToOne',
  'OneToMany',
  'OneToOne',
  'ManyToMany',
  'Enum',
  'Index',
  'Unique',
  'Embeddable',
  'Embedded',
  'Formula',
] as const

const RECOVERY_VERSION = 'mikro-orm-v7-generated-cache-recovery-v1'
const RECOVERY_MARKER_FILE = '.mikro-orm-v7-cache-recovery.json'
const GENERATED_DIR_SEGMENTS = ['.mercato', 'generated'] as const

const staleDecoratorImportPattern = new RegExp(
  String.raw`import\s*\{[^}]*\b(?:${DECORATOR_EXPORT_NAMES.join('|')})\b[^}]*\}\s*from\s*['"]@mikro-orm/core['"]`,
  'm',
)

const decoratorExportErrorPattern = /@mikro-orm\/core' does not provide an export named '(?:Entity|PrimaryKey|Property|ManyToOne|OneToMany|OneToOne|ManyToMany|Enum|Index|Unique|Embeddable|Embedded|Formula)'/

type RecoveryLogger = {
  warn: (message: string) => void
}

type RecoveryReason = 'stale-generated-cache-scan' | 'runtime-import-error'

type RecoveryMarker = {
  version: string
  reason: RecoveryReason
  createdAt: string
  deletedFiles: string[]
}

export type GeneratedCacheRecoveryResult = {
  applied: boolean
  deletedFiles: string[]
  markerPath: string | null
}

function getGeneratedDir(appRoot: string): string {
  return path.join(appRoot, ...GENERATED_DIR_SEGMENTS)
}

function getRecoveryMarkerPath(appRoot: string): string {
  return path.join(getGeneratedDir(appRoot), RECOVERY_MARKER_FILE)
}

function walkFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return []

  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolutePath))
      continue
    }
    if (entry.isFile()) {
      files.push(absolutePath)
    }
  }
  return files
}

function listGeneratedCacheFiles(appRoot: string): string[] {
  return walkFiles(getGeneratedDir(appRoot))
    .filter((filePath) => filePath.endsWith('.mjs'))
    .sort()
}

function findStaleGeneratedCacheFiles(appRoot: string): string[] {
  const generatedFiles = listGeneratedCacheFiles(appRoot)
  return generatedFiles.filter((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8')
    return staleDecoratorImportPattern.test(source)
  })
}

function writeRecoveryMarker(appRoot: string, marker: RecoveryMarker): string {
  const markerPath = getRecoveryMarkerPath(appRoot)
  fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2))
  return markerPath
}

function logRecoveryMessage(logger: RecoveryLogger, reason: RecoveryReason): void {
  const header =
    reason === 'runtime-import-error'
      ? '⚠️  Open Mercato detected a stale generated cache while bootstrapping the app.'
      : '⚠️  Open Mercato detected stale generated cache from the MikroORM v7 migration.'

  logger.warn('')
  logger.warn(header)
  logger.warn('📘 Open Mercato migrated MikroORM to version 7. Please review UPGRADE_NOTES.md and the `migrate-mikro-orm` skill if your code still imports decorators from `@mikro-orm/core`.')
  logger.warn('🧹 Cleaning generated compilation cache and recompiling generated code now...')
  logger.warn('')
}

function deleteGeneratedCacheFiles(filePaths: string[]): string[] {
  const deletedFiles: string[] = []
  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) continue
    fs.rmSync(filePath, { force: true })
    deletedFiles.push(filePath)
  }
  return deletedFiles
}

function applyGeneratedCacheRecovery(
  appRoot: string,
  staleFiles: string[],
  reason: RecoveryReason,
  logger: RecoveryLogger,
): GeneratedCacheRecoveryResult {
  if (staleFiles.length === 0) {
    return { applied: false, deletedFiles: [], markerPath: null }
  }

  logRecoveryMessage(logger, reason)

  const generatedCacheFiles = listGeneratedCacheFiles(appRoot)
  const deletedFiles = deleteGeneratedCacheFiles(generatedCacheFiles)
  const markerPath = writeRecoveryMarker(appRoot, {
    version: RECOVERY_VERSION,
    reason,
    createdAt: new Date().toISOString(),
    deletedFiles,
  })

  return {
    applied: true,
    deletedFiles,
    markerPath,
  }
}

export function shouldRecoverMikroOrmV7GeneratedCache(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return decoratorExportErrorPattern.test(message)
}

export function ensureMikroOrmV7GeneratedCacheCompatibility(
  appRoot: string,
  options: { logger?: RecoveryLogger } = {},
): GeneratedCacheRecoveryResult {
  const logger = options.logger ?? console
  const staleFiles = findStaleGeneratedCacheFiles(appRoot)
  return applyGeneratedCacheRecovery(appRoot, staleFiles, 'stale-generated-cache-scan', logger)
}

export function recoverMikroOrmV7GeneratedCacheFromImportError(
  appRoot: string,
  error: unknown,
  options: { logger?: RecoveryLogger } = {},
): GeneratedCacheRecoveryResult {
  if (!shouldRecoverMikroOrmV7GeneratedCache(error)) {
    return { applied: false, deletedFiles: [], markerPath: null }
  }

  const logger = options.logger ?? console
  const staleFiles = findStaleGeneratedCacheFiles(appRoot)
  return applyGeneratedCacheRecovery(appRoot, staleFiles, 'runtime-import-error', logger)
}
