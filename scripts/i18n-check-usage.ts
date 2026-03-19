/**
 * i18n Usage Scanner
 *
 * Cross-references translation keys in JSON files against actual t()/translate()
 * calls in the source code. Reports unused keys and missing keys.
 *
 * Detects keys via:
 *  - Direct calls: t('key'), translate('key', 'fallback')
 *  - Indirect property patterns: labelKey: 'key', titleKey: 'key', etc.
 *  - String literals matching known translation key patterns in arrays/objects
 *
 * Usage: tsx scripts/i18n-check-usage.ts
 * Exit code: 1 if missing keys found (referenced in code but not in JSON), 0 otherwise.
 * Unused keys are reported as warnings only.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { globSync } from 'glob'

const __filename_ = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename_), '..')

const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

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

function collectAllTranslationKeys(): Set<string> {
  const enFiles = globSync('**/i18n/en.json', {
    cwd: ROOT,
    ignore: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/create-app/template/**'],
    absolute: true,
  })

  const allKeys = new Set<string>()
  for (const f of enFiles) {
    const flat = flattenDictionary(JSON.parse(fs.readFileSync(f, 'utf-8')))
    for (const k of Object.keys(flat)) allKeys.add(k)
  }
  return allKeys
}

interface KeyReference {
  key: string
  file: string
  line: number
}

function scanSourceFiles(allTranslationKeys: Set<string>): { refs: KeyReference[]; dynamicCount: number } {
  const sourceFiles = globSync('**/*.{ts,tsx}', {
    cwd: ROOT,
    ignore: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/generated/**',
      '**/*.test.*',
      '**/*.spec.*',
      '**/i18n/**',
      '**/create-app/template/**',
      'scripts/**',
    ],
    absolute: true,
  })

  // Pattern 1: Direct t('key') or translate('key') calls
  const directCallPattern = /(?<![a-zA-Z_])(?:t|translate)\(\s*(['"])([a-zA-Z0-9_.]+)\1/g

  // Pattern 2: Indirect key properties — labelKey: 'key', titleKey: 'key', descriptionKey: 'key', etc.
  const keyPropertyPattern = /[a-zA-Z]*[Kk]ey['"]?\s*[:=]\s*(['"])([a-zA-Z0-9_.]+)\1/g

  // Pattern 3: Detect dynamic t() calls for counting
  const dynamicCallPattern = /(?<![a-zA-Z_])(?:t|translate)\(\s*(?!['"])[a-zA-Z`{]/g

  const refs: KeyReference[] = []
  let dynamicCount = 0

  for (const filePath of sourceFiles) {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    const relPath = path.relative(ROOT, filePath)

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Direct t()/translate() calls
      for (const match of line.matchAll(directCallPattern)) {
        refs.push({ key: match[2], file: relPath, line: i + 1 })
      }

      // Indirect key properties (only count if the value is a known translation key)
      for (const match of line.matchAll(keyPropertyPattern)) {
        const candidate = match[2]
        if (allTranslationKeys.has(candidate)) {
          refs.push({ key: candidate, file: relPath, line: i + 1 })
        }
      }

      // Dynamic calls
      for (const _ of line.matchAll(dynamicCallPattern)) {
        dynamicCount++
      }
    }
  }

  return { refs, dynamicCount }
}

function main() {
  console.log('Scanning codebase for translation key usage...\n')

  const allTranslationKeys = collectAllTranslationKeys()
  console.log(dim(`Found ${allTranslationKeys.size} translation keys across all en.json files`))

  const { refs, dynamicCount } = scanSourceFiles(allTranslationKeys)
  const usedKeys = new Set(refs.map(r => r.key))
  console.log(dim(`Found ${refs.length} static references to ${usedKeys.size} unique keys`))
  console.log('')

  // Missing keys: referenced in code via t()/translate() but not in any en.json
  // Only flag direct calls as missing — indirect property refs are validated against known keys
  const directCallPattern = /(?<![a-zA-Z_])(?:t|translate)\(/
  const missingRefs = refs.filter(r => {
    if (allTranslationKeys.has(r.key)) return false
    // Only report as missing if it came from a direct t()/translate() call
    const filePath = path.join(ROOT, r.file)
    const line = fs.readFileSync(filePath, 'utf-8').split('\n')[r.line - 1] || ''
    return directCallPattern.test(line)
  })
  const missingKeys = new Set(missingRefs.map(r => r.key))

  // Unused keys: in en.json but never referenced in code
  const unusedKeys = [...allTranslationKeys].filter(k => !usedKeys.has(k)).sort()

  let hasErrors = false

  if (missingKeys.size > 0) {
    console.log(red(`MISSING KEYS (referenced in code but not in any en.json): ${missingKeys.size} keys`))
    const byKey = new Map<string, KeyReference>()
    for (const ref of missingRefs) {
      if (!byKey.has(ref.key)) byKey.set(ref.key, ref)
    }
    for (const [key, ref] of byKey) {
      console.log(`  ${ref.file}:${ref.line} → ${red(key)}`)
    }
    console.log('')
    hasErrors = true
  }

  if (unusedKeys.length > 0) {
    console.log(yellow(`UNUSED KEYS (in en.json but not referenced in code): ${unusedKeys.length} keys`))
    const maxToShow = 30
    const shown = unusedKeys.slice(0, maxToShow)
    for (const k of shown) console.log(`  ${dim('-')} ${k}`)
    if (unusedKeys.length > maxToShow) {
      console.log(dim(`  ... and ${unusedKeys.length - maxToShow} more`))
    }
    console.log('')
  }

  if (dynamicCount > 0) {
    console.log(dim(`Skipped ${dynamicCount} dynamic t()/translate() calls (non-string-literal arguments)\n`))
  }

  // Summary
  const parts: string[] = []
  if (missingKeys.size > 0) parts.push(red(`${missingKeys.size} missing keys`))
  if (unusedKeys.length > 0) parts.push(yellow(`${unusedKeys.length} unused keys (advisory)`))

  if (parts.length === 0) {
    console.log(green('All translation keys are in sync with code usage.'))
    process.exit(0)
  } else {
    console.log(`Summary: ${parts.join(', ')}`)
    process.exit(hasErrors ? 1 : 0)
  }
}

main()
