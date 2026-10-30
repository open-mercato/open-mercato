import { buildInventoryCsv } from '../inventoryCsvExport'

describe('buildInventoryCsv', () => {
  it('neutralizes formula-leading location, warehouse and lot labels', () => {
    const csv = buildInventoryCsv([
      ['Warehouse', 'Location', 'Lot', 'On hand', 'Reserved', 'Status'],
      ['=WH · Main', '=HYPERLINK("https://example.invalid")', '@LOT-1 · exp 01/27', 5, 0, 'In stock'],
      ['WH1 · Main', '+A-01', '-LOT', 3, 1, 'Reserved'],
    ])
    expect(csv.split('\n')).toEqual([
      'Warehouse,Location,Lot,On hand,Reserved,Status',
      `'=WH · Main,"'=HYPERLINK(""https://example.invalid"")",'@LOT-1 · exp 01/27,5,0,In stock`,
      "WH1 · Main,'+A-01,'-LOT,3,1,Reserved",
    ])
  })

  it.each([
    ['=1+1', "'=1+1"],
    ['+1+1', "'+1+1"],
    ['-1+1', "'-1+1"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\t=1+1', "'\t=1+1"],
    ['\n=1+1', `"'\n=1+1"`],
    ['A-01-03', 'A-01-03'],
  ])('renders the location code %j as %j', (code, expected) => {
    expect(buildInventoryCsv([[code]])).toBe(expected)
  })

  it('keeps numeric quantities numeric, including negatives', () => {
    expect(buildInventoryCsv([['A-01-03', -2, 0.5]])).toBe('A-01-03,-2,0.5')
  })

  it('quotes delimiters and line breaks in ordinary codes', () => {
    expect(buildInventoryCsv([['A,01', 'say "x"', 'a\rb']])).toBe('"A,01","say ""x""","a\rb"')
  })
})
