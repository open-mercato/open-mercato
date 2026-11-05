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
    ['Þórsdóttir', ['thorsdottir']],
    ['Guðmundsdóttir', ['gudmundsdottir']],
    ['Sæþór', ['saethor']],
    ['Ŋoma', ['noma']],
    ['Ŧorvald', ['torvald']],
  ])('folds non-decomposing letters beyond Polish in %s', (input, expected) => {
    const { tokens } = tokenizeText(input, wholeWordConfig)

    expect(tokens).toEqual(expected)
  })

  test('folds Eth and D-with-stroke identically, since the two are visually indistinguishable', () => {
    const dWithStroke = tokenizeText('Đurić', wholeWordConfig)
    const eth = tokenizeText('Ðurić', wholeWordConfig)

    expect(dWithStroke.tokens).toEqual(['duric'])
    expect(eth.tokens).toEqual(['duric'])
    expect(eth.hashes).toEqual(dWithStroke.hashes)
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

  // The property NON_DECOMPOSING_FOLDS actually exists to guarantee: no letter in the two
  // blocks it draws from may split or truncate the word it sits in. Asserting the range
  // directly is what catches a gap; enumerating characters by hand is what let nine of them
  // through in the first place.
  //
  // The three exclusions are a different defect class, not missing table rows. NFKD *does*
  // decompose them — into a base letter plus a non-combining separator (U+00B7 middle dot
  // for the two L-with-middle-dot letters, U+02BC modifier apostrophe for U+0149) — which
  // `splitTokens` then cuts the word at. A table entry for them would be dead code, because
  // the fold runs after NFKD and the codepoint no longer exists by then. Fixing them means
  // deciding whether that separator residue should survive tokenization at all, which also
  // governs the far commoner ASCII spelling (`Paral·lel` normalizes identically to
  // `Paraŀlel`), so it is tracked as its own change rather than smuggled in here.
  const SEPARATOR_RESIDUE_LETTERS = ['U+013F Ŀ', 'U+0140 ŀ', 'U+0149 ŉ']

  test('keeps every Latin-1 Supplement and Latin Extended-A letter inside a single token', () => {
    const lost: string[] = []

    for (let codePoint = 0xc0; codePoint <= 0x17f; codePoint += 1) {
      const char = String.fromCodePoint(codePoint)
      if (!/\p{L}/u.test(char)) continue
      if (tokenizeText(`a${char}b`, wholeWordConfig).tokens.length !== 1) {
        lost.push(`U+${codePoint.toString(16).toUpperCase().padStart(4, '0')} ${char}`)
      }
    }

    expect(lost).toEqual(SEPARATOR_RESIDUE_LETTERS)
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
