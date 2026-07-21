import { buildContrastChecks } from '../init'
import { derivePalette } from '../palette'
import { renderBrandReport, type ConfirmedMapping } from '../brand-report'
import { extractBrand, type BrandExtraction } from '../figma-extract'
import { createFigmaFixtureFetch, FIXTURE_FILE_KEY, FIXTURE_NOW } from './fixtures/figma-fixture-fetch'

const MAPPING: ConfirmedMapping = {
  primary: '#0c71c6',
  primaryForeground: null,
  radius: '8px',
  font: 'Inter',
  fontMono: 'JetBrains Mono',
}

describe('renderBrandReport', () => {
  let extraction: BrandExtraction

  beforeAll(async () => {
    extraction = await extractBrand({
      fileKey: FIXTURE_FILE_KEY,
      token: 'figd_test_sentinel',
      fetchImpl: createFigmaFixtureFetch(),
      sleepImpl: async () => {},
      now: FIXTURE_NOW,
      log: () => {},
    })
  })

  it('renders the mapped report (snapshot)', () => {
    const palette = derivePalette({ primaryHex: MAPPING.primary, primaryForegroundHex: null })
    const checks = buildContrastChecks(palette)
    const report = renderBrandReport({
      extraction,
      mapping: MAPPING,
      palette,
      checks,
      notes: ['--map primary #0c71c6 confirmed against candidate #1.'],
    })
    expect(report).toMatchSnapshot()
  })

  it('renders the report-only report (snapshot)', () => {
    const report = renderBrandReport({ extraction, mapping: null, palette: null, checks: null })
    expect(report).toMatchSnapshot()
    expect(report).toContain('No mapping performed')
    expect(report).toContain('## Unmapped candidates')
  })

  it('is deterministic', () => {
    const first = renderBrandReport({ extraction, mapping: null, palette: null, checks: null })
    const second = renderBrandReport({ extraction, mapping: null, palette: null, checks: null })
    expect(second).toBe(first)
  })

  it('surfaces truncation in the source summary', () => {
    const truncated: BrandExtraction = {
      ...extraction,
      source: {
        ...extraction.source,
        frames: { ...extraction.source.frames, truncated: true },
      },
    }
    const report = renderBrandReport({ extraction: truncated, mapping: null, palette: null, checks: null })
    expect(report).toContain('truncated at the node budget')
  })
})
