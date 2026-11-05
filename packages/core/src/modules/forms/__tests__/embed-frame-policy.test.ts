import {
  buildFrameAncestorsCsp,
  isEmbedEnabled,
  normalizeAllowedDomains,
  normalizeEmbedOrigin,
  readEmbedSettings,
} from '../lib/embed-frame-policy'
import { DistributionService } from '../services/distribution-service'
import { embedSettingsSchema, distributionSettingsSchema } from '../data/validators'
import type { FormDistribution } from '../data/entities'

describe('normalizeEmbedOrigin', () => {
  it('accepts https origins and strips trailing slash / default path', () => {
    expect(normalizeEmbedOrigin('https://www.acme.com')).toBe('https://www.acme.com')
    expect(normalizeEmbedOrigin('https://www.acme.com/')).toBe('https://www.acme.com')
    expect(normalizeEmbedOrigin('https://acme.com:8443')).toBe('https://acme.com:8443')
    expect(normalizeEmbedOrigin('  https://acme.com  ')).toBe('https://acme.com')
  })

  it('permits http only for localhost / loopback', () => {
    expect(normalizeEmbedOrigin('http://localhost:3000')).toBe('http://localhost:3000')
    expect(normalizeEmbedOrigin('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000')
    expect(normalizeEmbedOrigin('http://www.acme.com')).toBeNull()
  })

  it('rejects malformed, pathful, query, fragment, or credentialed origins', () => {
    expect(normalizeEmbedOrigin('acme.com')).toBeNull()
    expect(normalizeEmbedOrigin('https://acme.com/path')).toBeNull()
    expect(normalizeEmbedOrigin('https://acme.com?x=1')).toBeNull()
    expect(normalizeEmbedOrigin('https://acme.com#frag')).toBeNull()
    expect(normalizeEmbedOrigin('https://user:pass@acme.com')).toBeNull()
    expect(normalizeEmbedOrigin('ftp://acme.com')).toBeNull()
    expect(normalizeEmbedOrigin('')).toBeNull()
  })
})

describe('normalizeAllowedDomains', () => {
  it('dedupes and partitions valid vs invalid entries', () => {
    const result = normalizeAllowedDomains([
      'https://acme.com',
      'https://acme.com/',
      'http://evil.com',
      'not-a-url',
    ])
    expect(result.origins).toEqual(['https://acme.com'])
    expect(result.invalid).toEqual(['http://evil.com', 'not-a-url'])
  })
})

describe('buildFrameAncestorsCsp', () => {
  it("returns 'none' when embedding is disabled or absent", () => {
    expect(buildFrameAncestorsCsp(null)).toBe("frame-ancestors 'none'")
    expect(buildFrameAncestorsCsp({ enabled: false, allowedDomains: ['https://acme.com'] })).toBe(
      "frame-ancestors 'none'",
    )
  })

  it("returns 'none' when enabled but allowlist resolves to zero origins", () => {
    expect(buildFrameAncestorsCsp({ enabled: true, allowedDomains: [] })).toBe("frame-ancestors 'none'")
    expect(buildFrameAncestorsCsp({ enabled: true, allowedDomains: ['bad'] })).toBe("frame-ancestors 'none'")
  })

  it('lists the normalized allowlist when enabled', () => {
    expect(
      buildFrameAncestorsCsp({ enabled: true, allowedDomains: ['https://acme.com', 'https://www.acme.com'] }),
    ).toBe('frame-ancestors https://acme.com https://www.acme.com')
  })
})

describe('isEmbedEnabled', () => {
  it('is true only with enabled flag AND a valid allowlist', () => {
    expect(isEmbedEnabled({ enabled: true, allowedDomains: ['https://acme.com'] })).toBe(true)
    expect(isEmbedEnabled({ enabled: true, allowedDomains: [] })).toBe(false)
    expect(isEmbedEnabled({ enabled: false, allowedDomains: ['https://acme.com'] })).toBe(false)
    expect(isEmbedEnabled(null)).toBe(false)
  })
})

describe('readEmbedSettings', () => {
  it('reads the embed bag out of an untyped settings column', () => {
    const embed = readEmbedSettings({
      captcha: true,
      embed: { enabled: true, allowedDomains: ['https://acme.com'], theme: 'dark', autoResize: false },
    })
    expect(embed).toEqual({
      enabled: true,
      allowedDomains: ['https://acme.com'],
      theme: 'dark',
      autoResize: false,
    })
  })

  it('returns null when absent or malformed', () => {
    expect(readEmbedSettings(null)).toBeNull()
    expect(readEmbedSettings({ captcha: true })).toBeNull()
    expect(readEmbedSettings({ embed: 'nope' })).toBeNull()
  })
})

describe('embedSettingsSchema (R-RS-1)', () => {
  it('rejects enabled:true with an empty allowlist', () => {
    expect(embedSettingsSchema.safeParse({ enabled: true, allowedDomains: [] }).success).toBe(false)
  })

  it('accepts a disabled bag with no domains', () => {
    expect(embedSettingsSchema.safeParse({ enabled: false }).success).toBe(true)
  })

  it('rejects non-https / pathful domains', () => {
    expect(
      embedSettingsSchema.safeParse({ enabled: true, allowedDomains: ['http://acme.com'] }).success,
    ).toBe(false)
    expect(
      embedSettingsSchema.safeParse({ enabled: true, allowedDomains: ['https://acme.com/x'] }).success,
    ).toBe(false)
  })

  it('accepts a valid enabled allowlist with theme + autoResize', () => {
    const parsed = embedSettingsSchema.parse({
      enabled: true,
      allowedDomains: ['https://acme.com'],
      theme: 'auto',
    })
    expect(parsed.autoResize).toBe(true)
  })
})

describe('distributionSettingsSchema (additive)', () => {
  it('passes through unknown keys (captcha / completion) untouched', () => {
    const parsed = distributionSettingsSchema.parse({
      captcha: true,
      completion: { title: 'Thanks', message: 'Done' },
    })
    expect(parsed).toMatchObject({ captcha: true, completion: { title: 'Thanks' } })
  })

  it('validates the embed sub-bag', () => {
    expect(
      distributionSettingsSchema.safeParse({ embed: { enabled: true, allowedDomains: [] } }).success,
    ).toBe(false)
  })
})

function makeDistribution(overrides: Partial<FormDistribution>): FormDistribution {
  return {
    mode: 'open',
    status: 'active',
    requireCustomerAuth: false,
    settings: { embed: { enabled: true, allowedDomains: ['https://acme.com'] } },
    ...overrides,
  } as FormDistribution
}

describe('DistributionService.isEmbeddable (D5 truth table)', () => {
  const service = new DistributionService({
    emFactory: () => ({}) as never,
    submissionService: {} as never,
    emitEvent: () => undefined,
  })

  it('is true for an active open distribution with embedding enabled', () => {
    expect(service.isEmbeddable(makeDistribution({}))).toBe(true)
  })

  it.each([
    ['personal mode', { mode: 'personal' as const }],
    ['paused status', { status: 'paused' as const }],
    ['closed status', { status: 'closed' as const }],
    ['requires customer auth', { requireCustomerAuth: true }],
    ['embed disabled', { settings: { embed: { enabled: false, allowedDomains: ['https://acme.com'] } } }],
    ['empty allowlist', { settings: { embed: { enabled: true, allowedDomains: [] as string[] } } }],
    ['no embed bag', { settings: { captcha: true } }],
    ['no settings', { settings: null }],
  ])('is false when %s', (_label, overrides) => {
    expect(service.isEmbeddable(makeDistribution(overrides as Partial<FormDistribution>))).toBe(false)
  })
})
