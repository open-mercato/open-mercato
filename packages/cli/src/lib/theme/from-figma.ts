/**
 * `mercato theme from-figma` — client brand import from a Figma file.
 *
 * DESIGN RULE (normative, per the from-figma spec): the machine INVENTORIES,
 * the designer INTERPRETS. Frequency, chroma, and even a variable named
 * `primary` are evidence, not verdicts. This command must never ship a code
 * path that finalizes a token assignment without explicit human input carried
 * via a prompt answer or a `--map` value. Non-TTY without `--map` degrades to
 * report-only; it never guesses.
 *
 * Generation is delegated verbatim to the `theme init` pipeline (`runThemeInit`)
 * so there is exactly one code path that produces themes, one set of OKLCH
 * derivation rules, and one WCAG contrast gate.
 *
 * Exit codes: 0 success (warnings allowed), 1 validation failure — unreachable
 * file, missing/invalid token, unparseable `--map` value, or a WCAG hard
 * failure on an explicitly supplied pair. `--report-only` exits 0 even when
 * candidates look unusable: an audit is not a failure.
 */

import fs from 'node:fs'
import path from 'node:path'
import { formatHexColor, parseHexColor } from './contrast'
import { buildContrastChecks, runThemeInit, type ContrastCheck } from './init'
import { derivePalette, validateRadius, type DerivedPalette } from './palette'
import {
  describeCandidateEvidence,
  renderBrandReport,
  type ConfirmedMapping,
} from './brand-report'
import {
  extractBrand,
  isNearGray,
  parseFigmaFileKey,
  readExtraction,
  serializeExtraction,
  type BrandCandidate,
  type BrandExtraction,
  type ExtractOptions,
} from './figma-extract'

const USAGE = `Usage: mercato theme from-figma <file-url-or-key> [options]

  <file-url-or-key>            Figma URL (figma.com/design/<key>/… or /file/<key>/…) or bare file key
  --map <pairs>                non-interactive mapping, e.g. --map "primary=#0C71C6,radius=8px,font=Inter"
                               accepted keys: primary, primary-foreground, radius, font, font-mono
  --report-only                extract + write report and extraction JSON; never write theme.css
  --extract-json <path>        where to write the extraction JSON (default .ai/reports/figma-brand-extract-<key>.json)
                               pointing it at an existing extraction with a matching key skips re-fetching
  --report <path>              where to write the markdown report (default .ai/reports/figma-brand-import-<key>.md)
  --pages <names>              limit frame scanning to named pages (comma-separated; default: all)
  --out / --force / --dry-run  passed through to the theme init writer (same semantics, same defaults)

Auth: set FIGMA_TOKEN in the environment (figma.com → Settings → Personal access
tokens, with file read scope). The token is never accepted as a flag, never
logged, and never written into any artifact. All Figma access is read-only.`

const MAP_KEYS = ['primary', 'primary-foreground', 'radius', 'font', 'font-mono'] as const
type MapKey = (typeof MAP_KEYS)[number]

export type ThemeFromFigmaFlags = {
  fileRef: string | null
  map: string | null
  reportOnly: boolean
  extractJson: string | null
  report: string | null
  pages: string | null
  out: string | null
  force: boolean
  dryRun: boolean
  help: boolean
  unknown: string[]
}

export function parseThemeFromFigmaArgs(args: string[]): ThemeFromFigmaFlags {
  const flags: ThemeFromFigmaFlags = {
    fileRef: null,
    map: null,
    reportOnly: false,
    extractJson: null,
    report: null,
    pages: null,
    out: null,
    force: false,
    dryRun: false,
    help: false,
    unknown: [],
  }
  const valueFlags: Record<string, keyof Pick<ThemeFromFigmaFlags, 'map' | 'extractJson' | 'report' | 'pages' | 'out'>> = {
    '--map': 'map',
    '--extract-json': 'extractJson',
    '--report': 'report',
    '--pages': 'pages',
    '--out': 'out',
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--force') { flags.force = true; continue }
    if (arg === '--dry-run') { flags.dryRun = true; continue }
    if (arg === '--report-only') { flags.reportOnly = true; continue }
    if (arg === '--help' || arg === '-h') { flags.help = true; continue }
    const equalsIndex = arg.indexOf('=')
    const name = equalsIndex >= 0 ? arg.slice(0, equalsIndex) : arg
    const target = valueFlags[name]
    if (target) {
      if (equalsIndex >= 0) {
        const value = arg.slice(equalsIndex + 1)
        // `--map=` or `--extract-json=` must hard-error up front: an empty
        // string would silently degrade the mode or crash the artifact writer
        // after a full fetch.
        if (value === '') flags.unknown.push(`${name} (empty value)`)
        else flags[target] = value
      } else {
        const next = args[i + 1]
        if (next === undefined) {
          flags.unknown.push(`${name} (missing value)`)
        } else if (next === '') {
          flags.unknown.push(`${name} (empty value)`)
          i += 1
        } else {
          flags[target] = next
          i += 1
        }
      }
      continue
    }
    if (arg.startsWith('--')) {
      flags.unknown.push(arg)
      continue
    }
    if (flags.fileRef === null) {
      flags.fileRef = arg
      continue
    }
    flags.unknown.push(arg)
  }
  return flags
}

export type ParsedMap = { mapping: ConfirmedMapping; errors: string[]; warnings: string[] }

/** Parses `--map "primary=#0C71C6,radius=8px,font=Inter"` pairs. */
export function parseMapFlag(raw: string): ParsedMap {
  const mapping: ConfirmedMapping = {
    primary: '',
    primaryForeground: null,
    radius: null,
    font: null,
    fontMono: null,
  }
  const errors: string[] = []
  const warnings: string[] = []
  const seenKeys = new Set<string>()
  for (const pair of raw.split(',').map((part) => part.trim()).filter(Boolean)) {
    const equalsIndex = pair.indexOf('=')
    if (equalsIndex <= 0) {
      errors.push(`Malformed --map pair "${pair}" — expected key=value.`)
      continue
    }
    const key = pair.slice(0, equalsIndex).trim()
    const value = pair.slice(equalsIndex + 1).trim()
    if (!(MAP_KEYS as readonly string[]).includes(key)) {
      errors.push(`Unknown --map key "${key}". Accepted keys: ${MAP_KEYS.join(', ')}.`)
      continue
    }
    if (seenKeys.has(key)) {
      warnings.push(`Duplicate --map key "${key}" — the later value overrides the earlier one.`)
    }
    seenKeys.add(key)
    if (!value) {
      errors.push(`Empty --map value for "${key}".`)
      continue
    }
    switch (key as MapKey) {
      case 'primary': {
        // Normalize through parse+format so `#fff` and `#ffffff` are the same
        // value everywhere: candidate matching, the report, and the generator.
        const rgb = parseHexColor(value)
        if (!rgb) errors.push(`Invalid --map primary "${value}". Expected #RGB or #RRGGBB.`)
        else mapping.primary = formatHexColor(rgb)
        break
      }
      case 'primary-foreground': {
        const rgb = parseHexColor(value)
        if (!rgb) errors.push(`Invalid --map primary-foreground "${value}". Expected #RGB or #RRGGBB.`)
        else mapping.primaryForeground = formatHexColor(rgb)
        break
      }
      case 'radius': {
        const radius = validateRadius(value)
        if (!radius.valid) errors.push(`Invalid --map radius "${value}". Expected a CSS length like 8px or 0.5rem.`)
        else mapping.radius = radius.value
        break
      }
      case 'font':
        mapping.font = value
        break
      case 'font-mono':
        mapping.fontMono = value
        break
    }
  }
  if (!mapping.primary) {
    errors.push('Missing --map primary — nothing proceeds to generation until the primary is explicitly chosen.')
  }
  return { mapping, errors, warnings }
}

// ── Interactive prompt ──────────────────────────────────────────────────────

export type AskFn = (question: string) => Promise<string>

export type FromFigmaDeps = {
  fetchImpl?: ExtractOptions['fetchImpl']
  sleepImpl?: ExtractOptions['sleepImpl']
  now?: () => Date
  env?: Record<string, string | undefined>
  isTTY?: boolean
  ask?: AskFn
  /** Prompt streams (default process.stdin/stdout); injectable for tests. */
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
}

/**
 * Thrown when the interactive prompt's stdin closes (EOF / Ctrl-D) before an
 * answer arrives. Without this, `readline/promises` leaves the pending
 * `question()` unsettled forever and the process exits 0 having done nothing.
 */
export class PromptAbortedError extends Error {
  constructor() {
    super('Prompt aborted: stdin closed before an answer was given.')
    this.name = 'PromptAbortedError'
  }
}

function renderCandidateTable(candidates: BrandCandidate[], showAll: boolean): string[] {
  const lines: string[] = ['', '  #  Hex       Uses  Evidence']
  let hidden = 0
  candidates.forEach((candidate, index) => {
    const gray = isNearGray(candidate.hex)
    if (!showAll && gray && index >= 8) {
      hidden += 1
      return
    }
    const number = String(index + 1).padStart(3)
    const uses = String(candidate.count).padStart(5)
    const grayNote = gray ? ' (near-gray; likely text/background/borders)' : ''
    lines.push(`${number}  ${candidate.hex}${uses}  ${describeCandidateEvidence(candidate)}${grayNote}`)
  })
  if (hidden > 0) lines.push(`  … ${hidden} more (near-grays collapsed — show with "all")`)
  lines.push('')
  return lines
}

async function promptMapping(
  extraction: BrandExtraction,
  ask: AskFn,
  log: (message: string) => void,
): Promise<ConfirmedMapping | null> {
  const candidates = extraction.candidates
  log(
    `Brand color candidates from "${extraction.file.name || extraction.file.key}" ` +
      `(${extraction.source.frames.framesScanned} frames scanned):`,
  )
  let showAll = false
  for (const line of renderCandidateTable(candidates, showAll)) log(line)

  const resolveColorAnswer = (answer: string): string | null | 'all' | 'invalid' => {
    const value = answer.trim()
    if (!value) return 'invalid' // empty re-asks — the tool never preselects an answer
    if (value.toLowerCase() === 'all') return 'all'
    if (value.toLowerCase() === 'skip') return null
    if (/^\d+$/.test(value)) {
      const index = Number.parseInt(value, 10) - 1
      return candidates[index] ? candidates[index].hex : 'invalid'
    }
    // parse+format normalization: `#fff` must equal a `#ffffff` candidate.
    const rgb = parseHexColor(value)
    return rgb ? formatHexColor(rgb) : 'invalid'
  }

  // (1) The action color. Nothing proceeds to generation without it.
  let primary: string | null | undefined
  while (primary === undefined) {
    const answer = await ask(
      'Which color is your ACTION color — the one primary buttons and links use?\n(number, hex, or "skip"): ',
    )
    const resolved = resolveColorAnswer(answer)
    if (resolved === 'all') {
      showAll = true
      for (const line of renderCandidateTable(candidates, showAll)) log(line)
      continue
    }
    if (resolved === 'invalid') {
      log('Please answer with a candidate number, a hex value like #0C71C6, or "skip".')
      continue
    }
    primary = resolved
  }
  if (primary === null) return null

  // (2) Optional explicit text-on-primary.
  let primaryForeground: string | null | undefined
  while (primaryForeground === undefined) {
    const answer = await ask('Text-on-primary (--primary-foreground)? (hex, or "skip" to auto-pick): ')
    const value = answer.trim()
    if (!value) { log('Please answer with a hex value or "skip".'); continue }
    if (value.toLowerCase() === 'skip') { primaryForeground = null; continue }
    const rgb = parseHexColor(value)
    if (rgb) { primaryForeground = formatHexColor(rgb); continue }
    log('Please answer with a hex value like #ffffff, or "skip".')
  }

  // (3) Radius — the histogram's dominant bucket is a suggestion, never a default answer.
  const dominantRadius = [...extraction.radii].sort((a, b) => b.count - a.count || a.px - b.px)[0]
  let radius: string | null | undefined
  while (radius === undefined) {
    const suggestion = dominantRadius ? ` (most used in the file: ${dominantRadius.px}px — type it to confirm)` : ''
    const answer = await ask(`Corner radius for --radius?${suggestion} (CSS length like 8px, or "skip"): `)
    const value = answer.trim()
    if (!value) { log('Please answer with a CSS length or "skip".'); continue }
    if (value.toLowerCase() === 'skip') { radius = null; continue }
    const validated = validateRadius(value)
    if (validated.valid) { radius = validated.value; continue }
    log('Please answer with a CSS length like 8px or 0.5rem, or "skip".')
  }

  // (4) Font family — extracted list or free entry.
  if (extraction.fonts.length > 0) {
    log(`Fonts found in the file: ${extraction.fonts.map((font) => `${font.family} (${font.usageCount} uses)`).join(', ')}`)
  }
  let font: string | null | undefined
  while (font === undefined) {
    const answer = await ask('Font family for --font-geist-sans? (family name, or "skip"; loading the font file stays your job): ')
    const value = answer.trim()
    if (!value) { log('Please answer with a font family or "skip".'); continue }
    font = value.toLowerCase() === 'skip' ? null : value
  }

  return { primary, primaryForeground, radius, font, fontMono: null }
}

// ── Orchestration ───────────────────────────────────────────────────────────

function defaultArtifactPath(kind: 'extract' | 'report', key: string): string {
  const name = kind === 'extract' ? `figma-brand-extract-${key}.json` : `figma-brand-import-${key}.md`
  return path.join('.ai', 'reports', name)
}

function writeArtifact(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
}

function buildInitArgs(mapping: ConfirmedMapping, flags: ThemeFromFigmaFlags): string[] {
  const args = ['--primary', mapping.primary]
  if (mapping.primaryForeground) args.push('--primary-foreground', mapping.primaryForeground)
  if (mapping.radius) args.push('--radius', mapping.radius)
  if (mapping.font) args.push('--font', mapping.font)
  if (flags.out) args.push('--out', flags.out)
  if (flags.force) args.push('--force')
  if (flags.dryRun) args.push('--dry-run')
  return args
}

export async function runThemeFromFigma(args: string[], deps: FromFigmaDeps = {}): Promise<number> {
  const flags = parseThemeFromFigmaArgs(args)
  const env = deps.env ?? process.env
  const log = (message: string) => console.log(message)

  if (flags.help) {
    console.log(USAGE)
    return 0
  }
  if (flags.unknown.length > 0) {
    console.error(`Unknown argument(s): ${flags.unknown.join(', ')}`)
    console.error(USAGE)
    return 1
  }
  if (!flags.fileRef) {
    console.error('Missing <file-url-or-key>.')
    console.error(USAGE)
    return 1
  }
  const parsedKey = parseFigmaFileKey(flags.fileRef)
  if ('error' in parsedKey) {
    console.error(`✖ ${parsedKey.error}`)
    return 1
  }
  const fileKey = parsedKey.key

  const extractPath = path.resolve(process.cwd(), flags.extractJson ?? defaultArtifactPath('extract', fileKey))
  const reportPath = path.resolve(process.cwd(), flags.report ?? defaultArtifactPath('report', fileKey))

  // ── Acquire the extraction: reuse an explicit local export, or fetch. ────
  let extraction: BrandExtraction | null = null
  let reusedExtraction = false
  if (flags.extractJson && fs.existsSync(extractPath)) {
    try {
      extraction = readExtraction(extractPath)
    } catch (error) {
      console.error(`✖ ${error instanceof Error ? error.message : String(error)}`)
      return 1
    }
    if (extraction.file.key !== fileKey) {
      console.error(
        `✖ Extraction ${extractPath} is for file "${extraction.file.key}", not "${fileKey}". ` +
          'Point --extract-json at a matching extraction, or remove the file to re-fetch.',
      )
      return 1
    }
    reusedExtraction = true
    log(`Reusing extraction ${extractPath} (extracted ${extraction.file.extractedAt}) — skipping Figma fetch.`)
  } else {
    const token = env.FIGMA_TOKEN
    if (!token) {
      console.error(
        '✖ FIGMA_TOKEN is not set. Create a personal access token with file read scope at ' +
          'figma.com → Settings → Personal access tokens, then export FIGMA_TOKEN in your environment. ' +
          'The token is read from the environment only — never pass it as a flag.',
      )
      return 1
    }
    try {
      extraction = await extractBrand({
        fileKey,
        token,
        pages: flags.pages ? flags.pages.split(',').map((name) => name.trim()).filter(Boolean) : null,
        fetchImpl: deps.fetchImpl,
        sleepImpl: deps.sleepImpl,
        now: deps.now,
        log,
      })
    } catch (error) {
      console.error(`✖ ${error instanceof Error ? error.message : String(error)}`)
      return 1
    }
  }

  // Batches that still failed after retries mean silent gaps in the inventory
  // — say so up front, next to the candidate counts the designer is about to
  // trust. (Older reused extractions may predate the counter; treat as zero.)
  const failedBatches = extraction.source.failedBatches
  if (failedBatches && failedBatches.styles + failedBatches.frames > 0) {
    console.warn(
      `⚠ ${failedBatches.styles + failedBatches.frames} node batch(es) failed after retries ` +
        `(styles: ${failedBatches.styles}, frames: ${failedBatches.frames}) — the scan is incomplete; ` +
        'candidate and usage counts may be undercounted.',
    )
  }

  // ── Select the mode. Never guess a mapping; never auto-finalize one. ─────
  const isTTY = deps.isTTY ?? process.stdin.isTTY === true
  let reportOnly = flags.reportOnly
  if (!reportOnly && !flags.map && !isTTY && !deps.ask) {
    log('No --map given and stdin is not a TTY — degrading to --report-only (the tool never guesses a mapping).')
    reportOnly = true
  }

  const notes: string[] = []
  let mapping: ConfirmedMapping | null = null

  if (!reportOnly) {
    if (flags.map) {
      const parsed = parseMapFlag(flags.map)
      if (parsed.errors.length > 0) {
        for (const message of parsed.errors) console.error(`✖ ${message}`)
        return 1
      }
      for (const warning of parsed.warnings) console.warn(`⚠ ${warning}`)
      mapping = parsed.mapping
    } else {
      let closeAsk: (() => void) | null = null
      let ask = deps.ask
      if (!ask) {
        const stdinAsk = await makeStdinAsk(deps.input, deps.output)
        ask = stdinAsk.ask
        closeAsk = stdinAsk.close
      }
      try {
        mapping = await promptMapping(extraction, ask, log)
      } catch (error) {
        if (error instanceof PromptAbortedError) {
          console.error(
            '✖ Aborted: stdin closed (EOF/Ctrl-D) before the prompt was answered — nothing was written. ' +
              'Re-run and answer the prompts, or pass --map / --report-only for non-interactive use.',
          )
          return 1
        }
        throw error
      } finally {
        closeAsk?.()
      }
      if (!mapping) {
        log('Primary skipped — nothing to generate. Writing the extraction and report only.')
        reportOnly = true
      }
    }
    // A confirmed hex that never appears in the file is a warning, not a
    // failure — brand books sometimes intentionally differ from design files.
    // Applies identically to --map values and interactive free-hex entries.
    if (mapping && !extraction.candidates.some((candidate) => candidate.hex === mapping!.primary)) {
      const note = `Confirmed primary ${mapping.primary} does not appear in the extracted candidates — proceeding (brand books sometimes differ from design files).`
      console.warn(`⚠ ${note}`)
      notes.push(note)
    }
  }

  // ── Derive report data through the shared pipeline helpers. ──────────────
  let palette: DerivedPalette | null = null
  let checks: ContrastCheck[] | null = null
  if (mapping) {
    try {
      palette = derivePalette({ primaryHex: mapping.primary, primaryForegroundHex: mapping.primaryForeground })
      checks = buildContrastChecks(palette)
    } catch (error) {
      console.error(`✖ ${error instanceof Error ? error.message : String(error)}`)
      return 1
    }
  }

  // ── Write artifacts (extraction JSON + markdown report). ─────────────────
  const report = renderBrandReport({ extraction, mapping, palette, checks, notes })
  if (flags.dryRun) {
    log('Dry run: extraction JSON and import report not written.')
  } else {
    if (!reusedExtraction) {
      writeArtifact(extractPath, serializeExtraction(extraction))
      log(`✔ Wrote ${extractPath}`)
    }
    writeArtifact(reportPath, report)
    log(`✔ Wrote ${reportPath}`)
  }

  if (reportOnly || !mapping) {
    // An audit is not a failure — exit 0 even when candidates look unusable.
    log('Report-only: theme.css not written.')
    return 0
  }

  if (mapping.fontMono) {
    console.warn(
      '⚠ font-mono is recorded in the report only — the shared generator does not emit --font-geist-mono; add it to theme.css by hand.',
    )
  }

  // ── Generation: the theme init pipeline, verbatim. ───────────────────────
  return runThemeInit(buildInitArgs(mapping, flags))
}

/**
 * Readline-backed prompt with EOF safety: closing the input stream (Ctrl-D)
 * while a question is pending rejects with `PromptAbortedError` instead of
 * leaving the promise unsettled (which would let the process exit 0 silently).
 * Exported for tests; streams default to the real stdin/stdout.
 */
export async function makeStdinAsk(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<{ ask: AskFn; close: () => void }> {
  const { createInterface } = await import('node:readline/promises')
  const rl = createInterface({ input, output })
  let closedDeliberately = false
  const aborted = new Promise<never>((_, reject) => {
    rl.once('close', () => {
      if (!closedDeliberately) reject(new PromptAbortedError())
    })
  })
  // Pre-attach a no-op handler so the rejection is never "unhandled" when it
  // fires outside a pending question.
  aborted.catch(() => {})
  return {
    ask: (question: string) => Promise.race([rl.question(question), aborted]),
    close: () => {
      closedDeliberately = true
      rl.close()
    },
  }
}
