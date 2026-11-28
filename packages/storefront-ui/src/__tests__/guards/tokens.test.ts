import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const tokens = readFileSync(join(__dirname, '..', '..', 'tokens.css'), 'utf8')
const theme = readFileSync(join(__dirname, '..', '..', 'theme.css'), 'utf8')

function block(selector: string): string {
  const start = tokens.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`[internal] block not found: ${selector}`)
  const end = tokens.indexOf('\n}', start)
  return tokens.slice(start, end)
}

const ADMIN_SEMANTIC = [
  'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground', 'primary', 'primary-foreground', 'primary-hover',
  'secondary', 'secondary-foreground', 'muted', 'muted-foreground', 'accent', 'accent-foreground', 'destructive', 'border', 'input', 'ring',
]
const STATUSES = ['error', 'success', 'warning', 'info', 'neutral', 'pink']
const ROLES = ['bg', 'text', 'border', 'icon', 'solid']
const RADII = ['badge', 'button', 'chip', 'field', 'card', 'tile', 'sheet']

describe('storefront-ui tokens contract (spec §2)', () => {
  const light = block(':root')
  const dark = block('.dark')

  it('declares every admin semantic token for light and dark', () => {
    for (const name of ADMIN_SEMANTIC) {
      expect(light).toMatch(new RegExp(`--${name}:`))
      expect(dark).toMatch(new RegExp(`--${name}:`))
    }
  })

  it('declares the full status palette for light and dark', () => {
    for (const status of STATUSES) {
      for (const role of ROLES) {
        expect(light).toMatch(new RegExp(`--status-${status}-${role}:`))
        expect(dark).toMatch(new RegExp(`--status-${status}-${role}:`))
      }
    }
  })

  it('derives every radius from the store branding radius', () => {
    for (const radius of RADII) expect(light).toMatch(new RegExp(`--sf-radius-${radius}: calc\\(var\\(--radius\\)`))
  })

  it('exposes the font names the store branding uses', () => {
    expect(light).toMatch(/--font-base:/)
    expect(light).toMatch(/--font-heading:/)
    expect(light).toMatch(/--font-sans: var\(--font-base\)/)
    expect(light).toMatch(/--font-display: var\(--font-heading\)/)
  })

  it('maps every sf radius, control size and text token into the Tailwind theme', () => {
    for (const radius of RADII) expect(theme).toContain(`--radius-sf-${radius}: var(--sf-radius-${radius})`)
    for (const size of ['sm', 'md', 'lg']) expect(theme).toContain(`--spacing-sf-${size}: var(--sf-control-${size})`)
    for (const text of ['display-xl', 'display-l', 'display-m', 'display-s', 'title', 'title-sm', 'body-lg', 'body', 'body-sm', 'body-xs', 'badge']) {
      expect(theme).toContain(`--text-sf-${text}: var(--sf-text-${text})`)
    }
    for (const status of STATUSES) {
      for (const role of ['bg', 'text', 'border', 'icon']) expect(theme).toContain(`--color-status-${status}-${role}: var(--status-${status}-${role})`)
    }
  })


  it('matches the admin value of every token both surfaces share', () => {
    const adminCss = readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'apps', 'mercato', 'src', 'app', 'globals.css'), 'utf8')
    const parse = (css: string, selector: string) => {
      const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
      const start = withoutComments.search(new RegExp(`^${selector.replace('.', '\\.')} \\{`, 'm'))
      let depth = 0
      let index = withoutComments.indexOf('{', start)
      const open = index
      do {
        if (withoutComments[index] === '{') depth += 1
        if (withoutComments[index] === '}') depth -= 1
        index += 1
      } while (depth > 0)
      return new Map(Array.from(withoutComments.slice(open, index).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g), (match) => [match[1], match[2].trim()]))
    }
    const intentional = new Set(['--focus-ring-outer'])
    for (const selector of [':root', '.dark']) {
      const admin = parse(adminCss, selector)
      const drift: string[] = []
      for (const [name, value] of parse(tokens, selector)) {
        if (name.startsWith('--sf-') || intentional.has(name) || !admin.has(name)) continue
        if (admin.get(name) !== value) drift.push(`${selector} ${name}: ${value} vs ${admin.get(name)}`)
      }
      expect(drift).toEqual([])
    }
  })
})
