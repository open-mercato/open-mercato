/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'

describe('warranty relative-time is rendered in the active locale (#5286)', () => {
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()

  it('formats a past timestamp in Polish, not hardcoded English', () => {
    const pl = formatRelativeTime(threeHoursAgo, { locale: 'pl' }) ?? ''
    const en = formatRelativeTime(threeHoursAgo, { locale: 'en' }) ?? ''
    expect(en.toLowerCase()).toContain('ago')
    expect(pl).not.toEqual(en)
    expect(pl.toLowerCase()).not.toContain('ago')
    expect(pl).toContain('temu')
  })

  it('every warranty relative-time cell passes { locale } instead of { translate: t }', () => {
    const files = [
      '../backend/page.tsx',
      '../frontend/[orgSlug]/portal/claims/page.tsx',
      '../backend/warranty_claims/[id]/page.tsx',
      '../backend/warranty_claims/troubleshooting-guides/page.tsx',
      '../widgets/notifications/WarrantyClaimNotificationRenderer.tsx',
    ]
    for (const rel of files) {
      const src = readFileSync(join(__dirname, rel), 'utf8')
      const calls = src.match(/formatRelativeTime\([^)]*\)/g) ?? []
      expect(calls.length).toBeGreaterThan(0)
      for (const call of calls) {
        expect(call).toContain('{ locale }')
        expect(call).not.toContain('translate: t')
      }
    }
  })
})
