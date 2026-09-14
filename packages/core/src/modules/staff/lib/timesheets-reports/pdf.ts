/**
 * A minimal, dependency-free PDF writer — just enough to print the report sheet
 * of screen 14 as the client-facing document US-G4 asks for.
 *
 * The repository has no PDF library and adding a production dependency is an
 * "ask first" change, so this emits PDF 1.4 directly: a catalog, a pages tree,
 * two base-14 fonts and one content stream per page. Nothing here is a general
 * PDF toolkit; it lays out left-aligned and right-aligned text runs on a fixed
 * grid, which is exactly what a table of hours and amounts needs.
 *
 * **Polish text is the reason for the encoding work.** The mockups are Polish
 * and a report is a client-facing document, so `ą ć ę ł ń ś ź ż` must survive.
 * WinAnsiEncoding covers `ó`/`Ó` and nothing else Polish, so the remaining
 * sixteen glyphs are mapped into unused low code points through a `/Differences`
 * array using their standard Adobe glyph names. A character with no mapping is
 * rendered as `?` rather than being dropped, so a missing glyph is visible
 * rather than silently changing a name.
 */

export type PdfTextAlign = 'left' | 'right'

export type PdfCell = {
  text: string
  x: number
  align?: PdfTextAlign
  bold?: boolean
  size?: number
  /** Grey for hints and secondary text; black otherwise. */
  muted?: boolean
}

export type PdfLine =
  | { kind: 'cells'; cells: PdfCell[] }
  | { kind: 'rule' }
  | { kind: 'space'; height: number }

export type PdfDocumentInput = {
  title: string
  lines: PdfLine[]
}

export const PDF_CONTENT_TYPE = 'application/pdf'

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN_X = 42
const MARGIN_TOP = 56
const MARGIN_BOTTOM = 48
const LINE_HEIGHT = 14
const DEFAULT_SIZE = 9

/**
 * Glyphs Polish needs that WinAnsiEncoding does not carry, parked in unused
 * low code points and declared through /Differences.
 */
const DIFFERENCE_GLYPHS: Array<[string, number, string]> = [
  ['ą', 1, 'aogonek'],
  ['ć', 2, 'cacute'],
  ['ę', 3, 'eogonek'],
  ['ł', 4, 'lslash'],
  ['ń', 5, 'nacute'],
  ['ś', 6, 'sacute'],
  ['ź', 7, 'zacute'],
  ['ż', 8, 'zdotaccent'],
  ['Ą', 9, 'Aogonek'],
  ['Ć', 10, 'Cacute'],
  ['Ę', 11, 'Eogonek'],
  ['Ł', 12, 'Lslash'],
  ['Ń', 13, 'Nacute'],
  ['Ś', 14, 'Sacute'],
  ['Ź', 15, 'Zacute'],
  ['Ż', 16, 'Zdotaccent'],
]

/** Characters WinAnsiEncoding already carries at a code above ASCII. */
const WIN_ANSI_EXTRAS: Record<string, number> = {
  'ó': 0xf3,
  'Ó': 0xd3,
  'é': 0xe9,
  'è': 0xe8,
  'ä': 0xe4,
  'ö': 0xf6,
  'ü': 0xfc,
  'ß': 0xdf,
  'á': 0xe1,
  'í': 0xed,
  'ñ': 0xf1,
  'ú': 0xfa,
  '–': 0x96,
  '—': 0x97,
  '·': 0xb7,
  '€': 0x80,
  '„': 0x84,
  '”': 0x94,
  '’': 0x92,
  '‘': 0x91,
  '…': 0x85,
  '°': 0xb0,
  '×': 0xd7,
}

const ENCODING_MAP: Map<string, number> = (() => {
  const map = new Map<string, number>()
  for (let code = 32; code <= 126; code += 1) map.set(String.fromCharCode(code), code)
  for (const [char, code] of Object.entries(WIN_ANSI_EXTRAS)) map.set(char, code)
  for (const [char, code] of DIFFERENCE_GLYPHS) map.set(char, code)
  return map
})()

export function encodePdfText(value: string): string {
  let out = ''
  for (const char of value) {
    const code = ENCODING_MAP.get(char) ?? 0x3f
    const byte = String.fromCharCode(code)
    if (byte === '(' || byte === ')' || byte === '\\') out += `\\${byte}`
    else out += byte
  }
  return out
}

/**
 * Helvetica advance widths (1/1000 em) for the printable ASCII range, used to
 * right-align the money and hours columns. Characters outside the table fall
 * back to the average width, which is close enough for the accented letters and
 * only ever shifts a right-aligned label by a hair.
 */
const HELVETICA_WIDTHS: Record<string, number> = (() => {
  const widths: Record<string, number> = {}
  const groups: Array<[number, string]> = [
    [278, ' !I|jltfi.,:;\'`'],
    [355, '"'],
    [556, '#$0123456789+<=>~'],
    [889, '%'],
    [667, '&BCDEHKNRSUVXY'],
    [333, '()[]{}/\\*-r'],
    [584, '^'],
    [500, '?_'],
    [1015, '@'],
    [722, 'ADGHOQ'],
    [611, 'FPZ'],
    [944, 'M'],
    [778, 'W'],
    [556, 'abcdeghknopqsu'],
    [222, 'i'],
    [500, 'yvz'],
    [833, 'm'],
    [722, 'w'],
    [333, 'JLT'],
  ]
  for (const [width, chars] of groups) {
    for (const char of chars) widths[char] = width
  }
  return widths
})()

export function measureText(text: string, size: number, bold: boolean): number {
  let units = 0
  for (const char of text) units += HELVETICA_WIDTHS[char] ?? 556
  // Helvetica-Bold runs a touch wider; a flat factor is accurate enough for
  // right-aligning a column and avoids shipping a second width table.
  const factor = bold ? 1.03 : 1
  return (units / 1000) * size * factor
}

type PageContent = string[]

function buildPages(input: PdfDocumentInput): PageContent[] {
  const pages: PageContent[] = []
  let current: PageContent = []
  let y = PAGE_HEIGHT - MARGIN_TOP

  const pushPage = () => {
    if (current.length > 0) pages.push(current)
    current = []
    y = PAGE_HEIGHT - MARGIN_TOP
  }

  for (const line of input.lines) {
    const height = line.kind === 'space' ? line.height : LINE_HEIGHT
    if (y - height < MARGIN_BOTTOM) pushPage()

    if (line.kind === 'space') {
      y -= line.height
      continue
    }
    if (line.kind === 'rule') {
      current.push(
        `0.8 0.8 0.8 RG 0.5 w ${MARGIN_X} ${(y - 4).toFixed(2)} m ${(PAGE_WIDTH - MARGIN_X).toFixed(2)} ${(y - 4).toFixed(2)} l S`,
      )
      y -= LINE_HEIGHT
      continue
    }

    for (const cell of line.cells) {
      const size = cell.size ?? DEFAULT_SIZE
      const font = cell.bold ? '/F2' : '/F1'
      const width = measureText(cell.text, size, cell.bold === true)
      const x = cell.align === 'right' ? cell.x - width : cell.x
      const colour = cell.muted ? '0.45 0.45 0.45 rg' : '0 0 0 rg'
      current.push(
        `BT ${colour} ${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${encodePdfText(cell.text)}) Tj ET`,
      )
    }
    y -= LINE_HEIGHT
  }

  pushPage()
  return pages.length > 0 ? pages : [[]]
}

export function buildPdf(input: PdfDocumentInput): Buffer {
  const pages = buildPages(input)
  const objects: string[] = []

  const differences = DIFFERENCE_GLYPHS.map(([, code, glyph]) => `${code} /${glyph}`).join(' ')
  const pageObjectStart = 6
  const pageIds = pages.map((_, index) => pageObjectStart + index * 2)

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding 5 0 R >>'
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding 5 0 R >>'
  objects[5] = `<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [${differences}] >>`

  pages.forEach((content, index) => {
    const pageId = pageIds[index]
    const contentId = pageId + 1
    const stream = content.join('\n')
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`
  })

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')]
  let offset = chunks[0].length
  const offsets: number[] = []

  for (let id = 1; id < objects.length; id += 1) {
    const body = objects[id]
    if (body === undefined) continue
    offsets[id] = offset
    const chunk = Buffer.from(`${id} 0 obj\n${body}\nendobj\n`, 'latin1')
    chunks.push(chunk)
    offset += chunk.length
  }

  const maxId = objects.length
  const xrefOffset = offset
  const xrefRows = ['0000000000 65535 f \n']
  for (let id = 1; id < maxId; id += 1) {
    const at = offsets[id]
    xrefRows.push(at === undefined ? '0000000000 65535 f \n' : `${String(at).padStart(10, '0')} 00000 n \n`)
  }
  chunks.push(
    Buffer.from(
      `xref\n0 ${maxId}\n${xrefRows.join('')}trailer\n<< /Size ${maxId} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
      'latin1',
    ),
  )

  return Buffer.concat(chunks)
}
