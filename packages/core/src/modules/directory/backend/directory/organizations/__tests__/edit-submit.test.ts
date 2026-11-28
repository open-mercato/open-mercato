jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: () => null,
}))

import { submitUpdateOrganization } from '../[id]/edit/page'

describe('submitUpdateOrganization', () => {
  it('throws when organization identifier is missing', async () => {
    const error = await submitUpdateOrganization({
      values: { name: 'Acme' },
      orgId: '',
      tenantId: null,
      originalChildIds: [],
      updateOrganization: async () => {},
    }).catch((err) => err as Error)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      message: 'Organization identifier is required',
      fieldErrors: { id: 'Organization identifier is required' },
    })
  })

  it('passes sanitized payload to updateOrganization', async () => {
    const updateOrganization = jest.fn(async () => {})
    await submitUpdateOrganization({
      values: {
        id: 'org-1',
        name: 'Acme',
        isActive: true,
        parentId: 'parent-1',
        tenantId: 'tenant-1',
        cf_custom: 'value',
      },
      orgId: 'org-1',
      tenantId: 'tenant-1',
      originalChildIds: ['child-1', 'child-2'],
      updateOrganization,
    })
    expect(updateOrganization).toHaveBeenCalledWith({
      id: 'org-1',
      name: 'Acme',
      isActive: true,
      parentId: 'parent-1',
      childIds: ['child-1', 'child-2'],
      tenantId: 'tenant-1',
      customFields: { custom: 'value' },
    })
  })

  it('rejects oversized names with the localized field message before sending a mutation', async () => {
    const request = jest.fn(async () => {})
    const message = 'Nazwa może zawierać najwyżej 200 znaków'
    await expect(submitUpdateOrganization({
      values: { name: 'x'.repeat(201) },
      orgId: 'org-1', tenantId: null, originalChildIds: [],
      updateOrganization: request,
      messages: { nameTooLong: message },
    })).rejects.toMatchObject({ message, fieldErrors: { name: message } })
    expect(request).not.toHaveBeenCalled()

    await submitUpdateOrganization({
      values: { name: 'x'.repeat(200) },
      orgId: 'org-1', tenantId: null, originalChildIds: [],
      updateOrganization: request,
      messages: { nameTooLong: message },
    })
    expect(request).toHaveBeenCalledTimes(1)
  })
})
