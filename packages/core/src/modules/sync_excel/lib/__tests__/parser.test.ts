import { Readable } from 'stream'
import { detectCsvDelimiter, parseCsvDocumentBatches, parseCsvPreview, parseCsvStreamMetadata, parseCsvText } from '../parser'

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

  it('parses CSV metadata and rows incrementally by batch and offset', async () => {
    const chunks = [
      Buffer.from('\uFEFFRecord Id,Lead Name,Description\next-1,Ada,"Line one'),
      Buffer.from('\nline two"\next-2,Grace,\next-3,Linus,"Kernel "'),
      Buffer.from('"main"""\n', 'utf-8'),
    ]

    const metadata = await parseCsvStreamMetadata(Readable.from(chunks))

    expect(metadata).toMatchObject({
      delimiter: ',',
      encoding: 'utf-8',
      headers: ['Record Id', 'Lead Name', 'Description'],
      totalRows: 3,
    })

    const batches = []
    for await (const batch of parseCsvDocumentBatches(Readable.from(chunks), {
      batchSize: 1,
      startOffset: 1,
    })) {
      batches.push(batch)
    }

    expect(batches).toEqual([
      {
        delimiter: ',',
        encoding: 'utf-8',
        headers: ['Record Id', 'Lead Name', 'Description'],
        rowStart: 1,
        nextOffset: 2,
        rows: [{ 'Record Id': 'ext-2', 'Lead Name': 'Grace', Description: null }],
      },
      {
        delimiter: ',',
        encoding: 'utf-8',
        headers: ['Record Id', 'Lead Name', 'Description'],
        rowStart: 2,
        nextOffset: 3,
        rows: [{ 'Record Id': 'ext-3', 'Lead Name': 'Linus', Description: 'Kernel "main"' }],
      },
    ])
  })

  it('detects semicolon CSV when the header spans multiple chunks', async () => {
    const chunks = [
      Buffer.from('Record Id'),
      Buffer.from(';Lead Name\next-1;Ada Lovelace\n'),
    ]

    const metadata = await parseCsvStreamMetadata(Readable.from(chunks))

    expect(metadata).toMatchObject({
      delimiter: ';',
      headers: ['Record Id', 'Lead Name'],
      totalRows: 1,
    })
  })
})
