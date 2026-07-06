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

  it('preserves all source headers from Zoho-style lead exports', () => {
    const buffer = Buffer.from(
      [
        'Record Id,Lead Name,Company,Created Time,Service needed,Lead Source,Lead Status,Annual Revenue,Referred by,Industry',
        'zcrm_1,Wojciech Skrzypiec,Wojciech Skrzypiec,2020-04-10 20:12:31,,Facebook,Lost Lead,,,Health Care',
      ].join('\n'),
      'utf-8',
    )

    const preview = parseCsvPreview(buffer, { maxRows: 5 })

    expect(preview.headers).toEqual([
      'Record Id',
      'Lead Name',
      'Company',
      'Created Time',
      'Service needed',
      'Lead Source',
      'Lead Status',
      'Annual Revenue',
      'Referred by',
      'Industry',
    ])
    expect(preview.headers).toHaveLength(10)
    expect(preview.totalRows).toBe(1)
    expect(preview.sampleRows[0]).toMatchObject({
      'Record Id': 'zcrm_1',
      Company: 'Wojciech Skrzypiec',
      Industry: 'Health Care',
    })
  })
})
