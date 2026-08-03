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
