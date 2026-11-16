import { isValidNip, normalizeNip } from '../lib/nip'

/** Independent reference implementation of the mod-11 NIP checksum. */
function isValidNipReference(nip: string): boolean {
  if (!/^[1-9]((\d[1-9])|([1-9]\d))\d{7}$/.test(nip)) return false
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7]
  const d = nip.split('').map(Number)
  const c = w.reduce((a, x, i) => a + x * d[i], 0) % 11
  return c !== 10 && c === d[9]
}

describe('normalizeNip', () => {
  it('strips separators and the PL prefix', () => {
    expect(normalizeNip('525-234-40-78')).toBe('5252344078')
    expect(normalizeNip(' PL 525 234 40 78 ')).toBe('5252344078')
    expect(normalizeNip('pl5252344078')).toBe('5252344078')
  })
})

describe('isValidNip', () => {
  it('accepts NIPs with a correct checksum', () => {
    expect(isValidNip('5252344078')).toBe(true)
    expect(isValidNip('PL 525-234-40-78')).toBe(true)
  })

  it('rejects a wrong checksum, wrong length and non-digits', () => {
    expect(isValidNip('5252344079')).toBe(false)
    // GUS test data NIP used for "not found" — its checksum is invalid (GUS does not validate it).
    expect(isValidNip('7261012312')).toBe(false)
    expect(isValidNip('525234407')).toBe(false)
    expect(isValidNip('52523440781')).toBe(false)
    expect(isValidNip('')).toBe(false)
    expect(isValidNip('abcdefghij')).toBe(false)
  })

  it('matches an independent checksum implementation for generated NIPs', () => {
    for (let i = 0; i < 500; i += 1) {
      const candidate = String(1_000_000_000 + ((i * 7_919_993) % 8_999_999_999)).padStart(10, '1').slice(0, 10)
      expect(isValidNip(candidate)).toBe(isValidNipReference(candidate))
    }
  })

  it('rejects structurally impossible NIPs even when the checksum matches', () => {
    expect(isValidNip('0000000000')).toBe(false)
    // tax office prefix ending in "00"
    expect(isValidNip('1000000000')).toBe(false)
  })

  it('rejects a NIP whose control sum is 10', () => {
    // 1234567890 → weighted sum 6+10+21+8+15+24+35+48+63 = 230, 230 % 11 = 10
    expect(isValidNip('1234567890')).toBe(false)
  })
})
