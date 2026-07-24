/**
 * `mercato theme init` — generates a validated `theme.css` brand override file.
 *
 * Pure file generation: no database, DI container, or env bootstrap, so the
 * command stays runnable in a freshly scaffolded app before `yarn setup`.
 *
 * Exit codes: 0 success (warnings allowed), 1 validation failure (contrast
 * below the hard threshold, unparseable color, existing file without --force).
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  contrastRatio,
  formatContrastRatio,
  parseHexColor,
  WCAG_AA_TEXT,
  WCAG_AA_UI,
} from './contrast'
import {
  derivePalette,
  oklchToHex,
  PROTECTED_TOKEN_PATTERNS,
  renderThemeCss,
  validateRadius,
  type DerivedPalette,
  type ForegroundPick,
} from './palette'

const USAGE = `Usage: mercato theme init --primary "#0C71C6" [options]

  --primary <hex>              required; brand primary (#RGB, #RRGGBB)
  --primary-foreground <hex>   optional; text-on-primary (default: auto-picked)
  --radius <value>             optional; CSS length for --radius (e.g. 8px, 0.5rem)
  --font <family>              optional; font family for --font-geist-sans
  --out <path>                 optional; default src/app/theme.css
  --force                      overwrite an existing theme.css
  --dry-run                    print the generated CSS + contrast report, write nothing`

/** Default light `--background` (globals.css: oklch(1 0 0)). */
const LIGHT_BACKGROUND_HEX = '#ffffff'
/** Default dark `--background` (globals.css: oklch(0.145 0 0)). */
const DARK_BACKGROUND_HEX = oklchToHex({ l: 0.145, c: 0, h: 0 })

const GLOBALS_IMPORT_ANCHOR = "import './globals.css'"
const THEME_IMPORT_LINE = "import './theme.css'"

export type ThemeInitFlags = {
  primary: string | null
  primaryForeground: string | null
  radius: string | null
  font: string | null
  out: string | null
  force: boolean
  dryRun: boolean
  help: boolean
  unknown: string[]
}

export function parseThemeInitArgs(args: string[]): ThemeInitFlags {
  const flags: ThemeInitFlags = {
    primary: null,
    primaryForeground: null,
    radius: null,
    font: null,
    out: null,
    force: false,
    dryRun: false,
    help: false,
    unknown: [],
  }
  const valueFlags: Record<string, keyof Pick<ThemeInitFlags, 'primary' | 'primaryForeground' | 'radius' | 'font' | 'out'>> = {
    '--primary': 'primary',
    '--primary-foreground': 'primaryForeground',
    '--radius': 'radius',
    '--font': 'font',
    '--out': 'out',
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--force') { flags.force = true; continue }
    if (arg === '--dry-run') { flags.dryRun = true; continue }
    if (arg === '--help' || arg === '-h') { flags.help = true; continue }
    const equalsIndex = arg.indexOf('=')
    const name = equalsIndex >= 0 ? arg.slice(0, equalsIndex) : arg
    const target = valueFlags[name]
    if (target) {
      if (equalsIndex >= 0) {
        flags[target] = arg.slice(equalsIndex + 1)
      } else {
        const next = args[i + 1]
        if (next !== undefined) {
          flags[target] = next
          i += 1
        } else {
          flags.unknown.push(`${name} (missing value)`)
        }
      }
      continue
    }
    flags.unknown.push(arg)
  }
  return flags
}

export type CheckVerdict = 'pass' | 'warn' | 'fail'

export type ContrastCheck = {
  mode: 'light' | 'dark'
  pair: string
  ratio: number
  threshold: number
  verdict: CheckVerdict
  detail?: string
}

function classifyForeground(pick: ForegroundPick, mode: 'light' | 'dark', primaryHex: string): ContrastCheck {
  let verdict: CheckVerdict = 'pass'
  let detail: string | undefined
  if (pick.autoPicked) {
    // Auto-pick warns below AA and refuses only below 3:1 — a color that
    // hostile to both black and white does not exist in sRGB, so in practice
    // auto-pick always succeeds; the fail branch exists for correctness.
    if (pick.ratio < WCAG_AA_UI) verdict = 'fail'
    else if (pick.ratio < WCAG_AA_TEXT) {
      verdict = 'warn'
      detail = 'auto-picked foreground is below AA — consider a darker or lighter primary'
    }
  } else if (pick.ratio < WCAG_AA_TEXT) {
    verdict = 'fail'
  }
  return {
    mode,
    pair: `--primary-foreground (${pick.hex}) on --primary (${primaryHex})`,
    ratio: pick.ratio,
    threshold: WCAG_AA_TEXT,
    verdict,
    detail,
  }
}

function checkPrimaryOnBackground(primaryHex: string, backgroundHex: string, mode: 'light' | 'dark'): ContrastCheck | null {
  const primary = parseHexColor(primaryHex)
  const background = parseHexColor(backgroundHex)
  if (!primary || !background) return null
  const ratio = contrastRatio(primary, background)
  return {
    mode,
    pair: `--primary against --background (${backgroundHex})`,
    ratio,
    threshold: WCAG_AA_UI,
    verdict: ratio < WCAG_AA_UI ? 'warn' : 'pass',
    detail: ratio < WCAG_AA_UI
      ? 'outline buttons, links, and focus-adjacent uses may be hard to see'
      : undefined,
  }
}

export function buildContrastChecks(palette: DerivedPalette): ContrastCheck[] {
  const checks: ContrastCheck[] = [
    classifyForeground(palette.light.primaryForeground, 'light', palette.light.primary),
    classifyForeground(palette.dark.primaryForeground, 'dark', palette.dark.primary),
  ]
  const lightBackground = checkPrimaryOnBackground(palette.light.primary, LIGHT_BACKGROUND_HEX, 'light')
  if (lightBackground) checks.push(lightBackground)
  const darkBackground = checkPrimaryOnBackground(palette.dark.primary, DARK_BACKGROUND_HEX, 'dark')
  if (darkBackground) checks.push(darkBackground)
  return checks
}

function printContrastReport(checks: ContrastCheck[]): void {
  console.log('Contrast report (WCAG 2.1):')
  for (const check of checks) {
    const marker = check.verdict === 'pass' ? '✔' : check.verdict === 'warn' ? '⚠' : '✖'
    const requirement = `requires ${formatContrastRatio(check.threshold)}`
    console.log(
      `  ${marker} [${check.mode}] ${check.pair} — ${formatContrastRatio(check.ratio)} (${requirement}, ${check.verdict})`,
    )
    if (check.detail) console.log(`      ${check.detail}`)
  }
}

function printFailure(palette: DerivedPalette, failed: ContrastCheck): void {
  const primary = palette.light.primary
  const primaryRgb = parseHexColor(primary)
  let suggestion = 'pick a darker or lighter primary.'
  if (primaryRgb) {
    const white = parseHexColor('#ffffff')!
    const black = parseHexColor('#0a0a0a')!
    const whiteRatio = contrastRatio(white, primaryRgb)
    const blackRatio = contrastRatio(black, primaryRgb)
    const best = whiteRatio >= blackRatio
      ? { hex: '#ffffff', ratio: whiteRatio }
      : { hex: '#0a0a0a', ratio: blackRatio }
    if (best.ratio >= failed.threshold) {
      suggestion = `use --primary-foreground "${best.hex}" (${formatContrastRatio(best.ratio)}), or pick a darker primary.`
    }
  }
  console.error(
    `✖ Contrast check failed: ${failed.pair} is ${formatContrastRatio(failed.ratio)} — ` +
      `WCAG AA requires ${formatContrastRatio(failed.threshold)} for text.`,
  )
  console.error(`  Suggestion: ${suggestion}`)
}

/** Scans an existing theme.css for protected-token overrides (warn-only). */
export function findProtectedTokenOverrides(css: string): string[] {
  const found = new Set<string>()
  const declaration = /(--[a-z0-9-]+)\s*:/gi
  let match: RegExpExecArray | null
  while ((match = declaration.exec(css)) !== null) {
    const token = match[1].toLowerCase()
    if (PROTECTED_TOKEN_PATTERNS.some((pattern) =>
      pattern.endsWith('-') ? token.startsWith(pattern) : token === pattern || token.startsWith(`${pattern}-`),
    )) {
      found.add(token)
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b))
}

/** Extracts a token's first declared hex value from CSS, if any. */
function extractHexToken(css: string, token: string): string | null {
  const pattern = new RegExp(`${token}\\s*:\\s*(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)\\s*[;}]`)
  const match = pattern.exec(css)
  return match ? match[1] : null
}

function warnExistingBrandViolet(css: string): void {
  const violet = extractHexToken(css, '--brand-violet')
  const violetForeground = extractHexToken(css, '--brand-violet-foreground')
  if (!violet || !violetForeground) return
  const violetRgb = parseHexColor(violet)
  const foregroundRgb = parseHexColor(violetForeground)
  if (!violetRgb || !foregroundRgb) return
  const ratio = contrastRatio(violetRgb, foregroundRgb)
  if (ratio < WCAG_AA_TEXT) {
    console.warn(
      `⚠ Existing theme.css: --brand-violet-foreground (${violetForeground}) on --brand-violet (${violet}) ` +
        `is ${formatContrastRatio(ratio)} — below the ${formatContrastRatio(WCAG_AA_TEXT)} AA threshold. ` +
        'These values are not regenerated; review them manually.',
    )
  }
}

export type LayoutImportResult =
  | { status: 'already-imported' }
  | { status: 'inserted' }
  | { status: 'ordering-warning' }
  | { status: 'anchor-missing' }
  | { status: 'layout-missing' }

/**
 * Idempotently ensures `layout.tsx` imports `./theme.css` directly after the
 * `import './globals.css'` anchor. Never rewrites layout structure: when the
 * anchor is missing it only reports the exact line to add.
 */
export function ensureLayoutImport(layoutPath: string): LayoutImportResult {
  if (!fs.existsSync(layoutPath)) return { status: 'layout-missing' }
  const content = fs.readFileSync(layoutPath, 'utf8')
  const themeIndex = content.indexOf('./theme.css')
  const globalsIndex = content.indexOf('./globals.css')
  if (themeIndex >= 0) {
    // Re-check anchor position on re-runs: theme.css imported before
    // globals.css silently disables every override.
    if (globalsIndex >= 0 && themeIndex < globalsIndex) {
      return { status: 'ordering-warning' }
    }
    return { status: 'already-imported' }
  }
  if (globalsIndex < 0) return { status: 'anchor-missing' }
  const lines = content.split('\n')
  const anchorLineIndex = lines.findIndex((line) => line.includes('./globals.css') && line.trimStart().startsWith('import'))
  if (anchorLineIndex < 0) return { status: 'anchor-missing' }
  lines.splice(anchorLineIndex + 1, 0, THEME_IMPORT_LINE)
  fs.writeFileSync(layoutPath, lines.join('\n'), 'utf8')
  return { status: 'inserted' }
}

async function resolveDefaultOutPath(): Promise<string> {
  try {
    // Lazy import keeps `theme init` free of any bootstrap dependency; the
    // resolver only does filesystem detection (monorepo vs standalone).
    const { createResolver } = await import('../resolver')
    return path.join(createResolver().getAppDir(), 'src', 'app', 'theme.css')
  } catch {
    return path.join(process.cwd(), 'src', 'app', 'theme.css')
  }
}

export async function runThemeInit(args: string[]): Promise<number> {
  const flags = parseThemeInitArgs(args)

  if (flags.help) {
    console.log(USAGE)
    return 0
  }
  if (flags.unknown.length > 0) {
    console.error(`Unknown argument(s): ${flags.unknown.join(', ')}`)
    console.error(USAGE)
    return 1
  }
  if (!flags.primary) {
    console.error('Missing required flag: --primary <hex>')
    console.error(USAGE)
    return 1
  }

  let palette: DerivedPalette
  try {
    palette = derivePalette({
      primaryHex: flags.primary,
      primaryForegroundHex: flags.primaryForeground,
    })
  } catch (error) {
    console.error(`✖ ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }

  let radiusValue: string | null = null
  if (flags.radius) {
    const radius = validateRadius(flags.radius)
    if (!radius.valid) {
      console.error(`✖ Invalid --radius value "${flags.radius}". Expected a CSS length like 8px or 0.5rem.`)
      return 1
    }
    radiusValue = radius.value
    for (const warning of radius.warnings) console.warn(`⚠ ${warning}`)
  }

  const checks = buildContrastChecks(palette)
  const css = renderThemeCss({ palette, radius: radiusValue, fontFamily: flags.font ?? null })

  if (flags.dryRun) {
    console.log(css)
  }
  printContrastReport(checks)

  const failed = checks.find((check) => check.verdict === 'fail')
  if (failed) {
    printFailure(palette, failed)
    return 1
  }

  if (flags.dryRun) {
    console.log('Dry run: nothing written.')
    return 0
  }

  const outPath = flags.out ? path.resolve(process.cwd(), flags.out) : await resolveDefaultOutPath()

  if (fs.existsSync(outPath)) {
    const existing = fs.readFileSync(outPath, 'utf8')
    const existingHasContent = existing.replace(/\/\*[\s\S]*?\*\//g, '').trim().length > 0
    if (!flags.force && existingHasContent) {
      console.error(`✖ ${outPath} already exists. Re-run with --force to overwrite it.`)
      return 1
    }
    if (existingHasContent) {
      const protectedTokens = findProtectedTokenOverrides(existing)
      if (protectedTokens.length > 0) {
        console.warn(
          `⚠ Existing theme.css overrides protected tokens (${protectedTokens.join(', ')}). ` +
            'These are semantic contracts (see the docs) and such overrides are unsupported; they will be removed by the regenerated file.',
        )
      }
      warnExistingBrandViolet(existing)
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, css, 'utf8')
  console.log(`✔ Wrote ${outPath}`)

  const layoutPath = path.join(path.dirname(outPath), 'layout.tsx')
  const layoutResult = ensureLayoutImport(layoutPath)
  switch (layoutResult.status) {
    case 'inserted':
      console.log(`✔ Added \`${THEME_IMPORT_LINE}\` after \`${GLOBALS_IMPORT_ANCHOR}\` in ${layoutPath}`)
      break
    case 'already-imported':
      console.log(`✔ ${layoutPath} already imports ./theme.css`)
      break
    case 'ordering-warning':
      console.warn(
        `⚠ ${layoutPath} imports ./theme.css BEFORE ./globals.css — the overrides are silently disabled. ` +
          `Move \`${THEME_IMPORT_LINE}\` directly below \`${GLOBALS_IMPORT_ANCHOR}\`.`,
      )
      break
    case 'anchor-missing':
      console.warn(
        `⚠ Could not find the \`${GLOBALS_IMPORT_ANCHOR}\` anchor in ${layoutPath}. ` +
          `Add \`${THEME_IMPORT_LINE}\` yourself, directly after the line that imports globals.css.`,
      )
      break
    case 'layout-missing':
      console.warn(
        `⚠ No layout.tsx found next to ${outPath}. ` +
          `Add \`${THEME_IMPORT_LINE}\` to your root layout, directly after \`${GLOBALS_IMPORT_ANCHOR}\`.`,
      )
      break
  }

  console.log('Theme generated. Restart the dev server to see the new brand colors.')
  return 0
}
