import {
  loginSchema,
  signupSchema,
  createRoleSchema,
  passwordChangeSchema,
  passwordResetConfirmSchema,
  invitationAcceptSchema,
  adminCreateUserSchema,
  adminResetPasswordSchema,
} from '../data/validators'

describe('loginSchema', () => {
  it('accepts valid input', () => {
    const result = loginSchema.safeParse({
      email: 'user@example.com',
      password: 'secret123',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing email', () => {
    const result = loginSchema.safeParse({
      password: 'secret123',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing password', () => {
    const result = loginSchema.safeParse({
      email: 'user@example.com',
    })
    expect(result.success).toBe(false)
  })
})

describe('signupSchema', () => {
  it('accepts valid input', () => {
    const result = signupSchema.safeParse({
      email: 'user@example.com',
      password: 'Long-password-1!',
      displayName: 'Test User',
    })
    expect(result.success).toBe(true)
  })

  it('rejects password that is too short', () => {
    const result = signupSchema.safeParse({
      email: 'user@example.com',
      password: 'short',
      displayName: 'Test User',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid email', () => {
    const result = signupSchema.safeParse({
      email: 'not-an-email',
      password: 'Long-password-1!',
      displayName: 'Test User',
    })
    expect(result.success).toBe(false)
  })
})

describe('createRoleSchema', () => {
  it('accepts valid input', () => {
    const result = createRoleSchema.safeParse({
      name: 'Editor',
      slug: 'editor-role',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid slug format', () => {
    const result = createRoleSchema.safeParse({
      name: 'Editor',
      slug: 'Invalid Slug!',
    })
    expect(result.success).toBe(false)
  })
})

describe('passwordChangeSchema', () => {
  it('accepts valid input', () => {
    const result = passwordChangeSchema.safeParse({
      currentPassword: 'old-password',
      newPassword: 'New-password-long-1!',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing currentPassword', () => {
    const result = passwordChangeSchema.safeParse({
      newPassword: 'New-password-long-1!',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing newPassword', () => {
    const result = passwordChangeSchema.safeParse({
      currentPassword: 'old-password',
    })
    expect(result.success).toBe(false)
  })
})

const credentialSchemas = [
  ['signup', signupSchema, 'password', { email: 'user@example.com', displayName: 'User' }],
  ['password reset', passwordResetConfirmSchema, 'password', { token: 'reset-token' }],
  ['invitation', invitationAcceptSchema, 'password', { token: 'invite-token', displayName: 'User' }],
  ['password change', passwordChangeSchema, 'newPassword', { currentPassword: 'secret' }],
  ['admin create', adminCreateUserSchema, 'password', { email: 'user@example.com', displayName: 'User' }],
  ['admin reset', adminResetPasswordSchema, 'newPassword', {}],
] as const

describe.each(credentialSchemas)('%s credential policy', (_name, schema, field, input) => {
  it.each(['longpassword', 'LongPassword1', 'long-password-1!', 'Long-password!'])(
    'rejects a password missing a policy requirement: %s',
    (password) => {
      expect(schema.safeParse({ ...input, [field]: password }).success).toBe(false)
    },
  )

  it('preserves the customer minimum and maximum length', () => {
    expect(schema.safeParse({ ...input, [field]: 'Aa1!aaa' }).success).toBe(false)
    expect(schema.safeParse({ ...input, [field]: 'Aa1!' + 'a'.repeat(125) }).success).toBe(false)
    expect(schema.safeParse({ ...input, [field]: 'Aa1!' + 'a'.repeat(124) }).success).toBe(true)
  })

  it('accepts a policy-compliant password', () => {
    expect(schema.safeParse({ ...input, [field]: 'Strong-Passw0rd!' }).success).toBe(true)
  })
})

it('keeps staff and customer login and current-password validation permissive', async () => {
  const { userLoginSchema } = await import('../../auth/data/validators')
  expect(userLoginSchema.safeParse({ email: 'user@example.com', password: 'secret' }).success).toBe(true)
  expect(loginSchema.safeParse({ email: 'user@example.com', password: 'x' }).success).toBe(true)
  expect(passwordChangeSchema.safeParse({ currentPassword: 'x', newPassword: 'Strong-Passw0rd!' }).success).toBe(true)
})

describe('configured customer credential policy', () => {
  const originalEnv = process.env

  afterEach(() => { process.env = originalEnv })

  it('applies a stricter shared minimum length to every credential write', () => {
    process.env = { ...originalEnv, OM_PASSWORD_MIN_LENGTH: '24' }
    jest.isolateModules(() => {
      const schemas = jest.requireActual<typeof import('../data/validators')>('../data/validators')
      for (const [name, , field, input] of credentialSchemas) {
        const selected = {
          signup: schemas.signupSchema,
          'password reset': schemas.passwordResetConfirmSchema,
          invitation: schemas.invitationAcceptSchema,
          'password change': schemas.passwordChangeSchema,
          'admin create': schemas.adminCreateUserSchema,
          'admin reset': schemas.adminResetPasswordSchema,
        }[name]
        expect(selected.safeParse({ ...input, [field]: 'Strong-Passw0rd!' }).success).toBe(false)
        expect(selected.safeParse({ ...input, [field]: 'Strong-Passw0rd!'.repeat(2) }).success).toBe(true)
      }
    })
  })

  it('honors disabled complexity requirements while retaining the customer minimum', () => {
    process.env = {
      ...originalEnv, OM_PASSWORD_MIN_LENGTH: '4',
      OM_PASSWORD_REQUIRE_DIGIT: 'false', OM_PASSWORD_REQUIRE_UPPERCASE: 'false',
      OM_PASSWORD_REQUIRE_SPECIAL: 'false',
    }
    jest.isolateModules(() => {
      const { signupSchema: configuredSignup } = jest.requireActual<typeof import('../data/validators')>('../data/validators')
      const input = { email: 'user@example.com', displayName: 'User' }
      expect(configuredSignup.safeParse({ ...input, password: 'longpassword' }).success).toBe(true)
      expect(configuredSignup.safeParse({ ...input, password: 'short' }).success).toBe(false)
    })
  })
})
