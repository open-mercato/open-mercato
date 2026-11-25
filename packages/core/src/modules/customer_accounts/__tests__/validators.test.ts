import {
  loginSchema,
  signupSchema,
  createRoleSchema,
  passwordChangeSchema,
  inviteUserSchema,
  assignRolesSchema,
  adminCreateUserSchema,
  adminUpdateUserSchema,
  MAX_CUSTOMER_ROLE_IDS,
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


describe('customer role ID request limits', () => {
  const roleIds = Array.from({ length: MAX_CUSTOMER_ROLE_IDS + 1 }, (_, index) => (
    `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`
  ))
  const user = { email: 'buyer@example.com', password: 'Secret123!', displayName: 'Buyer' }

  it.each([
    { name: 'staff and portal invitations', schema: inviteUserSchema, input: { email: user.email } },
    { name: 'portal assignment', schema: assignRolesSchema, input: {} },
    { name: 'staff creation', schema: adminCreateUserSchema, input: user },
    { name: 'staff update', schema: adminUpdateUserSchema, input: {} },
  ])('accepts the maximum and rejects one more role for $name', ({ schema, input }) => {
    expect(schema.safeParse({ ...input, roleIds: roleIds.slice(0, MAX_CUSTOMER_ROLE_IDS) }).success).toBe(true)
    const result = schema.safeParse({ ...input, roleIds })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['roleIds'], code: 'too_big' }),
    ]))
  })

  it('counts duplicates toward the input limit before role deduplication', () => {
    expect(inviteUserSchema.safeParse({ email: user.email, roleIds: Array(101).fill(roleIds[0]) }).success).toBe(false)
  })

  it('preserves optional and empty role lists for staff create/update', () => {
    for (const roleIds of [undefined, []]) {
      expect(adminCreateUserSchema.safeParse({ ...user, roleIds }).success).toBe(true)
      expect(adminUpdateUserSchema.safeParse({ roleIds }).success).toBe(true)
    }
    expect(inviteUserSchema.safeParse({ email: user.email, roleIds: [] }).success).toBe(false)
    expect(assignRolesSchema.safeParse({ roleIds: [] }).success).toBe(false)
  })
})
