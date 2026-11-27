export const CAPTURE_DEFAULT_WIDTHS = [390, 768, 1024, 1440]
export const CAPTURE_MODES = ['light', 'dark'] as const
export type CaptureMode = (typeof CAPTURE_MODES)[number]
export const CAPTURE_DEFAULT_GROUP = 'blocks'

export const CAPTURE_USAGE = [
  'Usage: node apps/design/scripts/capture-states.mjs --base <url> --out <dir> [options]',
  '',
  '  --base <url>          Origin of a running design app, for example http://localhost:3020',
  '  --out <dir>           Directory for screenshots and report.json',
  '  --group <group>       Capture every entry of a group (default: blocks, unless --entry is given)',
  '  --entry <id>          Capture one entry; repeat or separate ids with commas',
  '  --widths <list>       Viewport widths in px (default: 390,768,1024,1440)',
  '  --modes <list>        Colour modes: light, dark (default: light,dark)',
  '  --concurrency <n>     Pages captured in parallel (default: 4)',
  '  --no-fail             Exit 0 even when a capture has errors or page overflow',
  '  --help                Print this message',
].join('\n')

export type CaptureOptions = {
  base: string
  out: string
  group: string | null
  entries: string[]
  widths: number[]
  modes: CaptureMode[]
  concurrency: number
  fail: boolean
  help: boolean
}

export type CaptureManifest = {
  entries: Array<{ id: string; group: string; variants: Array<{ id: string }> }>
}

export type CaptureTarget = {
  entryId: string
  variantId: string
  width: number
  mode: CaptureMode
  url: string
  file: string
}

export type CaptureElement = {
  tag: string
  label: string
  width: number
  height: number
}

export type CaptureResult = CaptureTarget & {
  consoleErrors: string[]
  pageErrors: string[]
  documentWidth: number
  pageOverflow: boolean
  overflowingElements: CaptureElement[]
  overflowingElementCount: number
  smallTargets: CaptureElement[]
  smallTargetCount: number
}

export type CaptureSummaryRow = {
  entryId: string
  captures: number
  errors: number
  overflows: number
  smallTargets: number
}

function isCaptureMode(value: string): value is CaptureMode {
  return (CAPTURE_MODES as readonly string[]).includes(value)
}

function splitList(value: string): string[] {
  return value.split(',').map((part) => part.trim()).filter((part) => part.length > 0)
}

function positiveInteger(flag: string, value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} expects positive whole numbers, received "${value}"`)
  return parsed
}

export function parseCaptureArgs(argv: readonly string[]): CaptureOptions {
  const options: CaptureOptions = {
    base: '',
    out: '',
    group: null,
    entries: [],
    widths: [...CAPTURE_DEFAULT_WIDTHS],
    modes: [...CAPTURE_MODES],
    concurrency: 4,
    fail: true,
    help: false,
  }
  let index = 0
  const valueFor = (flag: string): string => {
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`)
    index += 1
    return value
  }
  while (index < argv.length) {
    const flag = argv[index]
    if (flag === '--help') options.help = true
    else if (flag === '--no-fail') options.fail = false
    else if (flag === '--base') options.base = valueFor(flag).replace(/\/+$/, '')
    else if (flag === '--out') options.out = valueFor(flag)
    else if (flag === '--group') options.group = valueFor(flag)
    else if (flag === '--entry') options.entries.push(...splitList(valueFor(flag)))
    else if (flag === '--widths') options.widths = splitList(valueFor(flag)).map((part) => positiveInteger(flag, part))
    else if (flag === '--concurrency') options.concurrency = positiveInteger(flag, valueFor(flag))
    else if (flag === '--modes') {
      options.modes = splitList(valueFor(flag)).map((part) => {
        if (!isCaptureMode(part)) throw new Error(`--modes accepts light and dark, received "${part}"`)
        return part
      })
    } else throw new Error(`Unknown argument "${flag}"`)
    index += 1
  }
  if (options.help) return options
  if (!options.base) throw new Error('--base is required')
  if (!options.out) throw new Error('--out is required')
  if (options.widths.length === 0) throw new Error('--widths needs at least one width')
  if (options.modes.length === 0) throw new Error('--modes needs at least one mode')
  options.widths = [...new Set(options.widths)]
  options.modes = [...new Set(options.modes)]
  options.entries = [...new Set(options.entries)]
  if (options.group === null && options.entries.length === 0) options.group = CAPTURE_DEFAULT_GROUP
  return options
}

export function capturePreviewPath(entryId: string, variantId: string, mode: CaptureMode): string {
  return `/preview/${entryId}/${variantId}/?mode=${mode}`
}

export function captureFileName(variantId: string, width: number, mode: CaptureMode): string {
  return `${variantId}__${width}__${mode}.png`
}

export function buildCapturePlan(
  manifest: CaptureManifest,
  options: Pick<CaptureOptions, 'base' | 'group' | 'entries' | 'widths' | 'modes'>,
): CaptureTarget[] {
  const unknown = options.entries.filter((entryId) => !manifest.entries.some((entry) => entry.id === entryId))
  if (unknown.length > 0) throw new Error(`Unknown entry: ${unknown.join(', ')}`)
  const selected = manifest.entries.filter((entry) => {
    if (options.group !== null && entry.group !== options.group) return false
    return options.entries.length === 0 || options.entries.includes(entry.id)
  })
  if (selected.length === 0) throw new Error('No entries match the given --group and --entry')
  return selected.flatMap((entry) =>
    entry.variants.flatMap((variant) =>
      options.widths.flatMap((width) =>
        options.modes.map((mode) => ({
          entryId: entry.id,
          variantId: variant.id,
          width,
          mode,
          url: `${options.base}${capturePreviewPath(entry.id, variant.id, mode)}`,
          file: `${entry.id}/${captureFileName(variant.id, width, mode)}`,
        })),
      ),
    ),
  )
}

export function captureHasFailure(result: CaptureResult): boolean {
  return result.consoleErrors.length > 0 || result.pageErrors.length > 0 || result.pageOverflow
}

export function summarizeCaptures(results: readonly CaptureResult[]): CaptureSummaryRow[] {
  const rows = new Map<string, CaptureSummaryRow>()
  for (const result of results) {
    const row = rows.get(result.entryId) ?? { entryId: result.entryId, captures: 0, errors: 0, overflows: 0, smallTargets: 0 }
    row.captures += 1
    row.errors += result.consoleErrors.length + result.pageErrors.length
    row.overflows += result.pageOverflow ? 1 : 0
    row.smallTargets += result.smallTargetCount
    rows.set(result.entryId, row)
  }
  return [...rows.values()]
}

export function formatSummaryTable(rows: readonly CaptureSummaryRow[]): string {
  const header = ['entry', 'captures', 'errors', 'overflows', 'small targets']
  const body = rows.map((row) => [row.entryId, String(row.captures), String(row.errors), String(row.overflows), String(row.smallTargets)])
  const table = [header, ...body]
  const sizes = header.map((title, column) => Math.max(...table.map((line) => line[column].length)))
  const format = (line: string[]) =>
    line.map((value, column) => (column === 0 ? value.padEnd(sizes[column]) : value.padStart(sizes[column]))).join('  ')
  return [format(header), sizes.map((size) => '-'.repeat(size)).join('  '), ...body.map(format)].join('\n')
}
