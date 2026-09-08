import { listIntegrationsQuerySchema, saveCredentialsSchema } from '../validators'

describe('integrations validators', () => {
  test('listIntegrationsQuerySchema accepts empty queries and applies defaults', () => {
    expect(listIntegrationsQuerySchema.parse({})).toEqual({
      order: 'asc',
      page: 1,
      pageSize: 100,
    })
  })

  test('listIntegrationsQuerySchema parses optional boolean query tokens', () => {
    expect(listIntegrationsQuerySchema.parse({ isEnabled: 'true' }).isEnabled).toBe(true)
    expect(listIntegrationsQuerySchema.parse({ isEnabled: 'false' }).isEnabled).toBe(false)
  })

  test('listIntegrationsQuerySchema treats blank optional boolean query tokens as omitted', () => {
    expect(listIntegrationsQuerySchema.parse({ isEnabled: '' }).isEnabled).toBeUndefined()
  })

  test('saveCredentialsSchema accepts a bounded list of unchanged secret fields', () => {
    expect(saveCredentialsSchema.parse({
      credentials: { apiUrl: 'https://example.com' },
      unchangedSecretFields: ['apiSecret'],
    })).toEqual({
      credentials: { apiUrl: 'https://example.com' },
      unchangedSecretFields: ['apiSecret'],
    })
  })

  test('saveCredentialsSchema rejects duplicate or excessive unchanged secret fields', () => {
    expect(saveCredentialsSchema.safeParse({
      credentials: {},
      unchangedSecretFields: ['apiSecret', 'apiSecret'],
    }).success).toBe(false)
    expect(saveCredentialsSchema.safeParse({
      credentials: {},
      unchangedSecretFields: Array.from({ length: 201 }, (_, index) => `secret_${index}`),
    }).success).toBe(false)
  })
})
