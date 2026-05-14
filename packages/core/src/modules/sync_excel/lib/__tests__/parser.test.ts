import { detectCsvDelimiter, parseCsvPreview, parseCsvText } from '../parser'

describe('sync_excel parser', () => {
  it('detects comma-delimited CSV with BOM and builds preview rows', () => {
    const buffer = Buffer.from('\uFEFFRecord Id,First Name,Email\nzcrm_1,Ada,ada@example.com\nzcrm_2,Linus,\n', 'utf-8')

    const preview = parseCsvPreview(buffer, { maxRows: 5 })

    expect(preview.delimiter).toBe(',')
    expect(preview.headers).toEqual(['Record Id', 'First Name', 'Email'])
    expect(preview.totalRows).toBe(2)
    expect(preview.sampleRows).toEqual([
      { 'Record Id': 'zcrm_1', 'First Name': 'Ada', Email: 'ada@example.com' },
      { 'Record Id': 'zcrm_2', 'First Name': 'Linus', Email: null },
    ])
  })

  it('detects semicolon-delimited CSV and preserves quoted delimiters', () => {
    const text = 'Company;Description\n"ACME";"Line one; still same field"\n'

    expect(detectCsvDelimiter(text)).toBe(';')
    expect(parseCsvText(text, ';')).toEqual([
      ['Company', 'Description'],
      ['ACME', 'Line one; still same field'],
    ])
  })
})
