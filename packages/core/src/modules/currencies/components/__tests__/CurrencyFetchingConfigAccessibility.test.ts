import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(
  path.join(__dirname, '..', 'CurrencyFetchingConfig.tsx'),
  'utf8',
)

describe('CurrencyFetchingConfig accessibility', () => {
  it('identifies each enable switch by its localized provider name', () => {
    const switchMarkup = source.match(
      /<Switch[\s\S]*?checked=\{config\.isEnabled\}[\s\S]*?\/>/,
    )?.[0]

    expect(switchMarkup).toBeDefined()
    expect(switchMarkup).toContain('aria-label={getProviderName(config.provider)}')
  })
})
