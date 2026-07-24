import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  DEFAULT_NODE_BUDGET,
  EXTRACT_SCHEMA,
  extractBrand,
  parseFigmaFileKey,
  rankCandidates,
  readExtraction,
  sanitizeRemoteString,
  serializeExtraction,
  type BrandCandidate,
  type BrandExtraction,
  type FetchLike,
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

  it('caps a hostile or broken Retry-After at 60 seconds', async () => {
    const sleeps: number[] = []
    await extractBrand({
      fileKey: FIXTURE_FILE_KEY,
      token: 'figd_test_sentinel',
      fetchImpl: createFigmaFixtureFetch({ rateLimit429s: 1, retryAfter: '3600' }),
      sleepImpl: async (ms) => { sleeps.push(ms) },
      now: FIXTURE_NOW,
      log: noopLog,
    })
    expect(sleeps).toEqual([60_000])
  })

  it('falls back to 1s when Retry-After is unparseable', async () => {
    const sleeps: number[] = []
    await extractBrand({
      fileKey: FIXTURE_FILE_KEY,
      token: 'figd_test_sentinel',
      fetchImpl: createFigmaFixtureFetch({ rateLimit429s: 1, retryAfter: 'soon' }),
      sleepImpl: async (ms) => { sleeps.push(ms) },
      now: FIXTURE_NOW,
      log: noopLog,
    })
    expect(sleeps).toEqual([1000])
  })

  it('counts node batches that still fail after retries instead of silently dropping them', async () => {
    const extraction = await runExtraction({ nodes429Forever: true })
    // One style-node batch and one frame batch in the fixture — both dropped.
    expect(extraction.source.failedBatches).toEqual({ styles: 1, frames: 1 })
    expect(extraction.source.frames.nodesVisited).toBe(0)
    expect(extraction.styles).toEqual([])
  })

  it('records zero failed batches on a clean scan', async () => {
    const extraction = await runExtraction()
    expect(extraction.source.failedBatches).toEqual({ styles: 0, frames: 0 })
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

describe('sanitizeRemoteString (terminal-escape injection defense)', () => {
  // ESC + OSC title change, BEL, C1 CSI + SGR, and a markdown pipe.
  const HOSTILE_PREFIX = 'Evil\u001b]0;pwned\u0007 \u009b31m| '
  const SANITIZED_PREFIX = 'Evil]0;pwned 31m| '

  it('strips C0/C1 control characters and keeps everything else', () => {
    expect(sanitizeRemoteString(HOSTILE_PREFIX)).toBe(SANITIZED_PREFIX)
    expect(sanitizeRemoteString('plain Brand/Primary')).toBe('plain Brand/Primary')
    expect(sanitizeRemoteString('tab\tnewline\ncr\r')).toBe('tabnewlinecr')
  })

  it('sanitizes remote file, style, and font names at extraction intake', async () => {
    const base = createFigmaFixtureFetch()
    const hostileFetch: FetchLike = async (url, init) => {
      const response = await base(url, init)
      const body = (await response.json()) as Record<string, unknown> | null
      if (body && typeof body === 'object') {
        // File metadata response: prepend escape sequences to the file name.
        if (typeof body.name === 'string' && 'document' in body) {
          body.name = `${HOSTILE_PREFIX}${body.name}`
        }
        // Styles index: poison every style name.
        const meta = body.meta as { styles?: Array<{ name?: string }> } | undefined
        if (meta?.styles) {
          for (const entry of meta.styles) entry.name = `${HOSTILE_PREFIX}${entry.name ?? ''}`
        }
      }
      return { status: response.status, headers: response.headers, json: async () => body }
    }
    const extraction = await extractBrand({
      fileKey: FIXTURE_FILE_KEY,
      token: 'figd_test_sentinel',
      fetchImpl: hostileFetch,
      sleepImpl: instantSleep,
      now: FIXTURE_NOW,
      log: noopLog,
    })
    expect(extraction.file.name).toBe(`${SANITIZED_PREFIX}Acme Brand Book`)
    const primary = extraction.candidates.find((candidate) => candidate.hex === '#0c71c6')
    expect(primary?.styleNames).toContain(`${SANITIZED_PREFIX}Brand/Primary`)
    // No control byte survives anywhere in the serialized artifact.
    const serialized = serializeExtraction(extraction)
    expect(serialized).not.toContain('\u001b')
    expect(serialized).not.toContain('\u0007')
    expect(serialized).not.toContain('\u009b')
  })
})

describe('readExtraction (structural validation of reused artifacts)', () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'expected-extract.json')
  let tmpDir: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-read-extraction-'))
  })
  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const validDoc = () => JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as Record<string, any>
  const write = (name: string, content: unknown): string => {
    const filePath = path.join(tmpDir, name)
    fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content), 'utf8')
    return filePath
  }

  it('accepts a well-formed artifact', () => {
    expect(readExtraction(fixturePath).file.key).toBe(FIXTURE_FILE_KEY)
  })

  it('rejects invalid JSON with a clean error', () => {
    expect(() => readExtraction(write('broken.json', '{ not json'))).toThrow(/not valid JSON/)
  })

  it('rejects a schema mismatch with the dedicated message', () => {
    const doc = validDoc()
    doc.schema = 'something-else@9'
    expect(() => readExtraction(write('bad-schema.json', doc))).toThrow(/Unsupported extraction schema "something-else@9"/)
  })

  it('rejects missing candidates with a clean Error, not a downstream TypeError', () => {
    const doc = validDoc()
    delete doc.candidates
    let thrown: unknown
    try {
      readExtraction(write('no-candidates.json', doc))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).not.toBeInstanceOf(TypeError)
    expect((thrown as Error).message).toContain('candidates must be an array')
  })

  it('rejects candidates that are not objects with string hexes', () => {
    const doc = validDoc()
    doc.candidates = [{ hex: 123 }]
    expect(() => readExtraction(write('bad-hex.json', doc))).toThrow(/string hex/)
    doc.candidates = ['#0c71c6']
    expect(() => readExtraction(write('string-candidate.json', doc))).toThrow(/string hex/)
  })

  it('rejects a non-string file.key', () => {
    const doc = validDoc()
    doc.file.key = 42
    expect(() => readExtraction(write('bad-key.json', doc))).toThrow(/file\.key must be a non-empty string/)
  })

  it('rejects a missing source.frames object', () => {
    const doc = validDoc()
    delete doc.source.frames
    expect(() => readExtraction(write('no-frames.json', doc))).toThrow(/source\.frames must be an object/)
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
