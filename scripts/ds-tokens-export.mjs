#!/usr/bin/env node
// DS token exporter — single source of truth is apps/mercato/src/app/globals.css.
// Parses the three token blocks (@theme inline, :root, .dark) into the committed
// canonical snapshot .ai/ds/ds-tokens.json, checks drift against it, and emits
// Figma Variables sync payloads.
//
// Modes:
//   --write        regenerate .ai/ds/ds-tokens.json (deterministic, byte-stable)
//   --check        diff live globals.css vs the committed snapshot; exit 1 on drift
//   --check --count  print only the number of drifted tokens; always exit 0
//   --figma-ops    emit .ai/reports/ds-tokens-figma-ops.json (plugin-bridge upserts)
//   --push-figma   push via the Figma Variables REST API (Enterprise plan gate;
//                  reads FIGMA_TOKEN from the environment only — never store the
//                  token in a file; requires file_variables:read + write scopes)
//
// Direction of truth: code pushes, Figma mirrors. Canon changes land in
// globals.css first, then flow outward. Nothing ever writes CSS from JSON.

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const SOURCE_CSS = 'apps/mercato/src/app/globals.css'
export const SNAPSHOT_PATH = '.ai/ds/ds-tokens.json'
export const FIGMA_OPS_PATH = '.ai/reports/ds-tokens-figma-ops.json'
export const FIGMA_FILE_KEY = 'qCq9z6q1if0mpoRstV5OEA'
export const FIGMA_COLLECTION = 'OM Tokens'

const RADIUS_BASE_REM = 0.625
const REM_PX = 16

class ParseError extends Error {}

// ---------------------------------------------------------------------------
// Block extraction — only the three token blocks are parser scope by design.

export function extractBlocks(css) {
  const lines = css.split('\n')
  const wanted = [
    { key: 'theme', open: /^@theme inline \{\s*$/ },
    { key: 'root', open: /^:root \{\s*$/ },
    { key: 'dark', open: /^\.dark \{\s*$/ },
  ]
  const blocks = {}
  for (const { key, open } of wanted) {
    const start = lines.findIndex((line) => open.test(line))
    if (start === -1) throw new ParseError(`block not found in ${SOURCE_CSS}: ${key}`)
    const body = []
    let end = -1
    for (let i = start + 1; i < lines.length; i += 1) {
      if (/^\}\s*$/.test(lines[i])) { end = i; break }
      body.push({ line: i + 1, text: lines[i] })
    }
    if (end === -1) throw new ParseError(`unterminated block: ${key}`)
    blocks[key] = body
  }
  return blocks
}

// ---------------------------------------------------------------------------
// Declaration parsing — line-oriented; hard error on anything unclassifiable.

const NON_TOKEN_DECLARATIONS = new Set(['color-scheme'])

export function parseBlock(body, blockKey) {
  const declarations = []
  let pendingNote = null
  let inComment = false
  let commentBuffer = []

  for (const { line, text } of body) {
    const trimmed = text.trim()

    if (inComment) {
      const closeIdx = trimmed.indexOf('*/')
      if (closeIdx === -1) { commentBuffer.push(trimmed) ; continue }
      commentBuffer.push(trimmed.slice(0, closeIdx))
      pendingNote = normalizeComment(commentBuffer.join(' '))
      commentBuffer = []
      inComment = false
      const rest = trimmed.slice(closeIdx + 2).trim()
      if (rest !== '') throw new ParseError(`unparseable content after comment at ${SOURCE_CSS}:${line}: "${rest}"`)
      continue
    }

    if (trimmed === '') { pendingNote = null; continue }

    if (trimmed.startsWith('/*')) {
      const closeIdx = trimmed.indexOf('*/')
      if (closeIdx === -1) {
        inComment = true
        commentBuffer = [trimmed.slice(2)]
        continue
      }
      pendingNote = normalizeComment(trimmed.slice(2, closeIdx))
      const rest = trimmed.slice(closeIdx + 2).trim()
      if (rest !== '') throw new ParseError(`unparseable content after comment at ${SOURCE_CSS}:${line}: "${rest}"`)
      continue
    }

    const match = trimmed.match(/^(--[a-z0-9-]+|[a-z-]+)\s*:\s*(.+?);(?:\s*\/\*(.*)\*\/)?\s*$/i)
    if (!match) throw new ParseError(`unparseable line at ${SOURCE_CSS}:${line}: "${trimmed}"`)
    const [, rawName, rawValue, trailingComment] = match

    if (!rawName.startsWith('--')) {
      if (NON_TOKEN_DECLARATIONS.has(rawName)) { pendingNote = null; continue }
      throw new ParseError(`unexpected non-token declaration at ${SOURCE_CSS}:${line}: "${rawName}"`)
    }

    const note = trailingComment != null ? normalizeComment(trailingComment) : pendingNote
    declarations.push({ name: rawName.slice(2), value: rawValue.trim(), note: note || null, block: blockKey, line })
    pendingNote = null
  }
  if (inComment) throw new ParseError(`unterminated comment in block ${blockKey}`)
  return declarations
}

function normalizeComment(text) {
  return text.replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// Value classification

const VAR_ONLY = /^var\(--[a-z0-9-]+\)$/i

export function classifyValue(name, value) {
  if (VAR_ONLY.test(value)) return 'reference'
  if (name.startsWith('shadow-')) return 'shadow'
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return 'color'
  if (/^(oklch|rgb|rgba|hsl)\(/i.test(value)) return 'color'
  if (/^-?\d+(\.\d+)?$/.test(value)) return 'number'
  if (value.startsWith('calc(')) return 'expression'
  if (/^-?\d+(\.\d+)?(rem|px|em)$/.test(value)) return 'dimension'
  if (name.startsWith('font-geist-')) return 'fontStack'
  throw new ParseError(`cannot classify value of --${name}: "${value}"`)
}

// ---------------------------------------------------------------------------
// Color math — authored values stay verbatim; hex is a derived, display-only
// sRGB mirror (Figma variables store RGBA). Small self-contained OKLCH→sRGB
// conversion with browser-style clamping; no dependency.

export function colorToHex(value) {
  const lower = value.trim().toLowerCase()
  const hexMatch = lower.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/)
  if (hexMatch) {
    let hex = hexMatch[1]
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
    return `#${hex}`
  }
  const oklch = lower.match(/^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+%?)\s*)?\)$/)
  if (oklch) {
    const l = parseComponent(oklch[1], 1)
    const c = Number(oklch[2])
    const h = Number(oklch[3])
    const alpha = oklch[4] != null ? parseComponent(oklch[4], 1) : 1
    return rgbToHex(...oklchToSrgb(l, c, h), alpha)
  }
  const rgbSlash = lower.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/)
  if (rgbSlash) {
    const alpha = rgbSlash[4] != null ? parseComponent(rgbSlash[4], 1) : 1
    return rgbToHex(Number(rgbSlash[1]) / 255, Number(rgbSlash[2]) / 255, Number(rgbSlash[3]) / 255, alpha)
  }
  const rgbComma = lower.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/)
  if (rgbComma) {
    const alpha = rgbComma[4] != null ? Number(rgbComma[4]) : 1
    return rgbToHex(Number(rgbComma[1]) / 255, Number(rgbComma[2]) / 255, Number(rgbComma[3]) / 255, alpha)
  }
  return null
}

function parseComponent(raw, scale) {
  if (raw.endsWith('%')) return (Number(raw.slice(0, -1)) / 100) * scale
  return Number(raw)
}

function oklchToSrgb(l, c, hDeg) {
  const hRad = (hDeg * Math.PI) / 180
  const a = c * Math.cos(hRad)
  const b = c * Math.sin(hRad)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lr = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_
  const lg = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_
  const lb = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_
  return [gamma(lr), gamma(lg), gamma(lb)]
}

function gamma(linear) {
  const clamped = Math.min(1, Math.max(0, linear))
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055
}

function rgbToHex(r, g, b, alpha) {
  const channel = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')
  const base = `#${channel(r)}${channel(g)}${channel(b)}`
  return alpha >= 1 ? base : `${base}${channel(alpha)}`
}

// ---------------------------------------------------------------------------
// Figma naming — deterministic prefix table. Snapshot-only tokens get null.

export function figmaFor(name, kind) {
  if (kind === 'shadow' || kind === 'fontStack' || kind === 'reference') return null
  // Structural patterns, not enumerated values — a brand-new status hue or
  // chart color groups correctly with zero code changes.
  const statusMatch = name.match(/^status-([a-z0-9]+)-(bg|text|border|icon)$/)
  if (statusMatch) return { name: `status/${statusMatch[1]}/${statusMatch[2]}`, type: 'COLOR' }
  const chartMatch = name.match(/^chart-(.+)$/)
  if (chartMatch) return { name: `chart/${chartMatch[1]}`, type: 'COLOR' }
  const brandMatch = name.match(/^brand-(.+)$/)
  if (brandMatch) return { name: `brand/${brandMatch[1]}`, type: 'COLOR' }
  // accent-<hue>[-foreground] is the DS selection-accent family; bare
  // accent/accent-foreground are the core semantic pair and stay flat names.
  const accentMatch = name !== 'accent-foreground' && name.match(/^accent-([a-z0-9]+(?:-foreground)?)$/)
  if (accentMatch) return { name: `accent/${accentMatch[1]}`, type: 'COLOR' }
  const zMatch = name.match(/^z-index-(.+)$/)
  if (zMatch) return { name: `z/${zMatch[1]}`, type: 'FLOAT' }
  if (name === 'radius') return { name: 'radius/base', type: 'FLOAT' }
  const radiusMatch = name.match(/^radius-(.+)$/)
  if (radiusMatch) return { name: `radius/${radiusMatch[1]}`, type: 'FLOAT' }
  if (kind === 'color') return { name, type: 'COLOR' }
  if (kind === 'number') return { name, type: 'FLOAT' }
  return null
}

export function resolveRadiusPx(expression) {
  const basePx = RADIUS_BASE_REM * REM_PX
  if (expression === 'var(--radius)') return basePx
  const calcMatch = expression.match(/^calc\(var\(--radius\)\s*([+-])\s*(\d+(?:\.\d+)?)px\)$/)
  if (!calcMatch) return null
  const delta = Number(calcMatch[2])
  return calcMatch[1] === '+' ? basePx + delta : basePx - delta
}

// ---------------------------------------------------------------------------
// Snapshot assembly

export function buildSnapshot(css) {
  const blocks = extractBlocks(css)
  const theme = parseBlock(blocks.theme, 'theme')
  const root = parseBlock(blocks.root, 'root')
  const dark = parseBlock(blocks.dark, 'dark')

  const tokens = {}
  const ensure = (name) => {
    if (!tokens[name]) tokens[name] = {}
    return tokens[name]
  }

  const aliases = new Map()
  const isAliasName = (name) => name.startsWith('color-') || name === 'font-sans' || name === 'font-mono'
  for (const decl of theme) {
    const kind = classifyValue(decl.name, decl.value)
    if (kind === 'reference' && isAliasName(decl.name)) {
      const target = decl.value.match(/^var\(--([a-z0-9-]+)\)$/i)[1]
      aliases.set(target, decl.name)
      continue
    }
    const token = ensure(decl.name)
    token.kind = kind === 'reference' ? 'expression' : kind
    token.value = decl.value
    if (token.kind === 'expression') {
      const resolvedPx = resolveRadiusPx(decl.value)
      if (resolvedPx != null) token.resolvedPx = resolvedPx
    }
    if (decl.note) token.note = decl.note
  }

  for (const decl of root) {
    const kind = classifyValue(decl.name, decl.value)
    const token = ensure(decl.name)
    if (token.kind && token.kind !== kind && !(token.kind === 'shadow')) {
      throw new ParseError(`--${decl.name} classified as ${token.kind} in @theme but ${kind} in :root`)
    }
    token.kind = token.kind ?? kind
    token.light = decl.value
    if (kind === 'expression' && token.resolvedPx == null) {
      const resolvedPx = resolveRadiusPx(decl.value)
      if (resolvedPx != null) token.resolvedPx = resolvedPx
    }
    if (decl.name === 'radius' && kind === 'dimension') {
      token.resolvedPx = Number(decl.value.replace('rem', '')) * REM_PX
    }
    if (decl.note && !token.note) token.note = decl.note
  }

  for (const decl of dark) {
    const kind = classifyValue(decl.name, decl.value)
    const token = ensure(decl.name)
    token.kind = token.kind ?? kind
    token.dark = decl.value
    if (decl.note && !token.note) token.note = decl.note
  }

  for (const [target, aliasName] of aliases) {
    if (!tokens[target]) throw new ParseError(`@theme alias --${aliasName} points at missing token --${target}`)
  }

  for (const [name, token] of Object.entries(tokens)) {
    if (aliases.has(name)) token.themeAlias = aliases.get(name)

    const isThemeScalar = token.value != null && token.light == null
    if (isThemeScalar) {
      if (token.dark != null) token.themeInvariant = false
    } else {
      if (token.light == null && token.dark != null) {
        throw new ParseError(`--${name} has a .dark override but no :root value`)
      }
      token.dark = token.dark ?? null
      token.themeInvariant = token.dark == null || token.dark === token.light
      if (token.kind === 'color') {
        token.hex = {
          light: token.light != null ? colorToHex(token.light) : null,
          dark: token.dark != null ? colorToHex(token.dark) : colorToHex(token.light),
        }
      }
    }

    const figma = figmaFor(name, token.kind)
    token.figma = figma
    if (figma && figma.type === 'COLOR' && token.hex && (token.hex.light == null || token.hex.dark == null)) {
      token.figma = null
    }
  }

  const sorted = {}
  for (const name of Object.keys(tokens).sort()) {
    sorted[name] = orderTokenFields(tokens[name])
  }
  return { source: SOURCE_CSS, generator: 'scripts/ds-tokens-export.mjs', tokens: sorted }
}

const FIELD_ORDER = ['kind', 'value', 'light', 'dark', 'hex', 'resolvedPx', 'themeInvariant', 'themeAlias', 'figma', 'note']

function orderTokenFields(token) {
  const ordered = {}
  for (const field of FIELD_ORDER) {
    if (token[field] !== undefined) ordered[field] = token[field]
  }
  return ordered
}

export function serializeSnapshot(snapshot) {
  return `${JSON.stringify(snapshot, null, 2)}\n`
}

// ---------------------------------------------------------------------------
// Drift check

export function diffSnapshots(committed, live) {
  const diffs = []
  const names = new Set([...Object.keys(committed.tokens), ...Object.keys(live.tokens)])
  for (const name of [...names].sort()) {
    const before = committed.tokens[name]
    const after = live.tokens[name]
    if (!before) { diffs.push({ token: name, field: '(token)', from: '(absent)', to: 'added' }); continue }
    if (!after) { diffs.push({ token: name, field: '(token)', from: 'present', to: '(removed)' }); continue }
    const fields = new Set([...Object.keys(before), ...Object.keys(after)])
    for (const field of [...fields].sort()) {
      const beforeValue = JSON.stringify(before[field])
      const afterValue = JSON.stringify(after[field])
      if (beforeValue !== afterValue) {
        diffs.push({ token: name, field, from: beforeValue ?? 'undefined', to: afterValue ?? 'undefined' })
      }
    }
  }
  return diffs
}

export function countDriftedTokens(diffs) {
  return new Set(diffs.map((diff) => diff.token)).size
}

// ---------------------------------------------------------------------------
// Figma Variables payloads

export function buildFigmaOps(snapshot) {
  const ops = []
  for (const [name, token] of Object.entries(snapshot.tokens)) {
    if (!token.figma) continue
    let valuesByMode
    if (token.figma.type === 'COLOR') {
      valuesByMode = {
        Light: hexToRgba(token.hex.light),
        Dark: hexToRgba(token.hex.dark),
      }
    } else {
      const resolved = token.resolvedPx ?? Number(token.value ?? token.light)
      if (!Number.isFinite(resolved)) continue
      valuesByMode = { Light: resolved, Dark: resolved }
    }
    ops.push({
      collection: FIGMA_COLLECTION,
      name: token.figma.name,
      resolvedType: token.figma.type,
      valuesByMode,
      codeSyntax: { WEB: `var(--${name})` },
    })
  }
  // reconcile.prune: the ops list is the FULL desired state of the collection —
  // appliers must also delete any variable in the collection that is absent
  // from `ops`, so tokens removed from globals.css do not rot in Figma.
  return {
    file: FIGMA_FILE_KEY,
    collection: FIGMA_COLLECTION,
    modes: ['Light', 'Dark'],
    reconcile: { prune: true },
    ops,
  }
}

export function hexToRgba(hex) {
  const raw = hex.slice(1)
  const parse = (offset) => parseInt(raw.slice(offset, offset + 2), 16) / 255
  return {
    r: round4(parse(0)),
    g: round4(parse(2)),
    b: round4(parse(4)),
    a: raw.length === 8 ? round4(parse(6)) : 1,
  }
}

function round4(value) {
  return Math.round(value * 10000) / 10000
}

async function pushFigmaRest(opsPayload) {
  const token = process.env.FIGMA_TOKEN
  if (!token) {
    console.error('FIGMA_TOKEN is not set. The Figma Variables REST API is Enterprise-plan-gated;')
    console.error('without a token use `yarn ds:tokens:figma` and apply the ops file through the')
    console.error('plugin bridge (figma.variables API) instead — see .ai/ds/README.md.')
    process.exit(1)
  }
  const base = `https://api.figma.com/v1/files/${FIGMA_FILE_KEY}`
  const headers = { 'X-Figma-Token': token, 'Content-Type': 'application/json' }
  const localResponse = await fetch(`${base}/variables/local`, { headers })
  if (!localResponse.ok) {
    console.error(`Figma API error ${localResponse.status} on variables/local — check plan and token scopes.`)
    process.exit(1)
  }
  const local = await localResponse.json()
  const payload = buildRestPayload(opsPayload, local)
  console.log(`Pushing ${opsPayload.ops.length} variables to "${FIGMA_COLLECTION}" (overwriting the Figma mirror)…`)
  const postResponse = await fetch(`${base}/variables`, { method: 'POST', headers, body: JSON.stringify(payload) })
  if (!postResponse.ok) {
    console.error(`Figma API error ${postResponse.status}: ${await postResponse.text()}`)
    process.exit(1)
  }
  console.log('Push complete.')
}

export function buildRestPayload(opsPayload, local) {
  const collections = Object.values(local?.meta?.variableCollections ?? {})
  const existingCollection = collections.find((collection) => collection.name === FIGMA_COLLECTION)
  const existingVariables = Object.values(local?.meta?.variables ?? {})
  const collectionId = existingCollection?.id ?? 'tmp-om-tokens'
  const payload = { variableCollections: [], variableModes: [], variables: [], variableModeValues: [] }

  let lightModeId
  let darkModeId
  if (!existingCollection) {
    payload.variableCollections.push({ action: 'CREATE', id: collectionId, name: FIGMA_COLLECTION, initialModeId: 'tmp-light' })
    payload.variableModes.push({ action: 'UPDATE', id: 'tmp-light', name: 'Light', variableCollectionId: collectionId })
    payload.variableModes.push({ action: 'CREATE', id: 'tmp-dark', name: 'Dark', variableCollectionId: collectionId })
    lightModeId = 'tmp-light'
    darkModeId = 'tmp-dark'
  } else {
    const modes = existingCollection.modes ?? []
    lightModeId = modes.find((mode) => mode.name === 'Light')?.modeId ?? modes[0]?.modeId
    darkModeId = modes.find((mode) => mode.name === 'Dark')?.modeId
    if (!darkModeId) {
      darkModeId = 'tmp-dark'
      payload.variableModes.push({ action: 'CREATE', id: darkModeId, name: 'Dark', variableCollectionId: collectionId })
    }
  }

  for (const op of opsPayload.ops) {
    const existing = existingVariables.find(
      (variable) => variable.name === op.name && variable.variableCollectionId === collectionId,
    )
    const variableId = existing?.id ?? `tmp-${op.name.replace(/[^a-z0-9]+/gi, '-')}`
    if (!existing) {
      payload.variables.push({ action: 'CREATE', id: variableId, name: op.name, resolvedType: op.resolvedType, variableCollectionId: collectionId })
    }
    payload.variableModeValues.push({ variableId, modeId: lightModeId, value: op.valuesByMode.Light })
    payload.variableModeValues.push({ variableId, modeId: darkModeId, value: op.valuesByMode.Dark })
  }

  if (existingCollection) {
    const desiredNames = new Set(opsPayload.ops.map((op) => op.name))
    for (const variable of existingVariables) {
      if (variable.variableCollectionId === collectionId && !desiredNames.has(variable.name)) {
        payload.variables.push({ action: 'DELETE', id: variable.id })
      }
    }
  }
  return payload
}

// ---------------------------------------------------------------------------
// CLI

function readSourceCss() {
  return fs.readFileSync(path.join(ROOT, SOURCE_CSS), 'utf8')
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const live = buildSnapshot(readSourceCss())

  if (args.has('--write') || args.size === 0) {
    const target = path.join(ROOT, SNAPSHOT_PATH)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, serializeSnapshot(live))
    console.log(`Wrote ${SNAPSHOT_PATH} (${Object.keys(live.tokens).length} tokens).`)
    return
  }

  if (args.has('--check')) {
    const snapshotFile = path.join(ROOT, SNAPSHOT_PATH)
    if (!fs.existsSync(snapshotFile)) {
      console.error(`missing snapshot ${SNAPSHOT_PATH} — run \`yarn ds:tokens\` first`)
      process.exit(1)
    }
    const committed = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'))
    const diffs = diffSnapshots(committed, live)
    const drifted = countDriftedTokens(diffs)
    if (args.has('--count')) {
      console.log(String(drifted))
      return
    }
    if (diffs.length === 0) {
      console.log('Token snapshot is in sync with globals.css.')
      return
    }
    console.error(`Token drift detected (${drifted} token${drifted === 1 ? '' : 's'}):`)
    for (const diff of diffs) {
      console.error(`  ${diff.token} · ${diff.field} · ${diff.from} → ${diff.to}`)
    }
    console.error('Run `yarn ds:tokens` and commit the snapshot if the change is intentional (canon evidence required in review).')
    process.exit(1)
  }

  if (args.has('--figma-ops') || args.has('--push-figma')) {
    const opsPayload = buildFigmaOps(live)
    if (args.has('--figma-ops')) {
      const target = path.join(ROOT, FIGMA_OPS_PATH)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, `${JSON.stringify(opsPayload, null, 2)}\n`)
      console.log(`Wrote ${FIGMA_OPS_PATH} (${opsPayload.ops.length} variable upserts).`)
    }
    if (args.has('--push-figma')) await pushFigmaRest(opsPayload)
    return
  }

  console.error('usage: ds-tokens-export.mjs [--write | --check [--count] | --figma-ops | --push-figma]')
  process.exit(1)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof ParseError ? `parse error: ${error.message}` : error)
    process.exit(1)
  })
}
