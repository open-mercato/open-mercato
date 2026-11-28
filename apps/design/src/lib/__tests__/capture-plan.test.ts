import {
  buildCapturePlan,
  captureFileName,
  captureHasFailure,
  capturePreviewPath,
  formatSummaryTable,
  parseCaptureArgs,
  summarizeCaptures,
  type CaptureManifest,
  type CaptureResult,
} from '../capture-plan'
import { previewHref } from '../links'

const manifest: CaptureManifest = {
  entries: [
    { id: 'kanban', group: 'blocks', variants: [{ id: 'default' }, { id: 'empty' }] },
    { id: 'wizard', group: 'blocks', variants: [{ id: 'basic' }] },
    { id: 'button', group: 'components', variants: [{ id: 'sizes' }] },
  ],
}

function result(overrides: Partial<CaptureResult>): CaptureResult {
  return {
    entryId: 'kanban',
    variantId: 'default',
    width: 390,
    mode: 'light',
    url: 'http://localhost:3020/preview/kanban/default/?mode=light',
    file: 'kanban/default__390__light.png',
    consoleErrors: [],
    pageErrors: [],
    documentWidth: 390,
    pageOverflow: false,
    overflowingElements: [],
    overflowingElementCount: 0,
    smallTargets: [],
    smallTargetCount: 0,
    ...overrides,
  }
}

describe('parseCaptureArgs', () => {
  it('applies defaults and captures blocks when nothing is selected', () => {
    expect(parseCaptureArgs(['--base', 'http://localhost:3020/', '--out', 'shots'])).toEqual({
      base: 'http://localhost:3020',
      out: 'shots',
      group: 'blocks',
      entries: [],
      widths: [390, 768, 1024, 1440],
      modes: ['light', 'dark'],
      concurrency: 4,
      fail: true,
      help: false,
    })
  })

  it('reads repeated and comma separated entries, widths, modes and flags', () => {
    const options = parseCaptureArgs([
      '--base', 'http://localhost:3020', '--out', 'shots',
      '--entry', 'kanban', '--entry', 'wizard,kanban',
      '--widths', '390, 1440', '--modes', 'dark', '--concurrency', '2', '--no-fail',
    ])
    expect(options.entries).toEqual(['kanban', 'wizard'])
    expect(options.group).toBeNull()
    expect(options.widths).toEqual([390, 1440])
    expect(options.modes).toEqual(['dark'])
    expect(options.concurrency).toBe(2)
    expect(options.fail).toBe(false)
  })

  it('rejects missing and invalid input', () => {
    expect(() => parseCaptureArgs(['--out', 'shots'])).toThrow('--base is required')
    expect(() => parseCaptureArgs(['--base', 'http://localhost:3020'])).toThrow('--out is required')
    expect(() => parseCaptureArgs(['--base'])).toThrow('--base needs a value')
    expect(() => parseCaptureArgs(['--base', 'x', '--out', 'y', '--widths', '390,wide'])).toThrow('--widths expects positive whole numbers')
    expect(() => parseCaptureArgs(['--base', 'x', '--out', 'y', '--modes', 'sepia'])).toThrow('--modes accepts light and dark')
    expect(() => parseCaptureArgs(['--base', 'x', '--out', 'y', '--verbose'])).toThrow('Unknown argument "--verbose"')
  })

  it('returns early for --help', () => {
    expect(parseCaptureArgs(['--help']).help).toBe(true)
  })
})

describe('buildCapturePlan', () => {
  it('enumerates every variant, width and mode of the group', () => {
    const plan = buildCapturePlan(manifest, { base: 'http://localhost:3020', group: 'blocks', entries: [], widths: [390, 1440], modes: ['light', 'dark'] })
    expect(plan).toHaveLength(12)
    expect(plan[0]).toEqual({
      entryId: 'kanban',
      variantId: 'default',
      width: 390,
      mode: 'light',
      url: 'http://localhost:3020/preview/kanban/default/?mode=light',
      file: 'kanban/default__390__light.png',
    })
    expect(plan.some((target) => target.entryId === 'button')).toBe(false)
  })

  it('limits the plan to the named entries', () => {
    const plan = buildCapturePlan(manifest, { base: 'http://x', group: null, entries: ['button', 'wizard'], widths: [768], modes: ['dark'] })
    expect(plan.map((target) => target.file)).toEqual(['wizard/basic__768__dark.png', 'button/sizes__768__dark.png'])
  })

  it('fails for unknown entries and empty selections', () => {
    expect(() => buildCapturePlan(manifest, { base: 'http://x', group: null, entries: ['missing'], widths: [390], modes: ['light'] })).toThrow('Unknown entry: missing')
    expect(() => buildCapturePlan(manifest, { base: 'http://x', group: 'blocks', entries: ['button'], widths: [390], modes: ['light'] })).toThrow('No entries match')
  })

  it('addresses the same preview route as the app', () => {
    expect(capturePreviewPath('kanban', 'default', 'dark')).toBe(previewHref('kanban', 'default', 'dark'))
    expect(captureFileName('default', 1024, 'dark')).toBe('default__1024__dark.png')
  })
})

describe('capture summary', () => {
  const results = [
    result({}),
    result({ width: 1440, consoleErrors: ['boom'], pageErrors: ['bang'], smallTargetCount: 2 }),
    result({ entryId: 'wizard', pageOverflow: true, documentWidth: 420, smallTargetCount: 1 }),
  ]

  it('marks captures with errors or page overflow as failed', () => {
    expect(results.map(captureHasFailure)).toEqual([false, true, true])
    expect(captureHasFailure(result({ smallTargetCount: 3, overflowingElementCount: 1 }))).toBe(false)
  })

  it('totals captures per entry', () => {
    expect(summarizeCaptures(results)).toEqual([
      { entryId: 'kanban', captures: 2, errors: 2, overflows: 0, smallTargets: 2 },
      { entryId: 'wizard', captures: 1, errors: 0, overflows: 1, smallTargets: 1 },
    ])
  })

  it('prints an aligned table', () => {
    expect(formatSummaryTable(summarizeCaptures(results))).toBe(
      [
        'entry   captures  errors  overflows  small targets',
        '------  --------  ------  ---------  -------------',
        'kanban         2       2          0              2',
        'wizard         1       0          1              1',
      ].join('\n'),
    )
  })
})
