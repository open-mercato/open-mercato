import { XRAY_TIME_ZONE_FORMATTER_CACHE_LIMIT, cachedTimeZoneFormatterCount, resolveWindow, zonedDateParts } from '../window'

function spellings(zone: string, count: number): string[] {
  const letters = Array.from(zone).map((character, index) => ({ character, index })).filter((entry) => entry.character.toLowerCase() !== entry.character.toUpperCase())
  return Array.from({ length: count }, (_unused, variant) => {
    const characters = Array.from(zone)
    letters.forEach((entry, bit) => {
      characters[entry.index] = (variant >> bit) & 1 ? entry.character.toUpperCase() : entry.character.toLowerCase()
    })
    return characters.join('')
  })
}

describe('X-Ray analytics time-zone formatter cache', () => {
  it('caches formatters by canonical zone name, so spellings of one zone never grow the cache', () => {
    const nowMs = Date.UTC(2026, 4, 15, 12)
    const variants = spellings('Europe/Warsaw', 400)
    expect(new Set(variants).size).toBe(400)
    for (const zone of variants) {
      expect(resolveWindow({ windowKey: '7d' }, { nowMs, timeZone: zone }).timeZone).toBe('Europe/Warsaw')
      expect(zonedDateParts(nowMs, zone).hour).toBe(14)
    }
    expect(cachedTimeZoneFormatterCount()).toBeLessThanOrEqual(2)
  })

  it('stays within its cap for every supported zone', () => {
    const nowMs = Date.UTC(2026, 4, 15, 12)
    for (const zone of Intl.supportedValuesOf('timeZone')) zonedDateParts(nowMs, zone)
    expect(cachedTimeZoneFormatterCount()).toBeLessThanOrEqual(XRAY_TIME_ZONE_FORMATTER_CACHE_LIMIT)
  })
})
