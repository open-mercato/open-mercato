import * as fs from 'fs'
import * as path from 'path'

const PAY_PAGE_SOURCE = path.resolve(__dirname, '..', 'PayPage.tsx')

function readPayPageSource(): string {
  return fs.readFileSync(PAY_PAGE_SOURCE, 'utf8')
}

describe('PayPage DS contract', () => {
  it('uses current DS primitives for standard controls and feedback', () => {
    const source = readPayPageSource()

    expect(source).not.toMatch(/ErrorNotice/)
    expect(source).not.toMatch(/<input\b/)
    expect(source).not.toMatch(/<select\b/)
    expect(source).not.toContain('disabled:opacity-50')
  })

  it('keeps merchant theme color defaults isolated as explicit checkout branding exceptions', () => {
    const source = readPayPageSource()

    expect(source).toContain('CHECKOUT_THEME_FALLBACKS')
    expect(source).toContain('merchant branding defaults')
  })
})
