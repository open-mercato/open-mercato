import { mulberry32 } from '@open-mercato/shared/lib/catalog-visibility/__tests__/testFixtures'
import {
  ECOMMERCE_BRANDING_COLOR_KEYS,
  ECOMMERCE_BRANDING_CSS_PROPERTIES,
  ECOMMERCE_BRANDING_DEFAULTS,
  ECOMMERCE_BRANDING_FONTS,
  buildBrandingDeclarations,
  isValidBrandingColor,
  normalizeBrandingColor,
  renderBrandingRootRule,
  renderBrandingStyleBlock,
} from '../brandingStyles'

const HOSTILE_FRAGMENTS = [
  '</style>',
  '</STYLE >',
  '<script>alert(1)</script>',
  ';}',
  '}',
  '{',
  ';',
  '@import',
  "@import url('https://evil.example/x.css');",
  'url(',
  'url(https://evil.example/x)',
  'expression(',
  '\\3c /style\\3e',
  '\\00003c',
  '\;',
  '/*',
  '*/',
  '\n',
  '\r\n',
  '\u2028',
  '\u0000',
  'body{display:none}',
  '--x:1',
  '!important',
  '"',
  "'",
  '`',
  'javascript:',
  'var(--x)',
  'calc(1px + 1px)',
  'oklch(',
  '#',
  '0.5',
  ' ',
  '  ',
  '\t',
]

const VALID_SEEDS = [
  '#fff',
  '#1A2B3C',
  '#1a2b3c80',
  'oklch(0.3 0.15 270)',
  'oklch(50% 0.2 120deg)',
  'oklch(.5 .1 120/50%)',
  '0.625rem',
  '8px',
  '0',
  'inter',
  'roboto',
]

function randomString(rng: () => number): string {
  const parts = 1 + Math.floor(rng() * 5)
  let result = ''
  for (let index = 0; index < parts; index += 1) {
    const roll = rng()
    if (roll < 0.45) result += HOSTILE_FRAGMENTS[Math.floor(rng() * HOSTILE_FRAGMENTS.length)]
    else if (roll < 0.7) result += VALID_SEEDS[Math.floor(rng() * VALID_SEEDS.length)]
    else {
      const length = Math.floor(rng() * 12)
      for (let char = 0; char < length; char += 1) result += String.fromCharCode(Math.floor(rng() * 0x2100))
    }
  }
  return result
}

function randomValue(rng: () => number): unknown {
  const roll = rng()
  if (roll < 0.1) return null
  if (roll < 0.15) return Math.floor(rng() * 100)
  if (roll < 0.2) return { toString: () => '</style>' }
  if (roll < 0.25) return ['#fff', '</style>']
  return randomString(rng)
}

function randomBranding(rng: () => number): Record<string, unknown> {
  const keys = [
    ...ECOMMERCE_BRANDING_COLOR_KEYS,
    'borderRadius',
    'fontFamilyBase',
    'fontFamilyHeading',
    'logoUrl',
    '</style>',
    '__proto__',
    'constructor',
    '--evil',
  ]
  const branding: Record<string, unknown> = {}
  for (const key of keys) {
    if (rng() < 0.7) Object.defineProperty(branding, key, { value: randomValue(rng), enumerable: true })
  }
  return branding
}

function parseRootRule(rule: string): Array<{ property: string; value: string }> {
  expect(rule.startsWith(':root{')).toBe(true)
  expect(rule.endsWith('}')).toBe(true)
  const body = rule.slice(':root{'.length, -1)
  return body.split(';').map((declaration) => {
    const separator = declaration.indexOf(':')
    return { property: declaration.slice(0, separator), value: declaration.slice(separator + 1) }
  })
}

function assertSafeStyleBlock(block: string): void {
  expect(block.startsWith('<style data-ecommerce-branding>')).toBe(true)
  expect(block.endsWith('</style>')).toBe(true)
  const inner = block.slice('<style data-ecommerce-branding>'.length, -'</style>'.length)
  expect(inner).not.toMatch(/[<>@\\"\n\r\u2028\u2029\u0000*]|\/\*|url\(|import/i)
  expect(inner.split('{')).toHaveLength(2)
  expect(inner.split('}')).toHaveLength(2)
  const declarations = parseRootRule(inner)
  expect(declarations.map((declaration) => declaration.property)).toEqual([...ECOMMERCE_BRANDING_CSS_PROPERTIES])
  for (const declaration of declarations) {
    expect(declaration.property).toMatch(/^--[a-z-]+$/)
    expect(declaration.value).not.toMatch(/[;{}]/)
  }
}

describe('ecommerce branding styles', () => {
  it('emits the fixed declaration set with spec defaults when nothing is configured', () => {
    for (const input of [undefined, null, {}, 'x', 42, []]) {
      const declarations = buildBrandingDeclarations(input)
      expect(declarations.map((declaration) => declaration.property)).toEqual([
        '--primary',
        '--primary-foreground',
        '--accent',
        '--accent-foreground',
        '--background',
        '--foreground',
        '--radius',
        '--font-base',
        '--font-heading',
      ])
    }
    const defaults = renderBrandingRootRule({})
    expect(defaults).toContain(`--primary:${ECOMMERCE_BRANDING_DEFAULTS.primaryColor}`)
    expect(defaults).toContain('--radius:0.625rem')
    expect(defaults).toContain("--font-base:'Inter', sans-serif")
    expect(defaults).toContain('--font-heading:var(--font-base)')
  })

  it('maps validated tokens onto their custom properties', () => {
    const rule = renderBrandingRootRule({
      primaryColor: '#1A2B3C',
      primaryForeground: 'oklch(0.985 0 0)',
      accentColor: 'oklch(50% 0.2 120deg)',
      accentForeground: '#fff',
      backgroundColor: 'oklch(.5 .1 120/50%)',
      foregroundColor: '#000',
      borderRadius: '8px',
      fontFamilyBase: 'roboto',
      fontFamilyHeading: 'playfair-display',
    })
    expect(rule).toBe(
      ":root{--primary:#1a2b3c;--primary-foreground:oklch(0.985 0 0);--accent:oklch(50% 0.2 120deg);--accent-foreground:#fff;--background:oklch(.5 .1 120 / 50%);--foreground:#000;--radius:8px;--font-base:'Roboto', sans-serif;--font-heading:'Playfair Display', serif}",
    )
  })

  it('falls back to defaults for invalid values instead of emitting them', () => {
    const rule = renderBrandingRootRule({
      primaryColor: 'red; } body { display: none',
      borderRadius: '1rem;}',
      fontFamilyBase: 'Comic Sans MS',
    })
    expect(rule).toContain(`--primary:${ECOMMERCE_BRANDING_DEFAULTS.primaryColor}`)
    expect(rule).toContain('--radius:0.625rem')
    expect(rule).toContain("--font-base:'Inter', sans-serif")
  })

  it('canonicalizes whitespace inside oklch values so no raw whitespace class reaches the stylesheet', () => {
    expect(normalizeBrandingColor('oklch(\n0.5\t0.1 120 /\n0.5 )')).toBe('oklch(0.5 0.1 120 / 0.5)')
    expect(normalizeBrandingColor('oklch(\u2028 0.5 0.1 120)')).toBe('oklch(0.5 0.1 120)')
    expect(normalizeBrandingColor('#ABC')).toBe('#abc')
    expect(normalizeBrandingColor('#abcd')).toBeNull()
    expect(normalizeBrandingColor('#fff\n')).toBeNull()
  })

  it('ignores inherited and unknown keys', () => {
    const inherited = Object.create({ primaryColor: '</style>' }) as Record<string, unknown>
    expect(renderBrandingRootRule(inherited)).toBe(renderBrandingRootRule({}))
    expect(renderBrandingRootRule({ '--evil': 'x', 'color': 'red' })).toBe(renderBrandingRootRule({}))
  })

  it('wraps the rule in a style block and only accepts well-formed nonces', () => {
    const plain = renderBrandingStyleBlock({})
    expect(plain.startsWith('<style data-ecommerce-branding>')).toBe(true)
    expect(plain.endsWith('</style>')).toBe(true)
    expect(renderBrandingStyleBlock({}, { nonce: 'abcDEF123+/=' })).toContain(' nonce="abcDEF123+/=">')
    for (const nonce of ['short', 'a" onload="x', '"><script>', 'abc def ghi jkl', '', null]) {
      expect(renderBrandingStyleBlock({}, { nonce })).toBe(plain)
    }
  })

  it('keeps every allowlisted font stack free of structural characters', () => {
    for (const font of ECOMMERCE_BRANDING_FONTS) {
      expect(renderBrandingRootRule({ fontFamilyBase: font.id })).toContain(`--font-base:${font.stack}`)
      expect(font.stack).not.toMatch(/[;{}<>()\\@/*\n\r]/)
    }
  })

  it('never lets seeded hostile input escape the fixed declaration set (fuzz)', () => {
    const rng = mulberry32(0x5eed0001)
    for (let iteration = 0; iteration < 3000; iteration += 1) {
      const branding = randomBranding(rng)
      const block = renderBrandingStyleBlock(branding, { nonce: randomString(rng) })
      const nonceMatch = /^<style data-ecommerce-branding nonce="([A-Za-z0-9+/_-]{8,128}={0,2})">/.exec(block)
      const normalized = nonceMatch ? block.replace(` nonce="${nonceMatch[1]}"`, '') : block
      assertSafeStyleBlock(normalized)
      for (const declaration of buildBrandingDeclarations(branding)) {
        const known = ECOMMERCE_BRANDING_CSS_PROPERTIES.includes(declaration.property)
        expect(known).toBe(true)
      }
    }
  })

  it('emits only values that survive the strict validators (fuzz)', () => {
    const rng = mulberry32(0x5eed0002)
    const colorProperties = ECOMMERCE_BRANDING_CSS_PROPERTIES.slice(0, 6)
    for (let iteration = 0; iteration < 3000; iteration += 1) {
      const candidate = randomString(rng)
      const declarations = buildBrandingDeclarations({
        primaryColor: candidate,
        accentColor: candidate,
        borderRadius: candidate,
        fontFamilyBase: candidate,
        fontFamilyHeading: candidate,
      })
      for (const declaration of declarations) {
        if (colorProperties.includes(declaration.property)) {
          expect(isValidBrandingColor(declaration.value)).toBe(true)
        }
      }
      assertSafeStyleBlock(renderBrandingStyleBlock({ primaryColor: candidate, borderRadius: candidate }))
    }
  })

  it('rejects every curated injection payload in every token', () => {
    const payloads = HOSTILE_FRAGMENTS.flatMap((fragment) => [
      fragment,
      `#fff${fragment}`,
      `oklch(0.5 0.1 120)${fragment}`,
      `${fragment}#fff`,
      `0.5rem${fragment}`,
      `inter${fragment}`,
    ])
    for (const payload of payloads) {
      const allKeys = Object.fromEntries(
        [...ECOMMERCE_BRANDING_COLOR_KEYS, 'borderRadius', 'fontFamilyBase', 'fontFamilyHeading'].map((key) => [key, payload]),
      )
      assertSafeStyleBlock(renderBrandingStyleBlock(allKeys))
    }
  })
})
