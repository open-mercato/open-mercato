import { openApi } from '../status'

describe('query index status OpenAPI', () => {
  it('documents the empty-organization-scope denial response', () => {
    expect(openApi.methods.GET?.errors).toContainEqual(
      expect.objectContaining({
        status: 403,
        description: 'Organization access denied',
      }),
    )
  })
})
