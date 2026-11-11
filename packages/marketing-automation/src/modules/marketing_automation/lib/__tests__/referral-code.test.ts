import {
  REFERRAL_CODE_LENGTH,
  generateReferralCode,
  isValidReferralCode,
  normalizeReferralCode,
  referralUrlFor,
} from '../engine/referral-code'

/** Deterministic bytes, so the generator can be asserted rather than sampled. */
function bytes(values: number[]): (size: number) => Uint8Array {
  return (size: number) => Uint8Array.from(Array.from({ length: size }, (_, index) => values[index % values.length]))
}

describe('generateReferralCode', () => {
  it('produces a code of the documented length from the documented alphabet', () => {
    const code = generateReferralCode(bytes([0, 1, 10, 31, 32, 63, 100, 255]))
    expect(code).toHaveLength(REFERRAL_CODE_LENGTH)
    expect(isValidReferralCode(code)).toBe(true)
  })

  it('never emits a character a person would misread', () => {
    // Every byte value maps somewhere; none of them may land on I, L, O or U.
    for (let value = 0; value < 256; value += 1) {
      const code = generateReferralCode(bytes([value]))
      expect(code).not.toMatch(/[ILOU]/)
    }
  })

  it('is a pure function of the bytes it was given', () => {
    const first = generateReferralCode(bytes([5, 9, 12, 20, 25, 30, 2, 7]))
    const again = generateReferralCode(bytes([5, 9, 12, 20, 25, 30, 2, 7]))
    expect(first).toBe(again)
  })
})

describe('normalizeReferralCode', () => {
  it('forgives the substitutions people actually make', () => {
    expect(normalizeReferralCode('o1i l')).toBe('0111')
  })

  it('folds each excluded character onto the one it was misread from', () => {
    expect(normalizeReferralCode('O')).toBe('0')
    expect(normalizeReferralCode('I')).toBe('1')
    expect(normalizeReferralCode('L')).toBe('1')
    expect(normalizeReferralCode('U')).toBe('V')
  })

  it('drops the separators people add for readability', () => {
    expect(normalizeReferralCode(' ab-cd_ef.gh ')).toBe('ABCDEFGH')
  })

  it('leaves a code the generator produced unchanged', () => {
    const code = generateReferralCode(bytes([3, 14, 15, 9, 26, 5, 31, 0]))
    expect(normalizeReferralCode(code)).toBe(code)
  })

  it('never changes a character that is IN the alphabet', () => {
    // The first attempt at this folded `L` onto a letter that was itself valid, so a legitimate code
    // containing it stopped resolving. This is the test that would have caught it.
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
    for (const char of alphabet) {
      expect(normalizeReferralCode(char)).toBe(char)
    }
  })
})

describe('isValidReferralCode', () => {
  it('refuses the wrong length', () => {
    expect(isValidReferralCode('ABCDEFG')).toBe(false)
    expect(isValidReferralCode('ABCDEFGHJ')).toBe(false)
    expect(isValidReferralCode('')).toBe(false)
  })

  it('refuses characters outside the alphabet, including the excluded ones', () => {
    expect(isValidReferralCode('ABCDEFGI')).toBe(false)
    expect(isValidReferralCode('ABCDEFG!')).toBe(false)
    expect(isValidReferralCode('abcdefgh')).toBe(false)
  })
})

describe('referralUrlFor', () => {
  it('requires the placeholder, so a template cannot silently send everyone to the same page', () => {
    expect(referralUrlFor('https://shop.example/invite', 'ABCDEFGH')).toBeNull()
    expect(referralUrlFor(null, 'ABCDEFGH')).toBeNull()
  })

  it('substitutes and encodes', () => {
    expect(referralUrlFor('https://shop.example/r/{code}', 'ABCDEFGH')).toBe('https://shop.example/r/ABCDEFGH')
  })
})
