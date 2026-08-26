import type { SearchConfig } from '../config'
import { tokenizeText } from '../tokenize'

const baseConfig: SearchConfig = {
  enabled: true,
  minTokenLength: 3,
  enablePartials: true,
  hashAlgorithm: 'sha256',
  storeRawTokens: false,
  blocklistedFields: [],
}

describe('tokenizeText diacritic folding', () => {
  const wholeWordConfig: SearchConfig = { ...baseConfig, enablePartials: false }

  test.each([
    ['Łukasz', ['lukasz']],
    ['lukasz', ['lukasz']],
    ['Zażółć', ['zazolc']],
    ['Łódź', ['lodz']],
    ['Lodz', ['lodz']],
  ])('folds non-decomposing Polish letters in %s', (input, expected) => {
    const { tokens } = tokenizeText(input, wholeWordConfig)

    expect(tokens).toEqual(expected)
  })

  test.each([
    ['Bąk', ['bak']],
    ['Wróbel', ['wrobel']],
    ['Piotr Świątek', ['piotr', 'swiatek']],
  ])('keeps folding NFKD-decomposable diacritics in %s', (input, expected) => {
    const { tokens } = tokenizeText(input, wholeWordConfig)

    expect(tokens).toEqual(expected)
  })

  test.each([
    ['Jørgensen', ['jorgensen']],
    ['Đurić', ['duric']],
    ['Ħamrun', ['hamrun']],
    ['Işık', ['isik']],
    ['Æther', ['aether']],
    ['Œuvre', ['oeuvre']],
    ['Straße', ['strasse']],
  ])('folds non-decomposing letters beyond Polish in %s', (input, expected) => {
    const { tokens } = tokenizeText(input, wholeWordConfig)

    expect(tokens).toEqual(expected)
  })

  test.each([
    ['Ǿrnulf', ['ornulf']],
    ['Ǽlfric', ['aelfric']],
    ['ǣrest', ['aerest']],
    ['ℏbar', ['hbar']],
  ])('folds %s, which NFKD decomposes into a non-decomposing letter', (input, expected) => {
    const { tokens } = tokenizeText(input, wholeWordConfig)

    expect(tokens).toEqual(expected)
  })

  test('produces identical hashes for the diacritic and ASCII spellings of a name', () => {
    const indexed = tokenizeText('Łukasz Wałęsa', wholeWordConfig)
    const queried = tokenizeText('lukasz walesa', wholeWordConfig)

    expect(indexed.tokens).toEqual(queried.tokens)
    expect(indexed.hashes).toEqual(queried.hashes)
  })

  test('expands prefixes from the folded token rather than the truncated one', () => {
    const { tokens } = tokenizeText('Łódź', baseConfig)

    expect(tokens).toEqual(['lod', 'lodz'])
  })
})

describe('tokenizeText limits', () => {
  test('truncates oversized field text before tokenizing', () => {
    const config = { ...baseConfig, enablePartials: false, maxFieldChars: 10 }

    const { tokens } = tokenizeText('aaaa bbbb cccc', config)

    expect(tokens).toEqual(['aaaa', 'bbbb'])
  })

  test('bounds prefix expansion while collecting tokens', () => {
    const config = { ...baseConfig, maxFieldChars: 100, maxTokensPerField: 5 }

    const { tokens, hashes } = tokenizeText('a'.repeat(100), config)

    expect(tokens).toEqual(['aaa', 'aaaa', 'aaaaa', 'aaaaaa', 'aaaaaaa'])
    expect(hashes).toHaveLength(5)
  })

  test('applies safe defaults to legacy configs without limit fields', () => {
    const { tokens } = tokenizeText('a'.repeat(50_000), baseConfig)

    expect(tokens).toHaveLength(5_000)
  })

  test('allows a limit to be disabled explicitly', () => {
    const config = {
      ...baseConfig,
      enablePartials: false,
      maxFieldChars: 0,
      maxTokensPerField: 0,
    }

    const { tokens } = tokenizeText('alpha beta gamma delta', config)

    expect(tokens).toEqual(['alpha', 'beta', 'gamma', 'delta'])
  })
})
