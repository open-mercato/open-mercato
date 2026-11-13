import { serializeExport } from '../exporters'

describe('CRUD export serializers', () => {
  it('neutralizes spreadsheet formula prefixes in CSV string cells', () => {
    const serialized = serializeExport({
      columns: [
        { field: 'name', header: 'Name' },
        { field: 'note', header: 'Note' },
        { field: 'balance', header: 'Balance' },
      ],
      rows: [
        {
          name: "=cmd|'/c calc'!A1",
          note: '@SUM(A1:A2)',
          balance: -42,
        },
        {
          name: '\t=HYPERLINK("https://example.invalid")',
          note: '\r+1+1',
          balance: '-7',
        },
      ],
    }, 'csv')

    expect(serialized.body.split('\n')).toEqual([
      'Name,Note,Balance',
      "'=cmd|'/c calc'!A1,'@SUM(A1:A2),-42",
      '"\'\t=HYPERLINK(""https://example.invalid"")","\'\r+1+1",\'-7',
    ])
  })

  it('escapes and neutralizes CSV header cells the same way as data cells', () => {
    const serialized = serializeExport({
      columns: [
        { field: 'company', header: 'Name, Inc.' },
        { field: 'formula', header: '=HEADER' },
        { field: 'plain', header: 'Balance' },
      ],
      rows: [
        { company: 'Acme', formula: 'ok', plain: 1 },
      ],
    }, 'csv')

    expect(serialized.body.split('\n')).toEqual([
      '"Name, Inc.",\'=HEADER,Balance',
      'Acme,ok,1',
    ])
  })
})
