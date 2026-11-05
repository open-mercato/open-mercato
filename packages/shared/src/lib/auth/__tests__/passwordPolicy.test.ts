import {
  buildPasswordSchema,
  formatPasswordRequirements,
  getPasswordPolicy,
  getPasswordRequirements,
  validatePassword,
} from '../passwordPolicy'

describe('passwordPolicy', () => {
  it('returns the default policy when no env overrides are present', () => {
    expect(getPasswordPolicy({} as NodeJS.ProcessEnv)).toEqual({
      minLength: 6,
      requireDigit: true,
      requireUppercase: true,
      requireSpecial: true,
    })
  })

  it('prefers server env values, falls back to NEXT_PUBLIC values, and clamps min length', () => {
    const env = {
      OM_PASSWORD_MIN_LENGTH: '0',
      OM_PASSWORD_REQUIRE_DIGIT: 'disabled',
      OM_PASSWORD_REQUIRE_SPECIAL: '   ',
      NEXT_PUBLIC_OM_PASSWORD_MIN_LENGTH: '12',
      NEXT_PUBLIC_OM_PASSWORD_REQUIRE_DIGIT: 'enabled',
      NEXT_PUBLIC_OM_PASSWORD_REQUIRE_UPPERCASE: 'false',
      NEXT_PUBLIC_OM_PASSWORD_REQUIRE_SPECIAL: 'off',
    } as NodeJS.ProcessEnv

    expect(getPasswordPolicy(env)).toEqual({
      minLength: 1,
      requireDigit: false,
      requireUppercase: false,
      requireSpecial: false,
    })
  })

  it('falls back to defaults when env overrides are invalid', () => {
    const env = {
      OM_PASSWORD_MIN_LENGTH: 'not-a-number',
      OM_PASSWORD_REQUIRE_DIGIT: 'maybe',
      OM_PASSWORD_REQUIRE_UPPERCASE: 'sometimes',
      OM_PASSWORD_REQUIRE_SPECIAL: 'unknown',
    } as NodeJS.ProcessEnv

    expect(getPasswordPolicy(env)).toEqual({
      minLength: 6,
      requireDigit: true,
      requireUppercase: true,
      requireSpecial: true,
    })
  })

  it('returns enabled requirements in policy order', () => {
    expect(
      getPasswordRequirements({
        minLength: 10,
        requireDigit: false,
        requireUppercase: true,
        requireSpecial: true,
      }),
    ).toEqual([
      { id: 'minLength', value: 10 },
      { id: 'uppercase' },
      { id: 'special' },
    ])
  })

  it('formats requirement text with translation keys, params, and custom separators', () => {
    const translate = jest.fn(
      (key: string, fallback: string, params?: Record<string, string | number>) => {
        switch (key) {
          case 'custom.password.minLength':
            return `min:${String(params?.min)}`
          case 'custom.password.uppercase':
            return 'uppercase'
          case 'custom.password.special':
            return '   '
          case 'custom.password.separator':
            return ' | '
          default:
            return fallback
        }
      },
    )

    expect(
      formatPasswordRequirements(
        {
          minLength: 12,
          requireDigit: false,
          requireUppercase: true,
          requireSpecial: true,
        },
        translate,
        'custom.password',
      ),
    ).toBe('min:12 | uppercase')

    expect(translate).toHaveBeenCalledWith(
      'custom.password.minLength',
      'At least {min} characters',
      { min: 12 },
    )
    expect(translate).toHaveBeenCalledWith('custom.password.separator', ', ')
  })

  it('returns ordered violations for passwords that fail enabled checks', () => {
    expect(
      validatePassword('abc', {
        minLength: 6,
        requireDigit: true,
        requireUppercase: true,
        requireSpecial: true,
      }),
    ).toEqual({
      ok: false,
      violations: ['minLength', 'digit', 'uppercase', 'special'],
    })

    expect(
      validatePassword('Password1', {
        minLength: 8,
        requireDigit: true,
        requireUppercase: true,
        requireSpecial: false,
      }),
    ).toEqual({
      ok: true,
      violations: [],
    })
  })

  it('builds a zod schema that enforces both policy and max length', () => {
    const schema = buildPasswordSchema({
      policy: {
        minLength: 8,
        requireDigit: true,
        requireUppercase: true,
        requireSpecial: false,
      },
      maxLength: 10,
      message: 'Weak password',
    })

    expect(schema.safeParse('Password1').success).toBe(true)

    const weakResult = schema.safeParse('password1')
    expect(weakResult.success).toBe(false)
    if (weakResult.success) throw new Error('Expected lowercase password to fail schema validation')
    expect(weakResult.error.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: 'Weak password' })]),
    )

    const tooLongResult = schema.safeParse('Password1234')
    expect(tooLongResult.success).toBe(false)
    if (tooLongResult.success) throw new Error('Expected overlong password to fail schema validation')
    expect(tooLongResult.error.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: 'Weak password' })]),
    )
  })
})
