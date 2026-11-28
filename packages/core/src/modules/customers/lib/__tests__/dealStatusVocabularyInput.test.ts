import { formatDealStatusAliases, parseDealStatusAliases } from '../dealStatusVocabularyInput'

it('ignores trailing commas and empty entries', () => {
  expect(parseDealStatusAliases(' signed, , approved, ')).toEqual(['signed', 'approved'])
  expect(parseDealStatusAliases(', ,')).toEqual([])
})

it('round trips aliases containing commas, quotes and backslashes', () => {
  const aliases = ['signed, approved', 'a"b', 'a\\b', 'plain']
  expect(parseDealStatusAliases(formatDealStatusAliases(aliases))).toEqual(aliases)
})

it('reports malformed quoted entries instead of silently splitting them', () => {
  expect(parseDealStatusAliases('"unfinished')).toBeNull()
  expect(parseDealStatusAliases('"signed"suffix')).toBeNull()
})
