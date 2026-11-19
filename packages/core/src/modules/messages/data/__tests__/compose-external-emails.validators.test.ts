import { composeMessageRequestSchema, composeMessageSchema } from '../validators'

const base = {
  visibility: 'public' as const,
  subject: 'Offer',
  body: 'Hello',
}

function issuePaths(result: ReturnType<typeof composeMessageSchema.safeParse>): string[] {
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))
}

describe('compose validators — externalEmails', () => {
  it('accepts a public message addressed through externalEmails only', () => {
    const result = composeMessageSchema.safeParse({ ...base, externalEmails: ['a@example.com', 'b@example.com'] })
    expect(result.success).toBe(true)
  })

  it('rejects externalEmail combined with externalEmails on externalEmails', () => {
    const result = composeMessageSchema.safeParse({
      ...base,
      externalEmail: 'a@example.com',
      externalEmails: ['b@example.com'],
    })
    expect(issuePaths(result)).toContain('externalEmails')
  })

  it('rejects an empty list, more than 50 addresses and invalid addresses', () => {
    expect(issuePaths(composeMessageSchema.safeParse({ ...base, externalEmails: [] }))).toContain('externalEmails')
    const tooMany = Array.from({ length: 51 }, (_, index) => `user${index}@example.com`)
    expect(issuePaths(composeMessageSchema.safeParse({ ...base, externalEmails: tooMany }))).toContain('externalEmails')
    expect(issuePaths(composeMessageSchema.safeParse({ ...base, externalEmails: ['not-an-email'] }))).toContain('externalEmails.0')
  })

  it('still requires an external address on a public message', () => {
    expect(issuePaths(composeMessageSchema.safeParse(base))).toContain('externalEmail')
  })

  it('keeps externalParticipants server-only', () => {
    const parsed = composeMessageRequestSchema.parse({
      ...base,
      externalEmail: 'a@example.com',
      externalParticipants: [{ email: 'cc@example.com', role: 'cc' }],
    })
    expect(parsed).not.toHaveProperty('externalParticipants')
    const command = composeMessageSchema.parse({
      ...base,
      externalEmail: 'a@example.com',
      externalParticipants: [{ email: 'cc@example.com', role: 'cc' }],
    })
    expect(command.externalParticipants).toEqual([{ email: 'cc@example.com', role: 'cc' }])
  })
})
