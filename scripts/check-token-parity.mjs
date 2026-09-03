#!/usr/bin/env node
/**
 * Token parity + contrast check for globals.css.
 *
 * Three guarantees, none of which light-dark() would give us for free:
 *  1. Parity — every themed token defined in :root has a .dark override
 *     (and vice versa), with an explicit allowlist for the tokens that are
 *     theme-invariant on purpose. Works retroactively on all tokens.
 *  2. Template sync — apps/mercato globals.css and the create-app template
 *     copy stay identical modulo @source path depth.
 *  3. Contrast — every --X / --X-foreground pair is checked against WCAG
 *     ratios in BOTH themes, so "looks fine in light, unreadable in dark"
 *     fails here instead of in someone's screenshot.
 *
 * Zero dependencies. Exit 1 on failure so it can gate CI on changed files.
 */
import fs from 'node:fs'
import path from 'node:path'

/* --root lets the script test itself: scripts/__tests__/check-token-parity.test.mjs
 * points it at synthetic fixtures to prove each check still fails when it should. */
const rootFlagIndex = process.argv.indexOf('--root')
const ROOT = rootFlagIndex >= 0 && process.argv[rootFlagIndex + 1]
  ? path.resolve(process.argv[rootFlagIndex + 1])
  : path.resolve(import.meta.dirname, '..')
const APP_CSS = path.join(ROOT, 'apps/mercato/src/app/globals.css')
const TEMPLATE_CSS = path.join(ROOT, 'packages/create-app/template/src/app/globals.css')

/* Tokens that intentionally have no .dark override. Keep this list in sync
 * with the "theme-invariant" comments in globals.css — an entry here without
 * a comment there (or the reverse) should be treated as a review question. */
const THEME_INVARIANT = new Set([
  'font-geist-sans', 'font-geist-mono', 'radius',
  'brand-lime', 'brand-lime-foreground', 'brand-yellow',
  'brand-apple', 'brand-github', 'brand-x', 'brand-google-stroke',
  'brand-facebook', 'brand-dropbox', 'brand-linkedin',
])

/* Tokens whose base lives in @theme and is only overridden in .dark
 * (dark-only entries are fine for these prefixes). */
const DARK_ONLY_OK = [/^shadow-/]

/* Pairs checked for contrast: background token -> foreground token.
 * Derived automatically from the --X / --X-foreground convention, plus the
 * global page pair. Text-on-background pairs use AA normal text (4.5); pairs
 * marked `ui` are large/bold or non-text UI surfaces where 3.0 applies. */
const EXTRA_PAIRS = [{ bg: 'background', fg: 'foreground', min: 4.5 }]
/* accent-indigo backs selection controls (checkbox/radio/switch — see the
 * comment in globals.css), so the WCAG non-text UI threshold (3.0) applies,
 * not the 4.5 for body text. */
const UI_PAIRS = new Set(['border', 'input', 'ring', 'accent-indigo'])

// ---------------------------------------------------------------- parsing

function parseBlock(css, header) {
  // Match the selector at line start — a plain indexOf would hit occurrences
  // inside comments ("no .dark override") and parse the wrong block.
  const m = new RegExp(`^${header.replace('.', '\\.')}\\s*\\{`, 'm').exec(css)
  if (!m) return null
  const start = m.index
  let depth = 0, i = css.indexOf('{', start)
  const open = i
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) break
  }
  const body = css.slice(open + 1, i)
  const tokens = new Map()
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    tokens.set(m[1], m[2].trim())
  }
  return tokens
}

// ------------------------------------------------------- color -> sRGB

function srgbFromOklch(l, c, hDeg) {
  const h = (hDeg * Math.PI) / 180
  const a = c * Math.cos(h), b = c * Math.sin(h)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
  return lin.map((v) => {
    v = Math.min(1, Math.max(0, v))
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
  })
}

function parseColor(value) {
  let m = value.match(/^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.%]+)?\s*\)$/i)
  if (m) {
    const l = m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1])
    return srgbFromOklch(l, parseFloat(m[2]), parseFloat(m[3]))
  }
  m = value.match(/^#([0-9a-f]{6})$/i)
  if (m) return [0, 1, 2].map((i) => parseInt(m[1].slice(i * 2, i * 2 + 2), 16) / 255)
  m = value.match(/^#([0-9a-f]{3})$/i)
  if (m) return [...m[1]].map((ch) => parseInt(ch + ch, 16) / 255)
  m = value.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i)
  if (m) return [m[1], m[2], m[3]].map((v) => v / 255)
  return null // var() chains, gradients, non-color values — skipped
}

function contrast(rgb1, rgb2) {
  const lum = ([r, g, b]) => {
    const f = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const [a, b] = [lum(rgb1) + 0.05, lum(rgb2) + 0.05]
  return a > b ? a / b : b / a
}

// ---------------------------------------------------------------- checks

const css = fs.readFileSync(APP_CSS, 'utf8')
const root = parseBlock(css, ':root')
const dark = parseBlock(css, '.dark')
let failures = 0
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`) }

console.log(`token parity — ${path.relative(ROOT, APP_CSS)}`)
console.log(`  :root ${root.size} tokens, .dark ${dark.size} tokens`)

// 1. Parity
for (const name of root.keys()) {
  if (name === 'color-scheme') continue
  if (!dark.has(name) && !THEME_INVARIANT.has(name)) {
    fail(`--${name} defined in :root has no .dark override and is not on the theme-invariant allowlist`)
  }
}
for (const name of dark.keys()) {
  if (name === 'color-scheme') continue
  if (!root.has(name) && !DARK_ONLY_OK.some((re) => re.test(name))) {
    fail(`--${name} defined in .dark has no :root base (and is not a known @theme-based override)`)
  }
}
for (const name of THEME_INVARIANT) {
  if (dark.has(name)) fail(`--${name} is allowlisted as theme-invariant but .dark overrides it — update the allowlist or drop the override`)
  if (!root.has(name)) console.warn(`  ⚠ allowlist entry --${name} no longer exists in :root — prune it`)
}

// 2. Template sync
const normalize = (s) => s.replace(/@source\s+"[^"]*"/g, '@source "<path>"')
if (normalize(fs.readFileSync(TEMPLATE_CSS, 'utf8')) !== normalize(css)) {
  fail(`${path.relative(ROOT, TEMPLATE_CSS)} has drifted from the app globals.css (differences beyond @source depth)`)
} else {
  console.log('  ✓ create-app template copy in sync')
}

// 3. Contrast, both themes
const pairs = [...EXTRA_PAIRS]
for (const name of root.keys()) {
  if (name.endsWith('-foreground')) {
    const bg = name.slice(0, -'-foreground'.length)
    if (root.has(bg)) pairs.push({ bg, fg: name, min: UI_PAIRS.has(bg) ? 3.0 : 4.5 })
  }
}
let checked = 0, skipped = []
for (const theme of [{ label: 'light', map: root }, { label: 'dark', map: dark }]) {
  for (const { bg, fg, min } of pairs) {
    const bgv = theme.map.get(bg) ?? root.get(bg)
    const fgv = theme.map.get(fg) ?? root.get(fg)
    const c1 = parseColor(bgv ?? ''), c2 = parseColor(fgv ?? '')
    if (!c1 || !c2) { skipped.push(`${theme.label}:${bg}`); continue }
    checked++
    const ratio = contrast(c1, c2)
    if (ratio < min) fail(`[${theme.label}] --${fg} on --${bg}: contrast ${ratio.toFixed(2)} < ${min} (${fgv} on ${bgv})`)
  }
}
console.log(`  ✓ contrast checked on ${checked} theme×pair combinations${skipped.length ? ` (${skipped.length} skipped: non-literal values)` : ''}`)

if (failures) {
  console.error(`\n${failures} failure(s).`)
  process.exit(1)
}
console.log('\nAll checks passed.')
