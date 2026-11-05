import { readFileSync } from 'fs'
import { join } from 'path'

const pagePath = join(__dirname, '../frontend/checkout-demo/page.tsx')
const source = readFileSync(pagePath, 'utf8')

// Design-system contract: status colors must use semantic tokens
// (`{property}-status-{status}-{role}`), never hardcoded Tailwind palette shades.
// Guards issue #3167 — the checkout demo page must not become a copy-paste source
// of hardcoded status colors for future workflow/checkout UI.
const STATUS_PALETTE = [
  'red',
  'green',
  'emerald',
  'blue',
  'sky',
  'amber',
  'yellow',
  'orange',
  'purple',
]
const FORBIDDEN_STATUS_COLOR = new RegExp(
  `\\b(?:text|bg|border)-(?:${STATUS_PALETTE.join('|')})-\\d{2,3}\\b`,
  'g',
)

describe('workflows checkout demo — design-system tokens', () => {
  it('does not hardcode Tailwind status-color shades', () => {
    const matches = source.match(FORBIDDEN_STATUS_COLOR) ?? []
    expect(matches).toEqual([])
  })

  it('does not render raw form controls (input/textarea/select) or raw buttons', () => {
    const rawControls = source.match(/<(?:input|textarea|select|button)[\s>]/g) ?? []
    expect(rawControls).toEqual([])
  })

  it('does not embed inline SVG icons', () => {
    const inlineSvgs = source.match(/<svg[\s>]/g) ?? []
    expect(inlineSvgs).toEqual([])
  })
})
