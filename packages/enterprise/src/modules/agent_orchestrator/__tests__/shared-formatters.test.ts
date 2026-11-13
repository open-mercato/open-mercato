import {
  formatDateTime,
  formatNumber,
  formatRelativeAge,
  formatTimeShort,
  formatWaitMinutes,
} from '../components/types'

describe('shared locale-aware formatters (UX consistency pass, Phase 2)', () => {
  describe('formatNumber', () => {
    it('groups per locale', () => {
      expect(formatNumber(1234567, 'en')).toBe('1,234,567')
      expect(formatNumber(1234567, 'de')).toBe('1.234.567')
      const pl = formatNumber(1234567, 'pl')
      expect(pl?.replace(/[\s  ]/g, ' ')).toBe('1 234 567')
    })

    it('returns null for null/undefined/non-finite', () => {
      expect(formatNumber(null, 'en')).toBeNull()
      expect(formatNumber(undefined, 'en')).toBeNull()
      expect(formatNumber(Number.NaN, 'en')).toBeNull()
      expect(formatNumber(Number.POSITIVE_INFINITY, 'en')).toBeNull()
    })

    it('keeps small integers bare', () => {
      expect(formatNumber(42, 'pl')).toBe('42')
    })
  })

  describe('formatDateTime', () => {
    const iso = '2026-07-12T14:05:00.000Z'

    it('renders locale-appropriate date order', () => {
      const en = formatDateTime(iso, 'en')
      const de = formatDateTime(iso, 'de')
      const pl = formatDateTime(iso, 'pl')
      expect(en).toMatch(/Jul/)
      expect(en).toMatch(/2026/)
      expect(de).toMatch(/12\.07\.2026|Juli/)
      expect(pl).toMatch(/lip|07/)
      expect(pl).toMatch(/2026/)
    })

    it('returns null for null/invalid input', () => {
      expect(formatDateTime(null, 'en')).toBeNull()
      expect(formatDateTime(undefined, 'en')).toBeNull()
      expect(formatDateTime('not-a-date', 'en')).toBeNull()
    })
  })

  describe('formatTimeShort', () => {
    it('renders a zero-padded 24h clock label', () => {
      const value = formatTimeShort('2026-07-12T09:07:00')
      expect(value).toMatch(/^\d{2}:\d{2}$/)
      expect(value).toBe('09:07')
    })

    it('returns null for null/invalid input', () => {
      expect(formatTimeShort(null)).toBeNull()
      expect(formatTimeShort('nope')).toBeNull()
    })
  })

  describe('formatRelativeAge', () => {
    const now = Date.parse('2026-07-12T12:00:00.000Z')
    const isoAgo = (ms: number) => new Date(now - ms).toISOString()

    it('renders minutes under an hour', () => {
      expect(formatRelativeAge(isoAgo(5 * 60_000), now)).toBe('5m')
      expect(formatRelativeAge(isoAgo(59 * 60_000), now)).toBe('59m')
    })

    it('renders whole hours under a day (floor, not round)', () => {
      expect(formatRelativeAge(isoAgo(60 * 60_000), now)).toBe('1h')
      expect(formatRelativeAge(isoAgo((23 * 60 + 59) * 60_000), now)).toBe('23h')
    })

    it('renders days with a remainder-hours suffix', () => {
      expect(formatRelativeAge(isoAgo(26 * 60 * 60_000), now)).toBe('1d 2h')
      expect(formatRelativeAge(isoAgo(48 * 60 * 60_000), now)).toBe('2d')
    })

    it('clamps future timestamps to zero and rejects invalid input', () => {
      expect(formatRelativeAge(isoAgo(-60_000), now)).toBe('0m')
      expect(formatRelativeAge(null, now)).toBeNull()
      expect(formatRelativeAge('nope', now)).toBeNull()
    })
  })

  describe('formatWaitMinutes', () => {
    it('renders minute / hour / day tiers', () => {
      expect(formatWaitMinutes(45)).toBe('45m')
      expect(formatWaitMinutes(60)).toBe('1h')
      expect(formatWaitMinutes(150)).toBe('2h 30m')
      expect(formatWaitMinutes(24 * 60)).toBe('1d')
      expect(formatWaitMinutes(26 * 60)).toBe('1d 2h')
    })

    it('returns null for null/undefined/non-finite', () => {
      expect(formatWaitMinutes(null)).toBeNull()
      expect(formatWaitMinutes(undefined)).toBeNull()
      expect(formatWaitMinutes(Number.NaN)).toBeNull()
    })
  })

  describe('module-wide locale hygiene', () => {
    it('no page hardcodes an en-US locale anymore', () => {
      const { execSync } = require('node:child_process') as typeof import('node:child_process')
      const path = require('node:path') as typeof import('node:path')
      const moduleRoot = path.resolve(__dirname, '..')
      const result = execSync(
        `grep -rn "'en-US'" --include='*.tsx' --include='*.ts' backend/ components/ lib/ || true`,
        { cwd: moduleRoot, encoding: 'utf8' },
      )
      expect(result.trim()).toBe('')
    })
  })
})
