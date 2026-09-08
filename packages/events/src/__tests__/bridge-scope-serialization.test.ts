const query = jest.fn(async () => undefined)

jest.mock('pg', () => ({
  Client: jest.fn(),
  Pool: jest.fn(() => ({ query })),
}))

jest.mock('@open-mercato/shared/lib/db/ssl', () => ({
  getSslConfig: jest.fn(() => null),
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: jest.fn(() => ({
    error: jest.fn(),
    warn: jest.fn(),
  })),
}))

import { publishCrossProcessEvent } from '../bridge'

describe('cross-process event scope serialization', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL

  beforeAll(() => {
    process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/mercato'
  })

  afterAll(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalDatabaseUrl
  })

  it('preserves an explicit undefined trusted tenant marker as null', async () => {
    await publishCrossProcessEvent(
      'example.todo.updated',
      { tenantId: 'forged-tenant', organizationId: 'forged-organization' },
      { tenantId: undefined },
    )

    const serializedEnvelope = query.mock.calls[0]?.[1]?.[1]
    expect(typeof serializedEnvelope).toBe('string')
    const envelope = JSON.parse(serializedEnvelope as string) as {
      options?: { tenantId?: string | null }
    }
    expect(envelope.options).toEqual({ tenantId: null })
  })
})
