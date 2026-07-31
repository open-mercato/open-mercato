import { tokenizeText } from '../tokenize'
import type { SearchConfig } from '../config'

const baseConfig: SearchConfig = {
  enabled: true,
  minTokenLength: 3,
  enablePartials: true,
  hashAlgorithm: 'sha256',
  storeRawTokens: false,
  blocklistedFields: [],
  maxFieldChars: 20000,
  maxTokensPerField: 5000,
  maxTokensPerRecord: 20000,
}

// #4681: caps must bound the token fan-out for large/pathological fields.
describe('tokenizeText caps', () => {
  it('truncates field text to maxFieldChars before tokenizing', () => {
    const config: SearchConfig = { ...baseConfig, enablePartials: false, maxFieldChars: 10 }
    // Only the first 10 chars ("aaaa bbbb ") survive truncation -> "cccc" is dropped.
    const { tokens } = tokenizeText('aaaa bbbb cccc', config)
    expect(tokens).toContain('aaaa')
    expect(tokens).toContain('bbbb')
    expect(tokens).not.toContain('cccc')
  })

  it('caps the number of tokens emitted per field', () => {
    const config: SearchConfig = { ...baseConfig, enablePartials: false, maxTokensPerField: 5 }
    const text = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ')
    const { tokens, hashes } = tokenizeText(text, config)
    expect(tokens).toHaveLength(5)
    expect(hashes).toHaveLength(5)
  })

  it('does not cap when the field stays within limits', () => {
    const config: SearchConfig = { ...baseConfig, enablePartials: false }
    const { tokens } = tokenizeText('alpha beta gamma', config)
    expect(tokens).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('bounds prefix expansion of a single maximum-length token without materializing every prefix', () => {
    // One 20k-char alphanumeric token with partials would expand to ~20k prefixes;
    // the running budget must cap it at maxTokensPerField (5000) during expansion.
    const config: SearchConfig = { ...baseConfig, maxTokensPerField: 5000 }
    const hugeToken = 'a'.repeat(20000)
    const { tokens } = tokenizeText(hugeToken, config)
    expect(tokens).toHaveLength(5000)
    // All emitted tokens are prefixes of the same token, shortest first.
    expect(tokens[0]).toBe('aaa')
  })

  it('applies default caps when the config omits the optional cap fields (backward compat)', () => {
    // A legacy SearchConfig literal built by a third-party module has no cap fields;
    // tokenizeText must still bound output using the module defaults.
    const legacy = {
      enabled: true,
      minTokenLength: 3,
      enablePartials: true,
      hashAlgorithm: 'sha256',
      storeRawTokens: false,
      blocklistedFields: [],
    } as SearchConfig
    const hugeToken = 'a'.repeat(50000)
    const { tokens } = tokenizeText(hugeToken, legacy)
    // Default maxFieldChars (20000) truncates, default maxTokensPerField (5000) caps.
    expect(tokens.length).toBe(5000)
  })
})
