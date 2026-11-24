import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '../../../../..')
const storefrontCss = readFileSync(path.join(__dirname, '../storefront.css'), 'utf8')
const globalsCss = readFileSync(path.join(repoRoot, 'apps/mercato/src/app/globals.css'), 'utf8')

const ROLES = ['button', 'field', 'card', 'badge'] as const
const ALLOWED_SELECTORS = new Set(['[data-theme="storefront"]', '.dark [data-theme="storefront"]', '[data-theme="storefront"].dark'])

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function parseRules(css: string): Array<{ selectors: string[]; body: string }> {
  const rules: Array<{ selectors: string[]; body: string }> = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(css)) !== null) {
    rules.push({ selectors: match[1].split(',').map((selector) => selector.trim()), body: match[2] })
  }
  return rules
}

function blockBody(css: string, opener: string): string {
  const start = css.indexOf(opener)
  if (start < 0) return ''
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

describe('storefront theme', () => {
  const css = stripComments(storefrontCss)
  const rules = parseRules(css)

  it('has no nested at-rules', () => {
    expect(css).not.toMatch(/@/)
  })

  it('scopes every rule to data-theme="storefront"', () => {
    expect(rules.length).toBeGreaterThan(0)
    for (const rule of rules) {
      for (const selector of rule.selectors) {
        expect(ALLOWED_SELECTORS.has(selector)).toBe(true)
      }
    }
  })

  it('only declares custom properties', () => {
    for (const rule of rules) {
      const declarations = rule.body.split(';').map((declaration) => declaration.trim()).filter(Boolean)
      for (const declaration of declarations) {
        expect(declaration).toMatch(/^--[a-z0-9-]+\s*:/)
      }
    }
  })

  it.each(ROLES)('defines the --om-radius-%s shape role', (role) => {
    const lightRule = rules.find((rule) => rule.selectors.length === 1 && rule.selectors[0] === '[data-theme="storefront"]')
    expect(lightRule?.body).toMatch(new RegExp(`--om-radius-${role}\\s*:`))
  })

  it('leaves status tokens untouched', () => {
    expect(css).not.toMatch(/--status-/)
  })
})

describe('globals.css shape roles', () => {
  const rootBody = blockBody(globalsCss, ':root {')
  const themeBody = blockBody(globalsCss, '@theme inline {')

  it.each(ROLES)('defines the --om-radius-%s default in :root', (role) => {
    expect(rootBody).toMatch(new RegExp(`--om-radius-${role}\\s*:`))
  })

  it.each(ROLES)('maps rounded-%s to the runtime variable in @theme inline', (role) => {
    expect(themeBody).toContain(`--radius-${role}: var(--om-radius-${role});`)
  })

  it('keeps the defaults equal to the radii the primitives used before', () => {
    expect(rootBody).toContain('--om-radius-button: calc(var(--radius) - 2px);')
    expect(rootBody).toContain('--om-radius-field: calc(var(--radius) - 2px);')
    expect(rootBody).toContain('--om-radius-card: calc(var(--radius) + 6px);')
    expect(rootBody).toContain('--om-radius-badge: calc(infinity * 1px);')
  })
})
