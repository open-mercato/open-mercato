import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { parseJsonBody, requireOrganization } from '../http'

const translate = ((key: string) => `localized:${key}`) as TranslateFn

describe('document generator HTTP guards', () => {
  it('returns a coded, localized response for malformed JSON', async () => {
    const request = new Request('http://localhost/api/document-generators/preview', {
      method: 'POST',
      body: '{',
    })

    const result = await parseJsonBody(request, translate)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(400)
    await expect(result.response.json()).resolves.toEqual({
      error: 'invalid_json',
      message: 'localized:document_generators.errors.invalid_json',
    })
  })

  it('returns a coded, localized response when organization scope is missing', async () => {
    const result = requireOrganization({ tenantId: 'tenant-1' } as AuthContext, translate)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(409)
    await expect(result.response.json()).resolves.toEqual({
      error: 'organization_required',
      message: 'localized:document_generators.errors.organization_required',
    })
  })
})
