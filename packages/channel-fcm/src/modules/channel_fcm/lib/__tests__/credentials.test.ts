import { fcmCredentialsSchema, parseFcmServiceAccount } from '../credentials'

const validJson = JSON.stringify({
  project_id: 'demo-project',
  client_email: 'svc@demo-project.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
})

describe('fcmCredentialsSchema', () => {
  it('accepts a well-formed service account JSON', () => {
    const parsed = fcmCredentialsSchema.safeParse({ serviceAccountJson: validJson })
    expect(parsed.success).toBe(true)
  })

  it('rejects missing service account JSON', () => {
    const parsed = fcmCredentialsSchema.safeParse({})
    expect(parsed.success).toBe(false)
  })

  it('rejects malformed JSON', () => {
    const parsed = fcmCredentialsSchema.safeParse({ serviceAccountJson: '{not json' })
    expect(parsed.success).toBe(false)
  })

  it('rejects JSON missing required service-account fields', () => {
    const parsed = fcmCredentialsSchema.safeParse({ serviceAccountJson: JSON.stringify({ project_id: 'x' }) })
    expect(parsed.success).toBe(false)
  })

  it('normalizes snake_case service account into camelCase', () => {
    const account = parseFcmServiceAccount({ serviceAccountJson: validJson })
    expect(account.projectId).toBe('demo-project')
    expect(account.clientEmail).toBe('svc@demo-project.iam.gserviceaccount.com')
    expect(account.privateKey).toContain('BEGIN PRIVATE KEY')
  })
})
