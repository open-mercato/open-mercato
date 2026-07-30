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
})
