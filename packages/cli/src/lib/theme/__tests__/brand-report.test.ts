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

  it('surfaces failed request batches, and stays silent on a clean scan', () => {
    const clean = renderBrandReport({ extraction, mapping: null, palette: null, checks: null })
    expect(clean).not.toContain('Failed request batches')

    const withFailures: BrandExtraction = {
      ...extraction,
      source: { ...extraction.source, failedBatches: { styles: 1, frames: 2 } },
    }
    const report = renderBrandReport({ extraction: withFailures, mapping: null, palette: null, checks: null })
    expect(report).toContain('**Failed request batches:** 1 style batch(es) and 2 frame batch(es)')
    expect(report).toContain('the inventory is incomplete')
  })

  it('escapes pipes from remote and user strings in markdown table cells', () => {
    const hostile: BrandExtraction = {
      ...extraction,
      candidates: [
        {
          hex: '#0c71c6',
          count: 6,
          tier: 'style',
          sources: ['style'],
          styleNames: ['Evil | Name'],
          variableName: null,
        },
        ...extraction.candidates.filter((candidate) => candidate.hex !== '#0c71c6'),
      ],
      fonts: [{ family: 'Sneaky | Font', weights: [400], textStyles: 1, usageCount: 10 }],
    }
    const palette = derivePalette({ primaryHex: '#0c71c6', primaryForegroundHex: null })
    const checks = buildContrastChecks(palette)
    const report = renderBrandReport({
      extraction: hostile,
      mapping: { ...MAPPING, font: 'My | Font' },
      palette,
      checks,
    })
    // Every raw pipe inside a cell is escaped; the table structure survives.
    expect(report).toContain('style "Evil \\| Name"')
    expect(report).toContain('`My \\| Font`')
    expect(report).toContain('Sneaky \\| Font')
    expect(report).not.toContain('Evil | Name')
    expect(report).not.toContain('Sneaky | Font')
  })
})
