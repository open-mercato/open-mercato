import { serializeExport } from '../exporters'
import { EU_DISPLAY_TEMPLATE, US_DISPLAY_TEMPLATE } from '../../display/templates'

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
})

describe('market display profile in exports', () => {
  const prepared = {
    columns: [
      { field: 'name', header: 'Name' },
      { field: 'total', header: 'Total' },
      { field: 'due', header: 'Due' },
    ],
    rows: [{ name: 'Ridgeview Collision', total: 48250.5, due: new Date('2026-10-18T00:00:00.000Z') }],
  }

  it('renders CSV dates and numbers in the market conventions', () => {
    const body = serializeExport(prepared, 'csv', US_DISPLAY_TEMPLATE).body
    // Midnight UTC is the previous evening in America/Chicago, and the market's zone is applied:
    // this instant genuinely falls on 17 October for a merchant in Texas.
    expect(body).toContain('10/17/2026')
    expect(body).toContain('48,250.5')
  })

  it('uses the market separators and negative style for a European market', () => {
    const body = serializeExport(
      { ...prepared, rows: [{ name: 'Zakład', total: -1234.5, due: new Date('2026-10-18T00:00:00.000Z') }] },
      'csv',
      EU_DISPLAY_TEMPLATE,
    ).body
    expect(body).toContain('18.10.2026')
    // The whole cell, not a substring: a formatted negative amount must not pick up the
    // spreadsheet-formula escape, whose pattern matches a leading minus. The cell is quoted
    // because the market's decimal separator is itself a comma.
    expect(body).toContain('"-1 234,5"')
    expect(body).not.toContain("'-")
  })

  it('leaves an export without a market exactly where it was', () => {
    const body = serializeExport(prepared, 'csv').body
    expect(body).toContain('2026-10-18T00:00:00.000Z')
    expect(body).toContain('48250.5')
    expect(serializeExport(prepared, 'csv', null).body).toBe(body)
  })

  it('keeps JSON and XML machine readable whatever the market says', () => {
    expect(serializeExport(prepared, 'json', US_DISPLAY_TEMPLATE).body).toContain('2026-10-18T00:00:00.000Z')
    expect(serializeExport(prepared, 'xml', US_DISPLAY_TEMPLATE).body).toContain('2026-10-18T00:00:00.000Z')
  })

  it('still neutralizes a spreadsheet formula under a market', () => {
    const body = serializeExport(
      { columns: [{ field: 'name', header: 'Name' }], rows: [{ name: '=cmd()' }] },
      'csv',
      US_DISPLAY_TEMPLATE,
    ).body
    expect(body).toContain("'=cmd()")
  })
})
