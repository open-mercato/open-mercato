import { listIntegrationsQuerySchema } from '../validators'

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
})
