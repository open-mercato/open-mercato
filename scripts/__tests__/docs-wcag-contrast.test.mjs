import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * WCAG AA contrast-ratio validation for the docs site custom CSS.
 *
 * Parses color tokens from apps/docs/src/css/custom.css and asserts every
 * foreground/background pair meets the required contrast ratio:
 *   - 4.5:1 for normal text (WCAG AA)
 *   - 3.0:1 for large text and non-text UI elements (WCAG AA)
 *
 * Covers both light and dark modes, including hero gradient stops and
 * semi-transparent button borders blended onto their backgrounds.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CSS_PATH = path.join(ROOT, 'apps/docs/src/css/custom.css')
const css = fs.readFileSync(CSS_PATH, 'utf-8')

// ── color math ───────────────────────────────────────────────────────

function srgbToLinear(channel) {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

function contrastRatio(a, b) {
  let l1 = luminance(a)
  let l2 = luminance(b)
  if (l1 < l2) [l1, l2] = [l2, l1]
  return (l1 + 0.05) / (l2 + 0.05)
}

function blendRgba(fgHex, alpha, bgHex) {
  const fg = fgHex.replace('#', '')
  const bg = bgHex.replace('#', '')
  const r = Math.round(parseInt(fg.slice(0, 2), 16) * alpha + parseInt(bg.slice(0, 2), 16) * (1 - alpha))
  const g = Math.round(parseInt(fg.slice(2, 4), 16) * alpha + parseInt(bg.slice(2, 4), 16) * (1 - alpha))
  const b = Math.round(parseInt(fg.slice(4, 6), 16) * alpha + parseInt(bg.slice(4, 6), 16) * (1 - alpha))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

// ── CSS parsing ──────────────────────────────────────────────────────

function extractVar(name, scope = 'root') {
  const scopeRe = scope === 'root'
    ? /:root\s*\{([^}]+)\}/s
    : /html\[data-theme=['"]dark['"]\]\s*\{([^}]+)\}/s
  const scopeMatch = css.match(scopeRe)
  if (!scopeMatch) return null
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const varRe = new RegExp(`${escaped}:\\s*(#[0-9a-fA-F]{6})`)
  const match = scopeMatch[1].match(varRe)
  return match ? match[1] : null
}

function extractGradientStops(scope = 'root') {
  const scopeRe = scope === 'root'
    ? /:root\s*\{([^}]+)\}/s
    : /html\[data-theme=['"]dark['"]\]\s*\{([^}]+)\}/s
  const scopeMatch = css.match(scopeRe)
  if (!scopeMatch) return []
  const gradientMatch = scopeMatch[1].match(/--docs-hero-accent:\s*linear-gradient\([^)]+\)/)
  if (!gradientMatch) return []
  return [...gradientMatch[0].matchAll(/(#[0-9a-fA-F]{6})\s+\d+%/g)].map((m) => m[1])
}

function extractHeroTextColor(scope = 'light') {
  if (scope === 'light') {
    const match = css.match(/\.hero\.hero--primary\s*\{[^}]*color:\s*(#[0-9a-fA-F]{6})/)
    return match ? match[1] : null
  }
  const match = css.match(/html\[data-theme=['"]dark['"]\]\s*\.hero\.hero--primary\s*\{[^}]*color:\s*(#[0-9a-fA-F]{6})/)
  return match ? match[1] : null
}

function extractButtonBorder(scope = 'light') {
  const pattern = scope === 'light'
    ? /\.hero\s+\.button--outline\s*\{[^}]*border-color:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/
    : /html\[data-theme=['"]dark['"]\]\s*\.hero\s+\.button--outline\s*\{[^}]*border-color:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/
  const match = css.match(pattern)
  if (!match) return null
  const hex = `#${parseInt(match[1]).toString(16).padStart(2, '0')}${parseInt(match[2]).toString(16).padStart(2, '0')}${parseInt(match[3]).toString(16).padStart(2, '0')}`
  return { hex, alpha: parseFloat(match[4]) }
}

// ── thresholds ───────────────────────────────────────────────────────

const AA_NORMAL = 4.5
const AA_NON_TEXT = 3.0

// ── light mode ───────────────────────────────────────────────────────

test('light mode: primary color scale passes AA on page background', () => {
  const bg = extractVar('--ifm-background-color')
  for (const variant of ['--ifm-color-primary', '--ifm-color-primary-dark', '--ifm-color-primary-darker', '--ifm-color-primary-darkest']) {
    const fg = extractVar(variant)
    const ratio = contrastRatio(fg, bg)
    assert.ok(
      ratio >= AA_NORMAL,
      `${variant} (${fg}) on ${bg}: ${ratio.toFixed(2)}:1 — must be >= ${AA_NORMAL}:1`,
    )
  }
})

test('light mode: hero text passes AA on all gradient stops', () => {
  const heroText = extractHeroTextColor('light')
  const stops = extractGradientStops('root')
  assert.ok(stops.length > 0, 'should find gradient stops')
  for (const stop of stops) {
    const ratio = contrastRatio(heroText, stop)
    assert.ok(
      ratio >= AA_NORMAL,
      `hero text ${heroText} on ${stop}: ${ratio.toFixed(2)}:1 — must be >= ${AA_NORMAL}:1`,
    )
  }
})

test('light mode: outline button border passes 3:1 on all gradient stops', () => {
  const border = extractButtonBorder('light')
  assert.ok(border, 'should find button border definition')
  const stops = extractGradientStops('root')
  for (const stop of stops) {
    const effective = blendRgba(border.hex, border.alpha, stop)
    const ratio = contrastRatio(effective, stop)
    assert.ok(
      ratio >= AA_NON_TEXT,
      `border (eff=${effective}) on ${stop}: ${ratio.toFixed(2)}:1 — must be >= ${AA_NON_TEXT}:1`,
    )
  }
})

// ── dark mode ────────────────────────────────────────────────────────

test('dark mode: primary color scale passes AA on page background', () => {
  const bg = extractVar('--ifm-background-color', 'dark')
  for (const variant of ['--ifm-color-primary', '--ifm-color-primary-dark', '--ifm-color-primary-darker', '--ifm-color-primary-darkest']) {
    const fg = extractVar(variant, 'dark')
    const ratio = contrastRatio(fg, bg)
    assert.ok(
      ratio >= AA_NORMAL,
      `${variant} (${fg}) on ${bg}: ${ratio.toFixed(2)}:1 — must be >= ${AA_NORMAL}:1`,
    )
  }
})

test('dark mode: hero text passes AA on all gradient stops', () => {
  const heroText = extractHeroTextColor('dark')
  assert.ok(heroText, 'dark mode hero should have an explicit text color override')
  const stops = extractGradientStops('dark')
  assert.ok(stops.length > 0, 'should find dark gradient stops')
  for (const stop of stops) {
    const ratio = contrastRatio(heroText, stop)
    assert.ok(
      ratio >= AA_NORMAL,
      `hero text ${heroText} on ${stop}: ${ratio.toFixed(2)}:1 — must be >= ${AA_NORMAL}:1`,
    )
  }
})

test('dark mode: outline button border passes 3:1 on all gradient stops', () => {
  const border = extractButtonBorder('dark')
  assert.ok(border, 'should find dark-mode button border definition')
  const stops = extractGradientStops('dark')
  for (const stop of stops) {
    const effective = blendRgba(border.hex, border.alpha, stop)
    const ratio = contrastRatio(effective, stop)
    assert.ok(
      ratio >= AA_NON_TEXT,
      `border (eff=${effective}) on ${stop}: ${ratio.toFixed(2)}:1 — must be >= ${AA_NON_TEXT}:1`,
    )
  }
})

// ── navbar ───────────────────────────────────────────────────────────

test('navbar link color passes AA in both modes', () => {
  const lightNavLink = extractVar('--ifm-navbar-link-color')
  const lightNavBg = '#ffffff' // navbar bg is white-ish at 0.85 opacity on near-white
  const lightRatio = contrastRatio(lightNavLink, lightNavBg)
  assert.ok(
    lightRatio >= AA_NORMAL,
    `light navbar ${lightNavLink} on white: ${lightRatio.toFixed(2)}:1`,
  )

  const darkNavLink = extractVar('--ifm-navbar-link-color', 'dark')
  const darkNavBg = '#0e130e' // effective dark navbar bg
  const darkRatio = contrastRatio(darkNavLink, darkNavBg)
  assert.ok(
    darkRatio >= AA_NORMAL,
    `dark navbar ${darkNavLink} on ${darkNavBg}: ${darkRatio.toFixed(2)}:1`,
  )
})
