/**
 * Read-only Figma REST extraction for `mercato theme from-figma`.
 *
 * Inventories brand signals from a client Figma file: color candidates with
 * usage counts, font families from text styles, and the corner-radius
 * distribution. Attempts the (Enterprise-plan-gated) Variables API first and
 * falls back to local styles plus a bounded solid-fill frequency walk of
 * top-level frames — the designed primary path for most client files.
 *
 * Every request is a GET. Auth is `X-Figma-Token` read from the environment by
 * the caller and held only in the request-header closure here — the token is
 * structurally unreachable from the serialized extraction artifact.
 *
 * The extraction lands in the versioned `om-figma-brand-extract@1` JSON that
 * the `figma-design-with-ds` skill (MODE B) consumes too. Additive fields only
 * within `@1`; breaking changes bump the version.
 */

import fs from 'node:fs'
import { formatHexColor, type Rgb } from './contrast'
import { hexToOklch } from './palette'

export const EXTRACT_SCHEMA = 'om-figma-brand-extract@1'

/** Default hard stop for the frame walk — a representative inventory, not a census. */
export const DEFAULT_NODE_BUDGET = 20_000
/** Batch size for `/v1/files/{key}/nodes?ids=…` calls. */
const NODES_BATCH_SIZE = 50
/** Maximum retries per request on 429 responses. */
const MAX_RETRIES = 3
/** OKLCH chroma below which a candidate counts as a near-gray for ranking. */
const NEAR_GRAY_CHROMA = 0.04

export type VariablesAvailability = 'ok' | 'unavailable-plan-gated' | 'error'

export type CandidateTier = 'variable' | 'style' | 'fill'

export type BrandCandidate = {
  hex: string
  count: number
  tier: CandidateTier
  sources: string[]
  styleNames: string[]
  variableName: string | null
}

export type ExtractedFillStyle = { type: 'FILL'; name: string; hex: string }
export type ExtractedTextStyle = {
  type: 'TEXT'
  name: string
  fontFamily: string
  fontWeight: number
  fontSize: number
}
export type ExtractedStyle = ExtractedFillStyle | ExtractedTextStyle

export type FontUsage = {
  family: string
  weights: number[]
  textStyles: number
  usageCount: number
}

export type RadiusBucket = { px: number; count: number }

export type BrandExtraction = {
  schema: typeof EXTRACT_SCHEMA
  file: { key: string; name: string; lastModified: string; extractedAt: string }
  source: {
    variables: VariablesAvailability
    styles: 'ok' | 'error'
    frames: {
      pagesScanned: number
      framesScanned: number
      nodesVisited: number
      nodeBudget: number
      truncated: boolean
    }
    excluded: { image: number; gradient: number; alpha: number }
  }
  candidates: BrandCandidate[]
  styles: ExtractedStyle[]
  fonts: FontUsage[]
  radii: RadiusBucket[]
}

export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
}>

export type ExtractOptions = {
  fileKey: string
  token: string
  /** Restrict the frame walk to pages with these names (case-sensitive). */
  pages?: string[] | null
  nodeBudget?: number
  fetchImpl?: FetchLike
  sleepImpl?: (ms: number) => Promise<void>
  now?: () => Date
  log?: (message: string) => void
}

// ── File key parsing ────────────────────────────────────────────────────────

/**
 * Parses a Figma file URL (`figma.com/design/<key>/…` or `/file/<key>/…`) or a
 * bare file key. Returns an actionable error message for anything else.
 */
export function parseFigmaFileKey(input: string): { key: string } | { error: string } {
  const value = input.trim()
  if (!value) return { error: 'Missing Figma file URL or key.' }
  if (/^[A-Za-z0-9]{8,128}$/.test(value)) return { key: value }
  let url: URL | null = null
  try {
    url = new URL(value.includes('://') ? value : `https://${value}`)
  } catch {
    url = null
  }
  if (url && /(^|\.)figma\.com$/i.test(url.hostname)) {
    const segments = url.pathname.split('/').filter(Boolean)
    const markerIndex = segments.findIndex((segment) =>
      segment === 'design' || segment === 'file' || segment === 'proto' || segment === 'board',
    )
    const key = markerIndex >= 0 ? segments[markerIndex + 1] : undefined
    if (key && /^[A-Za-z0-9]{8,128}$/.test(key)) return { key }
    return {
      error:
        'Could not find a file key in that Figma URL. Expected https://www.figma.com/design/<key>/<name> or /file/<key>/<name>.',
    }
  }
  return {
    error:
      `"${input}" is not a Figma file URL or key. Pass a URL like https://www.figma.com/design/<key>/My-File, or the bare file key.`,
  }
}

// ── Figma node walking helpers ──────────────────────────────────────────────

type FigmaColor = { r: number; g: number; b: number; a?: number }
type FigmaPaint = {
  type?: string
  visible?: boolean
  opacity?: number
  color?: FigmaColor
}
type FigmaTypeStyle = { fontFamily?: string; fontWeight?: number; fontSize?: number }
type FigmaNode = {
  id?: string
  name?: string
  type?: string
  fills?: FigmaPaint[]
  strokes?: FigmaPaint[]
  cornerRadius?: number
  rectangleCornerRadii?: number[]
  style?: FigmaTypeStyle
  characters?: string
  children?: FigmaNode[]
}

const COUNTABLE_NODE_TYPES = new Set([
  'FRAME',
  'RECTANGLE',
  'ELLIPSE',
  'VECTOR',
  'TEXT',
  'COMPONENT',
  'INSTANCE',
])

function figmaColorToHex(color: FigmaColor): string {
  const rgb: Rgb = { r: color.r * 255, g: color.g * 255, b: color.b * 255 }
  return formatHexColor(rgb)
}

function paintAlpha(paint: FigmaPaint): number {
  return (paint.opacity ?? 1) * (paint.color?.a ?? 1)
}

// ── Extraction state ────────────────────────────────────────────────────────

type CandidateDraft = {
  hex: string
  count: number
  tier: CandidateTier
  sources: Set<string>
  styleNames: Set<string>
  variableName: string | null
}

type FontDraft = { family: string; weights: Set<number>; textStyles: number; usageCount: number }

class ExtractionState {
  candidates = new Map<string, CandidateDraft>()
  fonts = new Map<string, FontDraft>()
  radii = new Map<number, number>()
  excluded = { image: 0, gradient: 0, alpha: 0 }
  nodesVisited = 0
  truncated = false

  candidate(hex: string): CandidateDraft {
    let draft = this.candidates.get(hex)
    if (!draft) {
      draft = { hex, count: 0, tier: 'fill', sources: new Set(), styleNames: new Set(), variableName: null }
      this.candidates.set(hex, draft)
    }
    return draft
  }

  promoteTier(draft: CandidateDraft, tier: CandidateTier): void {
    const rank: Record<CandidateTier, number> = { variable: 0, style: 1, fill: 2 }
    if (rank[tier] < rank[draft.tier]) draft.tier = tier
  }

  font(family: string): FontDraft {
    let draft = this.fonts.get(family)
    if (!draft) {
      draft = { family, weights: new Set(), textStyles: 0, usageCount: 0 }
      this.fonts.set(family, draft)
    }
    return draft
  }

  addRadius(px: number): void {
    const bucket = Math.round(px)
    if (bucket <= 0) return
    this.radii.set(bucket, (this.radii.get(bucket) ?? 0) + 1)
  }

  countPaint(paint: FigmaPaint, source: string): void {
    if (paint.visible === false) return
    const type = paint.type ?? ''
    if (type === 'IMAGE') {
      this.excluded.image += 1
      return
    }
    if (type.startsWith('GRADIENT')) {
      this.excluded.gradient += 1
      return
    }
    if (type !== 'SOLID' || !paint.color) return
    if (paintAlpha(paint) < 1) {
      this.excluded.alpha += 1
      return
    }
    const draft = this.candidate(figmaColorToHex(paint.color))
    draft.count += 1
    draft.sources.add(source)
  }
}

function walkNode(node: FigmaNode, state: ExtractionState, budget: number): void {
  if (state.nodesVisited >= budget) {
    state.truncated = true
    return
  }
  state.nodesVisited += 1
  const type = node.type ?? ''
  if (COUNTABLE_NODE_TYPES.has(type)) {
    const kind = type === 'TEXT' ? 'text' : 'frame'
    for (const paint of node.fills ?? []) state.countPaint(paint, `fill:${kind}`)
    for (const paint of node.strokes ?? []) state.countPaint(paint, `stroke:${kind}`)
    if (typeof node.cornerRadius === 'number') {
      state.addRadius(node.cornerRadius)
    } else if (Array.isArray(node.rectangleCornerRadii)) {
      for (const radius of new Set(node.rectangleCornerRadii)) state.addRadius(radius)
    }
    if (type === 'TEXT' && node.style?.fontFamily) {
      const font = state.font(node.style.fontFamily)
      font.usageCount += node.characters?.length ?? 1
      if (typeof node.style.fontWeight === 'number') font.weights.add(node.style.fontWeight)
    }
  }
  for (const child of node.children ?? []) {
    if (state.truncated) return
    walkNode(child, state, budget)
  }
}

// ── REST client ─────────────────────────────────────────────────────────────

class FigmaClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike,
    private readonly sleepImpl: (ms: number) => Promise<void>,
  ) {}

  async get(path: string): Promise<{ status: number; body: unknown }> {
    const url = `https://api.figma.com${path}`
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetchImpl(url, {
        headers: { 'X-Figma-Token': this.token },
      })
      if (response.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = Number.parseFloat(response.headers.get('Retry-After') ?? '1')
        const delaySeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 1
        await this.sleepImpl(delaySeconds * 1000)
        continue
      }
      const body = await response.json().catch(() => null)
      return { status: response.status, body }
    }
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

// ── Extraction ──────────────────────────────────────────────────────────────

async function extractVariables(
  client: FigmaClient,
  fileKey: string,
  state: ExtractionState,
  log: (message: string) => void,
): Promise<VariablesAvailability> {
  const { status, body } = await client.get(`/v1/files/${fileKey}/variables/local`)
  if (status === 403 || status === 404) {
    log("Variables API unavailable on this file's plan — falling back to styles + fill analysis")
    return 'unavailable-plan-gated'
  }
  if (status !== 200 || typeof body !== 'object' || body === null) return 'error'
  const meta = (body as { meta?: { variables?: Record<string, unknown>; variableCollections?: Record<string, unknown> } }).meta
  const variables = meta?.variables ?? {}
  const collections = meta?.variableCollections ?? {}
  for (const raw of Object.values(variables)) {
    const variable = raw as {
      name?: string
      resolvedType?: string
      variableCollectionId?: string
      valuesByMode?: Record<string, unknown>
    }
    const collection = collections[variable.variableCollectionId ?? ''] as { defaultModeId?: string } | undefined
    const modeIds = Object.keys(variable.valuesByMode ?? {})
    const modeId = collection?.defaultModeId && variable.valuesByMode?.[collection.defaultModeId] !== undefined
      ? collection.defaultModeId
      : modeIds[0]
    if (!modeId) continue
    const value = variable.valuesByMode?.[modeId]
    if (variable.resolvedType === 'COLOR' && typeof value === 'object' && value !== null && 'r' in value) {
      const color = value as FigmaColor
      if ((color.a ?? 1) < 1) {
        state.excluded.alpha += 1
        continue
      }
      const draft = state.candidate(figmaColorToHex(color))
      draft.sources.add('variable')
      state.promoteTier(draft, 'variable')
      if (!draft.variableName) draft.variableName = variable.name ?? null
    } else if (variable.resolvedType === 'FLOAT' && typeof value === 'number' && /radius/i.test(variable.name ?? '')) {
      state.addRadius(value)
    }
  }
  return 'ok'
}

type StyleIndexEntry = { node_id?: string; style_type?: string; name?: string }

async function extractStyles(
  client: FigmaClient,
  fileKey: string,
  state: ExtractionState,
): Promise<{ availability: 'ok' | 'error'; styles: ExtractedStyle[] }> {
  const { status, body } = await client.get(`/v1/files/${fileKey}/styles`)
  if (status !== 200 || typeof body !== 'object' || body === null) return { availability: 'error', styles: [] }
  const index = ((body as { meta?: { styles?: StyleIndexEntry[] } }).meta?.styles ?? []).filter(
    (entry) => entry.node_id && (entry.style_type === 'FILL' || entry.style_type === 'TEXT'),
  )
  const styles: ExtractedStyle[] = []
  for (const batch of chunk(index, NODES_BATCH_SIZE)) {
    const ids = batch.map((entry) => entry.node_id as string)
    const nodesResponse = await client.get(`/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(ids.join(','))}`)
    if (nodesResponse.status !== 200) continue
    const nodes = (nodesResponse.body as { nodes?: Record<string, { document?: FigmaNode } | null> }).nodes ?? {}
    for (const entry of batch) {
      const document = nodes[entry.node_id as string]?.document
      if (!document) continue
      if (entry.style_type === 'FILL') {
        const solid = (document.fills ?? []).find(
          (paint) => paint.type === 'SOLID' && paint.color && paint.visible !== false && paintAlpha(paint) >= 1,
        )
        if (!solid?.color) continue
        const hex = figmaColorToHex(solid.color)
        styles.push({ type: 'FILL', name: entry.name ?? '', hex })
        const draft = state.candidate(hex)
        draft.sources.add('style')
        draft.styleNames.add(entry.name ?? '')
        state.promoteTier(draft, 'style')
      } else if (entry.style_type === 'TEXT' && document.style?.fontFamily) {
        styles.push({
          type: 'TEXT',
          name: entry.name ?? '',
          fontFamily: document.style.fontFamily,
          fontWeight: document.style.fontWeight ?? 400,
          fontSize: document.style.fontSize ?? 0,
        })
        const font = state.font(document.style.fontFamily)
        font.textStyles += 1
        if (typeof document.style.fontWeight === 'number') font.weights.add(document.style.fontWeight)
      }
    }
  }
  return { availability: 'ok', styles }
}

/** Ranks candidates: variable > style > fill tier, chromatic above near-gray, then usage count. */
export function rankCandidates(candidates: BrandCandidate[]): BrandCandidate[] {
  const tierRank: Record<CandidateTier, number> = { variable: 0, style: 1, fill: 2 }
  const grayRank = (hex: string): number => {
    const oklch = hexToOklch(hex)
    return oklch && oklch.c < NEAR_GRAY_CHROMA ? 1 : 0
  }
  return [...candidates].sort((a, b) =>
    tierRank[a.tier] - tierRank[b.tier] ||
    grayRank(a.hex) - grayRank(b.hex) ||
    b.count - a.count ||
    a.hex.localeCompare(b.hex),
  )
}

/** True when the candidate is a near-gray (demoted in ranking and prompt display). */
export function isNearGray(hex: string): boolean {
  const oklch = hexToOklch(hex)
  return oklch !== null && oklch.c < NEAR_GRAY_CHROMA
}

/**
 * Runs the full extraction against the Figma REST API. Read-only; throws only
 * when the file itself is unreachable (bad key, bad token, network failure).
 */
export async function extractBrand(options: ExtractOptions): Promise<BrandExtraction> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
  const sleepImpl = options.sleepImpl ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const now = options.now ?? (() => new Date())
  const log = options.log ?? ((message: string) => console.log(message))
  const nodeBudget = options.nodeBudget ?? DEFAULT_NODE_BUDGET
  const client = new FigmaClient(options.token, fetchImpl, sleepImpl)
  const state = new ExtractionState()

  // File metadata + page/frame listing (depth=2: document → pages → top-level children).
  const fileResponse = await client.get(`/v1/files/${options.fileKey}?depth=2`)
  if (fileResponse.status !== 200 || typeof fileResponse.body !== 'object' || fileResponse.body === null) {
    if (fileResponse.status === 403) {
      throw new Error(
        `Figma rejected the token for file ${options.fileKey} (403). Check that FIGMA_TOKEN is valid and has file read scope.`,
      )
    }
    if (fileResponse.status === 404) {
      throw new Error(`Figma file ${options.fileKey} not found (404). Check the file key and that the token can access it.`)
    }
    throw new Error(`Could not fetch Figma file ${options.fileKey} (HTTP ${fileResponse.status}).`)
  }
  const file = fileResponse.body as { name?: string; lastModified?: string; document?: FigmaNode }

  const variablesAvailability = await extractVariables(client, options.fileKey, state, log)
  const stylesResult = await extractStyles(client, options.fileKey, state)

  // Bounded frame walk.
  const pageFilter = options.pages && options.pages.length > 0 ? new Set(options.pages) : null
  const pages = (file.document?.children ?? []).filter(
    (node) => node.type === 'CANVAS' && (!pageFilter || pageFilter.has(node.name ?? '')),
  )
  const frames = pages.flatMap((page) =>
    (page.children ?? []).filter(
      (child) => child.id && (child.type === 'FRAME' || child.type === 'COMPONENT' || child.type === 'COMPONENT_SET' || child.type === 'SECTION'),
    ),
  )
  for (const batch of chunk(frames, NODES_BATCH_SIZE)) {
    if (state.truncated) break
    const ids = batch.map((frame) => frame.id as string)
    const nodesResponse = await client.get(`/v1/files/${options.fileKey}/nodes?ids=${encodeURIComponent(ids.join(','))}`)
    if (nodesResponse.status !== 200) continue
    const nodes = (nodesResponse.body as { nodes?: Record<string, { document?: FigmaNode } | null> }).nodes ?? {}
    for (const id of ids) {
      const document = nodes[id]?.document
      if (!document) continue
      walkNode(document, state, nodeBudget)
      if (state.truncated) break
    }
  }

  const candidates = rankCandidates(
    [...state.candidates.values()].map((draft) => ({
      hex: draft.hex,
      count: draft.count,
      tier: draft.tier,
      sources: [...draft.sources].sort((a, b) => a.localeCompare(b)),
      styleNames: [...draft.styleNames].sort((a, b) => a.localeCompare(b)),
      variableName: draft.variableName,
    })),
  )

  const styles = [...stylesResult.styles].sort(
    (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name),
  )

  const fonts = [...state.fonts.values()]
    .map((draft) => ({
      family: draft.family,
      weights: [...draft.weights].sort((a, b) => a - b),
      textStyles: draft.textStyles,
      usageCount: draft.usageCount,
    }))
    .sort((a, b) => b.usageCount - a.usageCount || a.family.localeCompare(b.family))

  const radii = [...state.radii.entries()]
    .map(([px, count]) => ({ px, count }))
    .sort((a, b) => a.px - b.px)

  return {
    schema: EXTRACT_SCHEMA,
    file: {
      key: options.fileKey,
      name: file.name ?? '',
      lastModified: file.lastModified ?? '',
      extractedAt: now().toISOString(),
    },
    source: {
      variables: variablesAvailability,
      styles: stylesResult.availability,
      frames: {
        pagesScanned: pages.length,
        framesScanned: frames.length,
        nodesVisited: state.nodesVisited,
        nodeBudget,
        truncated: state.truncated,
      },
      excluded: state.excluded,
    },
    candidates,
    styles,
    fonts,
    radii,
  }
}

// ── Serialization ───────────────────────────────────────────────────────────

/**
 * Deterministic serialization: fixed key order (the schema order above),
 * 2-space indentation, trailing newline. Re-extracting an unchanged file
 * yields identical bytes apart from `extractedAt`.
 */
export function serializeExtraction(extraction: BrandExtraction): string {
  return `${JSON.stringify(extraction, null, 2)}\n`
}

/** Reads and validates an extraction JSON. Throws on schema mismatch. */
export function readExtraction(filePath: string): BrandExtraction {
  const raw = fs.readFileSync(filePath, 'utf8')
  const parsed = JSON.parse(raw) as { schema?: string }
  if (parsed.schema !== EXTRACT_SCHEMA) {
    throw new Error(
      `Unsupported extraction schema "${parsed.schema ?? 'missing'}" in ${filePath} — this build reads ${EXTRACT_SCHEMA}.`,
    )
  }
  return parsed as BrandExtraction
}
