import {
  loginSchema,
  signupSchema,
  createRoleSchema,
  passwordChangeSchema,
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
      password: 'longpassword',
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
      password: 'longpassword',
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
      newPassword: 'new-password-long',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing currentPassword', () => {
    const result = passwordChangeSchema.safeParse({
      newPassword: 'new-password-long',
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
