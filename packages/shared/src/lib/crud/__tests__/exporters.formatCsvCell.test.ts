import { formatCsvCell, serializeExport } from '../exporters'

describe('formatCsvCell', () => {
  it.each([
    ['=HYPERLINK("https://example.invalid")', `"'=HYPERLINK(""https://example.invalid"")"`],
    ['+1+1', "'+1+1"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1:A2)', "'@SUM(A1:A2)"],
    ['\t=1+1', "'\t=1+1"],
    ['\r=1+1', `"'\r=1+1"`],
    ['\n=1+1', `"'\n=1+1"`],
  ])('neutralizes a formula-leading string %j', (input, expected) => {
    expect(formatCsvCell(input)).toBe(expected)
  })

  it('keeps ordinary text and still quotes CSV delimiters', () => {
    expect(formatCsvCell('A-01-03')).toBe('A-01-03')
    expect(formatCsvCell('WH1 · Main, North')).toBe('"WH1 · Main, North"')
    expect(formatCsvCell('say "hi"')).toBe('"say ""hi"""')
    expect(formatCsvCell('line\rbreak')).toBe('"line\rbreak"')
  })

  it('leaves real numbers untouched, including negatives', () => {
    expect(formatCsvCell(-5)).toBe('-5')
    expect(formatCsvCell(0)).toBe('0')
    expect(formatCsvCell(12.5)).toBe('12.5')
  })

  it('renders null and undefined as empty cells', () => {
    expect(formatCsvCell(null)).toBe('')
    expect(formatCsvCell(undefined)).toBe('')
  })

  it('matches the cell output of the shared CSV serializer', () => {
    const values: unknown[] = ['=1+1', '@x', 'plain', 'a,b', -42, '-7', null]
    const serialized = serializeExport({
      columns: values.map((_, index) => ({ field: `c${index}`, header: `C${index}` })),
      rows: [Object.fromEntries(values.map((value, index) => [`c${index}`, value]))],
    }, 'csv')
    expect(serialized.body.split('\n')[1]).toBe(values.map((value) => formatCsvCell(value)).join(','))
  })
})
