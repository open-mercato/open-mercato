/**
 * i18n Value-Coverage Checker
 *
 * `yarn i18n:check-sync` validates **key parity** across locales. This script
 * complements it by looking at **values**: how many entries in every non-English
 * locale file are still byte-identical to the English baseline, i.e. almost
 * certainly untranslated.
 *
 * Reports per-locale totals plus a per-module breakdown sorted by impact.
 * A coarse heuristic skips entries that are *legitimately* identical (acronyms,
 * proper nouns, numeric-only, URLs, placeholder-only strings).
 *
 * Optional repo-wide allowlist: `scripts/i18n-values-allowlist.json` with the
 * shape `{ "keys": ["module.brand.name", ...] }`. Allowlisted keys are skipped
 * in the "significant identical" count.
 *
 * Usage:
 *   node scripts/i18n-check-values.mjs                 # report
 *   node scripts/i18n-check-values.mjs --json          # machine output
 *   node scripts/i18n-check-values.mjs --locale pl     # narrow to one locale
 *   node scripts/i18n-check-values.mjs --module customers
 *
 * Exit code: always 0 in Phase 1 (advisory baseline). A regression gate is
 * defined by Phase 6 of `.ai/specs/2026-05-26-missing-translations-audit-and-remediation.md`.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { globSync } from 'glob'
import { compareLocale, flattenDictionary } from './i18n-values-scanner.mjs'

const __filename_ = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename_), '..')

const REFERENCE_LOCALE = 'en'
const TARGET_LOCALES = ['pl', 'es', 'de']
const ALLOWLIST_PATH = path.join(ROOT, 'scripts', 'i18n-values-allowlist.json')

const red = (s) => `\x1b[31m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`
const cyan = (s) => `\x1b[36m${s}\x1b[0m`

function parseArgs(argv) {
  const opts = { json: false, localesFilter: null, moduleFilter: null, samples: 0 }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') opts.json = true
    else if (arg === '--locale' && argv[i + 1]) {
      opts.localesFilter = argv[i + 1].split(',').map((s) => s.trim()).filter(Boolean)
      i++
    } else if (arg === '--module' && argv[i + 1]) {
      opts.moduleFilter = argv[i + 1]
      i++
    } else if (arg === '--samples' && argv[i + 1]) {
      const n = Number(argv[i + 1])
      if (Number.isFinite(n) && n >= 0) opts.samples = n
      i++
    }
  }
  return opts
}

function deriveModuleName(enJsonPath) {
  const rel = path.relative(ROOT, path.dirname(path.dirname(enJsonPath)))
  return rel
    .replace(/^packages\/core\/src\/modules\//, '')
    .replace(/^packages\/([^/]+)\/src\/modules\//, '$1/')
    .replace(/^apps\/mercato\/src\/modules\//, 'app/')
    .replace(/^apps\/mercato\/src$/, 'app')
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) return new Set()
  try {
    const raw = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf-8'))
    if (Array.isArray(raw?.keys)) return new Set(raw.keys)
  } catch (err) {
    console.error(yellow(`[i18n-values] failed to parse allowlist: ${err.message}`))
  }
  return new Set()
}

function safeLoadJsonFlat(filePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    return flattenDictionary(raw)
  } catch (err) {
    console.error(yellow(`[i18n-values] failed to parse ${path.relative(ROOT, filePath)}: ${err.message}`))
    return null
  }
}

function formatPercent(num, denom) {
  if (denom === 0) return '—'
  const pct = (num / denom) * 100
  return `${pct.toFixed(1)}%`
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const startedAt = Date.now()
  const allowlist = loadAllowlist()

  const enFiles = globSync('**/i18n/en.json', {
    cwd: ROOT,
    ignore: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/create-app/template/**'],
    absolute: true,
  }).sort()

  const locales = opts.localesFilter && opts.localesFilter.length > 0
    ? opts.localesFilter.filter((l) => l !== REFERENCE_LOCALE)
    : TARGET_LOCALES

  const perLocale = new Map()
  for (const locale of locales) {
    perLocale.set(locale, {
      total: 0,
      identical: 0,
      identicalSignificant: 0,
      missing: 0,
      translated: 0,
      perModule: [],
    })
  }

  let modulesProcessed = 0

  for (const enPath of enFiles) {
    const moduleName = deriveModuleName(enPath)
    if (opts.moduleFilter && !moduleName.includes(opts.moduleFilter)) continue
    const enFlat = safeLoadJsonFlat(enPath)
    if (!enFlat) continue
    modulesProcessed += 1
    const i18nDir = path.dirname(enPath)

    for (const locale of locales) {
      const localePath = path.join(i18nDir, `${locale}.json`)
      if (!fs.existsSync(localePath)) {
        const accum = perLocale.get(locale)
        accum.total += Object.keys(enFlat).length
        accum.missing += Object.keys(enFlat).length
        accum.perModule.push({
          module: moduleName,
          total: Object.keys(enFlat).length,
          identical: 0,
          identicalSignificant: 0,
          missing: Object.keys(enFlat).length,
          translated: 0,
          samples: [],
        })
        continue
      }
      const localeFlat = safeLoadJsonFlat(localePath)
      if (!localeFlat) continue

      const result = compareLocale(enFlat, localeFlat, { allowlist })
      const accum = perLocale.get(locale)
      accum.total += result.total
      accum.identical += result.identical
      accum.identicalSignificant += result.identicalSignificant
      accum.missing += result.missing
      accum.translated += result.translated
      accum.perModule.push({ module: moduleName, ...result })
    }
  }

  const elapsedMs = Date.now() - startedAt

  if (opts.json) {
    const payload = {
      elapsedMs,
      modulesProcessed,
      locales: Array.from(perLocale.entries()).map(([locale, accum]) => ({
        locale,
        total: accum.total,
        identical: accum.identical,
        identicalSignificant: accum.identicalSignificant,
        missing: accum.missing,
        translated: accum.translated,
        perModule: accum.perModule,
      })),
    }
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n')
    process.exit(0)
  }

  console.log(`${cyan('[check]')} i18n value coverage — scanned ${modulesProcessed} modules in ${elapsedMs}ms`)
  console.log(dim(`Baseline locale: ${REFERENCE_LOCALE}. Compared: ${locales.join(', ')}.`))
  console.log(dim('"Identical" = byte-identical to English; "significant" excludes acronyms/numbers/short tokens and allowlisted keys.'))
  console.log('')

  for (const [locale, accum] of perLocale.entries()) {
    const significantPct = formatPercent(accum.identicalSignificant, accum.total)
    const rawPct = formatPercent(accum.identical, accum.total)
    const color = accum.identicalSignificant / Math.max(accum.total, 1) > 0.05 ? red : accum.identicalSignificant > 0 ? yellow : green
    console.log(
      `${color(`[${locale}]`)} ${accum.total} keys • ${color(`${accum.identicalSignificant}`)} significant identical (${color(significantPct)}) • ${dim(`${accum.identical} raw (${rawPct})`)} • ${dim(`${accum.missing} missing`)}`,
    )

    const modules = accum.perModule
      .slice()
      .sort((a, b) => b.identicalSignificant - a.identicalSignificant)
      .filter((m) => m.identicalSignificant > 0)
      .slice(0, 12)
    for (const m of modules) {
      console.log(`  ${dim('-')} ${m.module}: ${m.identicalSignificant}/${m.total} (${formatPercent(m.identicalSignificant, m.total)})`)
      if (opts.samples > 0) {
        for (const sample of m.samples.slice(0, opts.samples)) {
          console.log(`      ${dim(sample.key)} = ${dim(JSON.stringify(sample.value))}`)
        }
      }
    }
  }

  console.log('')
  console.log(dim('Phase 1 of the i18n remediation plan is advisory — exit code stays 0.'))
  console.log(dim('Suppress a key globally: scripts/i18n-values-allowlist.json (see .ai/specs/2026-05-26-missing-translations-audit-and-remediation.md).'))
  process.exit(0)
}

main()
