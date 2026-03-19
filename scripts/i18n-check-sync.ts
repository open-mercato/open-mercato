/**
 * i18n Sync Checker
 *
 * Compares all locale translation files against the reference locale (en)
 * and reports missing keys, extra keys, missing locale files, and format violations.
 *
 * Enforces:
 *  - Flat dot-notation format (no nested objects)
 *  - Alphabetically sorted keys
 *  - Key parity across all locales
 *
 * Usage:
 *   tsx scripts/i18n-check-sync.ts          # Report only
 *   tsx scripts/i18n-check-sync.ts --fix    # Auto-fix: normalize format, add missing keys, remove extras
 *
 * Exit code: 1 if any discrepancies found (report mode), 0 if all in sync or after fix.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { globSync } from 'glob'

const REFERENCE_LOCALE = 'en'
const TARGET_LOCALES = ['pl', 'es', 'de']
const MAX_KEYS_TO_SHOW = 10

const __filename_ = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename_), '..')

const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`

function flattenDictionary(source: unknown, prefix = ''): Record<string, string> {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {}
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (!key) continue
    const nextKey = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      result[nextKey] = value
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenDictionary(value, nextKey))
    }
  }
  return result
}

function loadJsonFlat(filePath: string): Record<string, string> {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  return flattenDictionary(raw)
}

/** Check if a file uses flat format with sorted keys. Returns issues found. */
function checkFormat(filePath: string): { hasNested: boolean; unsorted: boolean } {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>
  const keys = Object.keys(raw)
  const hasNested = keys.some(k => typeof raw[k] === 'object' && raw[k] !== null)
  const unsorted = keys.join(',') !== [...keys].sort().join(',')
  return { hasNested, unsorted }
}

/** Write a flat, alphabetically sorted JSON file. */
function writeFlatSorted(filePath: string, flat: Record<string, string>): void {
  const sorted: Record<string, string> = {}
  for (const k of Object.keys(flat).sort()) sorted[k] = flat[k]
  fs.writeFileSync(filePath, JSON.stringify(sorted, null, 2) + '\n')
}

function deriveModuleName(enJsonPath: string): string {
  const rel = path.relative(ROOT, path.dirname(path.dirname(enJsonPath)))
  return rel
    .replace(/^packages\/core\/src\/modules\//, '')
    .replace(/^packages\/([^/]+)\/src\/modules\//, '$1/')
    .replace(/^apps\/mercato\/src\/modules\//, 'app/')
    .replace(/^apps\/mercato\/src$/, 'app')
}

function main() {
  const fixMode = process.argv.includes('--fix')

  const enFiles = globSync('**/i18n/en.json', {
    cwd: ROOT,
    ignore: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/create-app/template/**'],
    absolute: true,
  }).sort()

  if (enFiles.length === 0) {
    console.log(yellow('No translation files found.'))
    process.exit(0)
  }

  const mode = fixMode ? cyan('[fix]') : '[check]'
  console.log(`${mode} Checking translation sync across ${TARGET_LOCALES.length + 1} locales (${REFERENCE_LOCALE}, ${TARGET_LOCALES.join(', ')})...`)
  console.log(dim(`Found ${enFiles.length} modules with translations\n`))

  let totalIssues = 0
  let modulesWithIssues = 0
  let filesFixed = 0
  let keysAdded = 0
  let keysRemoved = 0
  let filesCreated = 0
  let filesReformatted = 0

  for (const enPath of enFiles) {
    const i18nDir = path.dirname(enPath)
    const moduleName = deriveModuleName(enPath)
    const enFlat = loadJsonFlat(enPath)
    const enKeys = new Set(Object.keys(enFlat))
    let moduleHasIssues = false

    // Check en.json format
    const enFormat = checkFormat(enPath)
    if (enFormat.hasNested || enFormat.unsorted) {
      moduleHasIssues = true
      if (fixMode) {
        writeFlatSorted(enPath, enFlat)
        filesReformatted++
        const reasons = [enFormat.hasNested && 'flattened', enFormat.unsorted && 'sorted'].filter(Boolean).join(' + ')
        console.log(`[${moduleName}] en.json: ${green(reasons)}`)
      } else {
        const reasons = [enFormat.hasNested && 'nested objects', enFormat.unsorted && 'unsorted keys'].filter(Boolean).join(', ')
        console.log(yellow(`[${moduleName}] en.json: format issue (${reasons})`))
        totalIssues++
      }
    }

    const missingFiles: string[] = []

    for (const locale of TARGET_LOCALES) {
      const localePath = path.join(i18nDir, `${locale}.json`)

      if (!fs.existsSync(localePath)) {
        missingFiles.push(`${locale}.json`)
        totalIssues++
        moduleHasIssues = true

        if (fixMode) {
          writeFlatSorted(localePath, enFlat)
          filesCreated++
          keysAdded += enKeys.size
          console.log(green(`[${moduleName}] ${locale}.json: CREATED with ${enKeys.size} keys (EN values as placeholders)`))
        }
        continue
      }

      const localeFlat = loadJsonFlat(localePath)
      const localeKeys = new Set(Object.keys(localeFlat))

      const missing = [...enKeys].filter(k => !localeKeys.has(k))
      const extra = [...localeKeys].filter(k => !enKeys.has(k))
      const localeFormat = checkFormat(localePath)
      const hasFormatIssue = localeFormat.hasNested || localeFormat.unsorted

      if (missing.length === 0 && extra.length === 0 && !hasFormatIssue) continue

      moduleHasIssues = true

      if (fixMode) {
        const fixedFlat: Record<string, string> = {}
        for (const key of enKeys) {
          fixedFlat[key] = localeFlat[key] ?? enFlat[key]
        }

        writeFlatSorted(localePath, fixedFlat)
        filesFixed++

        const parts: string[] = []
        if (missing.length > 0) {
          keysAdded += missing.length
          parts.push(green(`+${missing.length} added`))
        }
        if (extra.length > 0) {
          keysRemoved += extra.length
          parts.push(yellow(`-${extra.length} removed`))
        }
        if (hasFormatIssue && missing.length === 0 && extra.length === 0) {
          filesReformatted++
          const reasons = [localeFormat.hasNested && 'flattened', localeFormat.unsorted && 'sorted'].filter(Boolean).join(' + ')
          parts.push(green(reasons))
        }
        console.log(`[${moduleName}] ${locale}.json: ${parts.join(', ')}`)
      } else {
        if (hasFormatIssue) {
          const reasons = [localeFormat.hasNested && 'nested objects', localeFormat.unsorted && 'unsorted keys'].filter(Boolean).join(', ')
          console.log(yellow(`[${moduleName}] ${locale}.json: format issue (${reasons})`))
          totalIssues++
        }

        if (missing.length > 0) {
          const shown = missing.slice(0, MAX_KEYS_TO_SHOW)
          const suffix = missing.length > MAX_KEYS_TO_SHOW ? ` ${dim(`(showing ${MAX_KEYS_TO_SHOW} of ${missing.length})`)}` : ''
          console.log(red(`[${moduleName}] ${locale}.json: ${missing.length} missing keys${suffix}`))
          for (const k of shown) console.log(`  - ${k}`)
          totalIssues++
        }

        if (extra.length > 0) {
          const shown = extra.slice(0, MAX_KEYS_TO_SHOW)
          const suffix = extra.length > MAX_KEYS_TO_SHOW ? ` ${dim(`(showing ${MAX_KEYS_TO_SHOW} of ${extra.length})`)}` : ''
          console.log(yellow(`[${moduleName}] ${locale}.json: ${extra.length} extra keys${suffix}`))
          for (const k of shown) console.log(`  - ${k}`)
          totalIssues++
        }
      }
    }

    if (!fixMode && missingFiles.length > 0) {
      console.log(red(`[${moduleName}] MISSING FILES: ${missingFiles.join(', ')}`))
    }

    if (moduleHasIssues) modulesWithIssues++
  }

  console.log('')
  if (fixMode) {
    const total = filesFixed + filesCreated + filesReformatted
    if (total === 0) {
      console.log(green('All translation files are already in sync.'))
    } else {
      console.log(green(`Fixed ${total} files across ${modulesWithIssues} modules`))
      if (keysAdded > 0) console.log(green(`  +${keysAdded} keys added (EN values as placeholders — translate these)`))
      if (keysRemoved > 0) console.log(yellow(`  -${keysRemoved} stale keys removed`))
      if (filesCreated > 0) console.log(green(`  ${filesCreated} new locale files created`))
      if (filesReformatted > 0) console.log(green(`  ${filesReformatted} files reformatted (flattened/sorted)`))
    }
    process.exit(0)
  } else {
    if (totalIssues === 0) {
      console.log(green('All translation files are in sync.'))
      process.exit(0)
    } else {
      console.log(red(`${totalIssues} issues found across ${modulesWithIssues} modules`))
      console.log(dim(`Run with --fix to auto-repair: yarn i18n:check-sync --fix`))
      process.exit(1)
    }
  }
}

main()
