/** @jest-environment jsdom */
import { readThemeTokens } from '../components/themeTokens'

describe('theme token reference', () => {
  it('reads both themes independently of the active page theme and inherits unchanged brand tokens', () => {
    const style = document.createElement('style')
    style.textContent = ':root { --background: white; --brand-lime: lime; } .dark { --background: black; } .component { --background: red; }'
    document.head.appendChild(style)
    try {
      const tokens = readThemeTokens(document.styleSheets)
      expect(tokens.light['--background']).toBe('white')
      expect(tokens.dark['--background']).toBe('black')
      expect(tokens.light['--brand-lime']).toBe('lime')
      expect(tokens.dark['--brand-lime']).toBe('lime')
    } finally { style.remove() }
  })

  it('reads tokens inside grouping rules and tolerates inaccessible stylesheets', () => {
    const style = document.createElement('style')
    style.textContent = '@media all { :root { --foreground: black; } .dark { --foreground: white; } }'
    document.head.appendChild(style)
    const inaccessible = Object.defineProperty({}, 'cssRules', { get() { throw new DOMException('Stylesheet access denied', 'SecurityError') } }) as CSSStyleSheet
    try {
      const tokens = readThemeTokens([inaccessible, ...Array.from(document.styleSheets)])
      expect(tokens.light['--foreground']).toBe('black')
      expect(tokens.dark['--foreground']).toBe('white')
    } finally { style.remove() }
  })
})
