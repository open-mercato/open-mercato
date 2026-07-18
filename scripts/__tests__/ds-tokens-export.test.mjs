import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildFigmaOps,
  buildSnapshot,
  classifyValue,
  colorToHex,
  countDriftedTokens,
  diffSnapshots,
  extractBlocks,
  figmaFor,
  hexToRgba,
  resolveRadiusPx,
  serializeSnapshot,
  SOURCE_CSS,
} from '../ds-tokens-export.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const FIXTURE = `@import "tailwindcss";

@theme inline {
  --color-brand-lime: var(--brand-lime);
  --color-status-error-bg: var(--status-error-bg);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --font-sans: var(--font-geist-sans);
  --z-index-modal-elevated: 55;
  --font-size-overline: 0.6875rem;
  --shadow-xs:  0 1px 2px rgb(16 24 40 / 0.05);
  /* Figma button focus */
  --shadow-focus: 0 0 0 2px var(--focus-ring-inner), 0 0 0 4px var(--focus-ring-outer);
}

:root {
  color-scheme: light;
  --font-geist-sans: ui-sans-serif, system-ui, sans-serif;
  --radius: 0.625rem;
  /* Brand lime — theme-invariant (no .dark override). */
  --brand-lime: #B4F372;
  --focus-ring-inner: rgba(255, 255, 255, 1);
  --status-error-bg: oklch(0.971 0.013 17.38);     /* red-50  #fef2f2 */
  --accent-indigo: #6366f1;
}

.dark {
  color-scheme: dark;
  --shadow-xs:  0 1px 2px rgb(0 0 0 / 0.30);
  --focus-ring-inner: var(--background);
  --status-error-bg: oklch(0.258 0.092 26.042);
  --accent-indigo: #818cf8;
}
`

test('extractBlocks finds exactly the three token blocks', () => {
  const blocks = extractBlocks(FIXTURE)
  assert.deepEqual(Object.keys(blocks), ['theme', 'root', 'dark'])
  assert.ok(blocks.theme.length > 0)
  assert.throws(() => extractBlocks('body { color: red; }'), /block not found/)
})

test('braces inside comments do not break block extraction', () => {
  const withComment = FIXTURE.replace(
    '--accent-indigo: #6366f1;',
    '/* mirrors Figma state/{x}/{base,light,lighter} */\n  --accent-indigo: #6366f1;',
  )
  const snapshot = buildSnapshot(withComment)
  assert.equal(snapshot.tokens['accent-indigo'].note, 'mirrors Figma state/{x}/{base,light,lighter}')
})

test('classifyValue covers every authored value shape', () => {
  assert.equal(classifyValue('brand-lime', '#B4F372'), 'color')
  assert.equal(classifyValue('status-error-bg', 'oklch(0.971 0.013 17.38)'), 'color')
  assert.equal(classifyValue('focus-ring-outer', 'rgba(153, 160, 174, 0.16)'), 'color')
  assert.equal(classifyValue('z-index-toast', '50'), 'number')
  assert.equal(classifyValue('radius-md', 'calc(var(--radius) - 2px)'), 'expression')
  assert.equal(classifyValue('radius', '0.625rem'), 'dimension')
  assert.equal(classifyValue('color-border', 'var(--border)'), 'reference')
  assert.equal(classifyValue('shadow-md', '0 4px 12px rgb(16 24 40 / 0.08)'), 'shadow')
  assert.equal(classifyValue('font-geist-mono', 'ui-monospace, Menlo, monospace'), 'fontStack')
  assert.throws(() => classifyValue('mystery', 'url(#nope)'), /cannot classify/)
})

test('colorToHex converts hex, oklch, rgb and rgba forms', () => {
  assert.equal(colorToHex('#B4F372'), '#b4f372')
  assert.equal(colorToHex('#fff'), '#ffffff')
  assert.equal(colorToHex('oklch(0.971 0.013 17.38)'), '#fef2f2')
  assert.equal(colorToHex('oklch(1 0 0)'), '#ffffff')
  assert.equal(colorToHex('oklch(1 0 0 / 10%)'), '#ffffff1a')
  assert.equal(colorToHex('rgb(16 24 40 / 0.05)'), '#1018280d')
  assert.equal(colorToHex('rgba(255, 255, 255, 1)'), '#ffffff')
  assert.equal(colorToHex('var(--background)'), null)
})

test('figmaFor applies the deterministic prefix table', () => {
  assert.deepEqual(figmaFor('status-error-bg', 'color'), { name: 'status/error/bg', type: 'COLOR' })
  assert.deepEqual(figmaFor('chart-blue', 'color'), { name: 'chart/blue', type: 'COLOR' })
  assert.deepEqual(figmaFor('brand-lime', 'color'), { name: 'brand/lime', type: 'COLOR' })
  assert.deepEqual(figmaFor('accent-indigo-foreground', 'color'), { name: 'accent/indigo-foreground', type: 'COLOR' })
  assert.deepEqual(figmaFor('z-index-modal-elevated', 'number'), { name: 'z/modal-elevated', type: 'FLOAT' })
  assert.deepEqual(figmaFor('radius-md', 'expression'), { name: 'radius/md', type: 'FLOAT' })
  assert.deepEqual(figmaFor('background', 'color'), { name: 'background', type: 'COLOR' })
  assert.equal(figmaFor('shadow-focus', 'shadow'), null)
  assert.equal(figmaFor('font-geist-sans', 'fontStack'), null)
})

test('resolveRadiusPx resolves the calc expressions against the 0.625rem base', () => {
  assert.equal(resolveRadiusPx('var(--radius)'), 10)
  assert.equal(resolveRadiusPx('calc(var(--radius) - 2px)'), 8)
  assert.equal(resolveRadiusPx('calc(var(--radius) + 6px)'), 16)
  assert.equal(resolveRadiusPx('calc(100% - 2px)'), null)
})

test('buildSnapshot detects theme invariance from the file, not a hardcoded list', () => {
  const snapshot = buildSnapshot(FIXTURE)
  assert.equal(snapshot.tokens['brand-lime'].themeInvariant, true)
  assert.equal(snapshot.tokens['brand-lime'].dark, null)
  assert.equal(snapshot.tokens['status-error-bg'].themeInvariant, false)
  assert.equal(snapshot.tokens['accent-indigo'].themeInvariant, false)
})

test('buildSnapshot folds @theme aliases into the underlying token', () => {
  const snapshot = buildSnapshot(FIXTURE)
  assert.equal(snapshot.tokens['brand-lime'].themeAlias, 'color-brand-lime')
  assert.equal(snapshot.tokens['status-error-bg'].themeAlias, 'color-status-error-bg')
  assert.equal(snapshot.tokens['font-geist-sans'].themeAlias, 'font-sans')
  assert.equal(snapshot.tokens['color-brand-lime'], undefined)
})

test('buildSnapshot keeps radius references as FLOAT-resolvable expressions, not aliases', () => {
  const snapshot = buildSnapshot(FIXTURE)
  assert.equal(snapshot.tokens['radius-lg'].kind, 'expression')
  assert.equal(snapshot.tokens['radius-lg'].resolvedPx, 10)
  assert.equal(snapshot.tokens['radius-md'].resolvedPx, 8)
  assert.equal(snapshot.tokens.radius.resolvedPx, 10)
})

test('buildSnapshot captures notes from preceding and trailing comments', () => {
  const snapshot = buildSnapshot(FIXTURE)
  assert.equal(snapshot.tokens['brand-lime'].note, 'Brand lime — theme-invariant (no .dark override).')
  assert.equal(snapshot.tokens['status-error-bg'].note, 'red-50 #fef2f2')
  assert.equal(snapshot.tokens['shadow-focus'].note, 'Figma button focus')
})

test('non-resolvable colors and shadows stay snapshot-only (figma: null)', () => {
  const snapshot = buildSnapshot(FIXTURE)
  assert.equal(snapshot.tokens['focus-ring-inner'].figma, null)
  assert.equal(snapshot.tokens['focus-ring-inner'].hex.dark, null)
  assert.equal(snapshot.tokens['shadow-xs'].figma, null)
  assert.equal(snapshot.tokens['shadow-xs'].themeInvariant, false)
})

test('unparseable content inside a token block is a hard error, never a silent skip', () => {
  assert.throws(() => buildSnapshot(FIXTURE.replace('--accent-indigo: #6366f1;', '--broken value here')), /unparseable line/)
  assert.throws(() => buildSnapshot(FIXTURE.replace('color-scheme: light;', 'display: block;')), /non-token declaration/)
  assert.throws(
    () => buildSnapshot(FIXTURE.replace('--color-brand-lime: var(--brand-lime);', '--color-ghost: var(--ghost);')),
    /missing token/,
  )
})

test('serializeSnapshot is deterministic and byte-stable across runs', () => {
  const first = serializeSnapshot(buildSnapshot(FIXTURE))
  const second = serializeSnapshot(buildSnapshot(FIXTURE))
  assert.equal(first, second)
  assert.ok(first.endsWith('\n'))
  const keys = Object.keys(JSON.parse(first).tokens)
  assert.deepEqual(keys, [...keys].sort())
})

test('diffSnapshots names the drifted token and field; count collapses per token', () => {
  const committed = buildSnapshot(FIXTURE)
  const live = buildSnapshot(FIXTURE.replace('#B4F372', '#D4F372'))
  const diffs = diffSnapshots(committed, live)
  assert.ok(diffs.some((diff) => diff.token === 'brand-lime' && diff.field === 'light'))
  assert.equal(countDriftedTokens(diffs), 1)
  assert.deepEqual(diffSnapshots(committed, buildSnapshot(FIXTURE)), [])
})

test('buildFigmaOps emits RGBA colors and FLOAT scalars with WEB code syntax', () => {
  const ops = buildFigmaOps(buildSnapshot(FIXTURE)).ops
  const lime = ops.find((op) => op.name === 'brand/lime')
  assert.equal(lime.resolvedType, 'COLOR')
  assert.deepEqual(lime.valuesByMode.Light, lime.valuesByMode.Dark)
  assert.equal(lime.codeSyntax.WEB, 'var(--brand-lime)')
  const z = ops.find((op) => op.name === 'z/modal-elevated')
  assert.deepEqual(z.valuesByMode, { Light: 55, Dark: 55 })
  const radius = ops.find((op) => op.name === 'radius/md')
  assert.deepEqual(radius.valuesByMode, { Light: 8, Dark: 8 })
  assert.equal(ops.find((op) => op.name === 'focus-ring-inner'), undefined)
})

test('hexToRgba round-trips 6- and 8-digit hex', () => {
  assert.deepEqual(hexToRgba('#ffffff'), { r: 1, g: 1, b: 1, a: 1 })
  assert.deepEqual(hexToRgba('#00000080'), { r: 0, g: 0, b: 0, a: 0.502 })
})

test('the real globals.css parses end to end and matches the committed snapshot', () => {
  const css = fs.readFileSync(path.join(ROOT, SOURCE_CSS), 'utf8')
  const live = buildSnapshot(css)
  assert.ok(Object.keys(live.tokens).length >= 100)
  assert.equal(live.tokens['brand-lime'].light, '#B4F372')
  assert.equal(live.tokens['brand-violet'].themeInvariant, true)
  const committedPath = path.join(ROOT, '.ai/ds/ds-tokens.json')
  const committed = JSON.parse(fs.readFileSync(committedPath, 'utf8'))
  assert.deepEqual(diffSnapshots(committed, live), [])
})
