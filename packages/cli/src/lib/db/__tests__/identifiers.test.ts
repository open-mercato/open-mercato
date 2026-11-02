import { quotePostgresIdentifier } from '../identifiers'

describe('quotePostgresIdentifier', () => {
  it.each([
    ['a plain name', 'open_mercato', '"open_mercato"'],
    ['case, digits, and hyphens', 'Open-Mercato_123', '"Open-Mercato_123"'],
    ['a single embedded quote', 'open"mercato', '"open""mercato"'],
    ['multiple embedded quotes', 'open""mercato"db', '"open""""mercato""db"'],
    ['a dotted name as one identifier', 'schema.table', '"schema.table"'],
    ['Unicode characters', 'zażółć_数据库', '"zażółć_数据库"'],
    [
      'SQL-like contents as one identifier',
      'database"; DROP DATABASE postgres;--',
      '"database""; DROP DATABASE postgres;--"',
    ],
  ])('quotes %s without changing its contents', (_description, identifier, expected) => {
    expect(quotePostgresIdentifier(identifier)).toBe(expected)
  })
})
