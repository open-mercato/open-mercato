import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_NODE_BUDGET,
  EXTRACT_SCHEMA,
  extractBrand,
  parseFigmaFileKey,
  rankCandidates,
  serializeExtraction,
  type BrandCandidate,
  type BrandExtraction,
} from '../figma-extract'
import {
  createFigmaFixtureFetch,
  FIXTURE_FILE_KEY,
  FIXTURE_NOW,
} from './fixtures/figma-fixture-fetch'

const noopLog = () => {}
const instantSleep = async () => {}

const runExtraction = (overrides: Parameters<typeof createFigmaFixtureFetch>[0] = {}, extra: Partial<Parameters<typeof extractBrand>[0]> = {}) =>
  extractBrand({
    fileKey: FIXTURE_FILE_KEY,
    token: 'figd_test_sentinel',
    fetchImpl: createFigmaFixtureFetch(overrides),
    sleepImpl: instantSleep,
    now: FIXTURE_NOW,
    log: noopLog,
    ...extra,
  })

describe('parseFigmaFileKey', () => {
  it('accepts design URLs, file URLs, and bare keys, ignoring query noise', () => {
    expect(parseFigmaFileKey(`https://www.figma.com/design/${FIXTURE_FILE_KEY}/Acme-Brand-Book?node-id=1-2&t=abc`)).toEqual({ key: FIXTURE_FILE_KEY })
    expect(parseFigmaFileKey(`https://figma.com/file/${FIXTURE_FILE_KEY}/Old-Style-Link`)).toEqual({ key: FIXTURE_FILE_KEY })
    expect(parseFigmaFileKey(`figma.com/design/${FIXTURE_FILE_KEY}/no-protocol`)).toEqual({ key: FIXTURE_FILE_KEY })
    expect(parseFigmaFileKey(FIXTURE_FILE_KEY)).toEqual({ key: FIXTURE_FILE_KEY })
  })

  it('rejects non-Figma URLs and junk with an actionable message', () => {
    const rejected = parseFigmaFileKey('https://example.com/design/abc123456789')
    expect(rejected).toHaveProperty('error')
    expect((rejected as { error: string }).error).toContain('figma.com/design/<key>')
    expect(parseFigmaFileKey('https://www.figma.com/files/recent')).toHaveProperty('error')
    expect(parseFigmaFileKey('not a key!!!')).toHaveProperty('error')
    expect(parseFigmaFileKey('')).toHaveProperty('error')
  })
})

describe('extractBrand (fallback path: styles + fill analysis)', () => {
  let extraction: BrandExtraction

  beforeAll(async () => {
    extraction = await runExtraction()
  })

  it('records the plan-gated Variables availability and file metadata', () => {
    expect(extraction.schema).toBe(EXTRACT_SCHEMA)
    expect(extraction.source.variables).toBe('unavailable-plan-gated')
    expect(extraction.source.styles).toBe('ok')
    expect(extraction.file).toEqual({
      key: FIXTURE_FILE_KEY,
      name: 'Acme Brand Book',
      lastModified: '2026-07-01T09:30:00Z',
      extractedAt: '2026-07-21T10:00:00.000Z',
    })
  })

  it('counts solid fills and strokes with style-tier promotion and evidence', () => {
    const primary = extraction.candidates.find((candidate) => candidate.hex === '#0c71c6')
    expect(primary).toMatchObject({
      count: 6,
      tier: 'style',
      styleNames: ['Brand/Primary'],
      variableName: null,
    })
    expect(primary?.sources).toEqual(['fill:frame', 'style'])

    const coral = extraction.candidates.find((candidate) => candidate.hex === '#f2653a')
    expect(coral).toMatchObject({ count: 3, tier: 'style', styleNames: ['Brand/Coral'] })

    const border = extraction.candidates.find((candidate) => candidate.hex === '#e5e5e5')
    expect(border).toMatchObject({ count: 4, tier: 'fill' })
    expect(border?.sources).toEqual(['fill:frame', 'stroke:frame'])

    const white = extraction.candidates.find((candidate) => candidate.hex === '#ffffff')
    expect(white?.sources).toEqual(['fill:frame', 'fill:text'])
  })

  it('ranks style-backed chromatic candidates above raw fills and sinks near-grays', () => {
    const hexes = extraction.candidates.map((candidate) => candidate.hex)
    // Style tier first (chromatic brand colors), raw fills after, near-grays last
    // despite their higher usage counts.
    expect(hexes.indexOf('#0c71c6')).toBeLessThan(hexes.indexOf('#ffffff'))
    expect(hexes.indexOf('#f2653a')).toBeLessThan(hexes.indexOf('#e5e5e5'))
    expect(hexes.indexOf('#0c71c6')).toBe(0)
  })

  it('excludes image, gradient, and semi-transparent fills from ranking, with tallies', () => {
    expect(extraction.source.excluded).toEqual({ image: 2, gradient: 1, alpha: 1 })
    // The 50%-opacity overlay must not have inflated the ink count.
    const ink = extraction.candidates.find((candidate) => candidate.hex === '#1a1a2e')
    expect(ink?.count).toBe(3)
  })

  it('histograms corner radii', () => {
    expect(extraction.radii).toEqual([
      { px: 8, count: 4 },
      { px: 999, count: 1 },
    ])
  })

  it('extracts fonts from text styles and text nodes', () => {
    expect(extraction.styles).toContainEqual({
      type: 'TEXT',
      name: 'Heading/H1',
      fontFamily: 'Inter',
      fontWeight: 600,
      fontSize: 32,
    })
    expect(extraction.fonts).toEqual([
      { family: 'Inter', weights: [400, 500, 600, 700], textStyles: 1, usageCount: 96 },
    ])
  })

  it('reports scan coverage under the default budget', () => {
    expect(extraction.source.frames).toEqual({
      pagesScanned: 2,
      framesScanned: 3,
      nodesVisited: 25,
      nodeBudget: DEFAULT_NODE_BUDGET,
      truncated: false,
    })
  })
})

describe('extractBrand (Variables path)', () => {
  it('turns color variables into top-tier candidates carrying their names', async () => {
    const extraction = await runExtraction({ variablesStatus: 200 })
    expect(extraction.source.variables).toBe('ok')
    const primary = extraction.candidates.find((candidate) => candidate.hex === '#0c71c6')
    expect(primary).toMatchObject({ tier: 'variable', variableName: 'brand/primary' })
    expect(primary?.sources).toEqual(expect.arrayContaining(['variable', 'style', 'fill:frame']))
    expect(extraction.candidates[0]?.hex).toBe('#0c71c6')
  })

  it('routes float radius variables into the histogram and excludes alpha color variables', async () => {
    const extraction = await runExtraction({ variablesStatus: 200 })
    expect(extraction.radii).toContainEqual({ px: 8, count: 5 })
    expect(extraction.candidates.some((candidate) => candidate.variableName === 'brand/overlay')).toBe(false)
    expect(extraction.source.excluded.alpha).toBe(2)
  })
})

describe('extractBrand (bounds and resilience)', () => {
  it('stops at the node budget and flags truncation', async () => {
    const extraction = await runExtraction({}, { nodeBudget: 10 })
    expect(extraction.source.frames.truncated).toBe(true)
    expect(extraction.source.frames.nodesVisited).toBe(10)
  })

  it('narrows the frame walk with a page filter', async () => {
    const extraction = await runExtraction({}, { pages: ['Marketing'] })
    expect(extraction.source.frames.pagesScanned).toBe(1)
    expect(extraction.source.frames.framesScanned).toBe(1)
    // Only the Hero frame: no radius-999 badge in scope.
    expect(extraction.radii).toEqual([{ px: 8, count: 1 }])
  })

  it('honors Retry-After on 429 with bounded retries', async () => {
    const sleeps: number[] = []
    const extraction = await extractBrand({
      fileKey: FIXTURE_FILE_KEY,
      token: 'figd_test_sentinel',
      fetchImpl: createFigmaFixtureFetch({ rateLimit429s: 2 }),
      sleepImpl: async (ms) => { sleeps.push(ms) },
      now: FIXTURE_NOW,
      log: noopLog,
    })
    expect(sleeps).toEqual([2000, 2000])
    expect(extraction.file.name).toBe('Acme Brand Book')
  })

  it('fails fast with an actionable error when the file is unreachable', async () => {
    await expect(
      extractBrand({
        fileKey: 'DoesNotExist12345678',
        token: 'figd_test_sentinel',
        fetchImpl: createFigmaFixtureFetch(),
        sleepImpl: instantSleep,
        log: noopLog,
      }),
    ).rejects.toThrow(/not found \(404\)/)
  })
})

describe('rankCandidates', () => {
  it('orders by tier, then chroma class, then count, then hex', () => {
    const candidate = (hex: string, count: number, tier: BrandCandidate['tier']): BrandCandidate => ({
      hex, count, tier, sources: [], styleNames: [], variableName: null,
    })
    const ranked = rankCandidates([
      candidate('#e5e5e5', 900, 'fill'),
      candidate('#f2653a', 61, 'style'),
      candidate('#0c71c6', 5, 'variable'),
      candidate('#22aa44', 61, 'fill'),
      candidate('#118833', 61, 'fill'),
    ])
    expect(ranked.map((entry) => entry.hex)).toEqual([
      '#0c71c6', // variable tier wins despite lowest count
      '#f2653a', // style tier
      '#118833', // fill tier, chromatic, tie on count → hex order
      '#22aa44',
      '#e5e5e5', // near-gray sinks despite highest count
    ])
  })
})

describe('om-figma-brand-extract@1 schema pin', () => {
  const expectedPath = path.join(__dirname, 'fixtures', 'expected-extract.json')

  it('serializes byte-for-byte to the committed fixture (deterministic)', async () => {
    const first = serializeExtraction(await runExtraction())
    const second = serializeExtraction(await runExtraction())
    expect(second).toBe(first)
    expect(first).toBe(fs.readFileSync(expectedPath, 'utf8'))
  })

  it('never contains the token', async () => {
    const serialized = serializeExtraction(await runExtraction())
    expect(serialized).not.toContain('figd_test_sentinel')
  })
})
