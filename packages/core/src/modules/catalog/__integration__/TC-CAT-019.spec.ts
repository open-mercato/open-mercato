import { expect, test } from '@playwright/test'
import {
  apiRequest,
  getAuthToken,
} from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'

/** TC-CAT-019: Option Schema Management */
test.describe('TC-CAT-019: Option Schema Management', () => {
  test('should create option schema via API and verify in list', async ({ request }) => {
    const stamp = Date.now()
    const schemaName = `QA Schema ${stamp}`
    let token: string | null = null
    let schemaId: string | null = null

    try {
      token = await getAuthToken(request)

      const createRes = await apiRequest(request, 'POST', '/api/catalog/option-schemas', {
        token,
        data: {
          name: schemaName,
          schema: {
            options: [
              {
                code: 'size',
                label: 'Size',
                inputType: 'select',
                choices: [
                  { code: 's', label: 'S' },
                  { code: 'm', label: 'M' },
                  { code: 'l', label: 'L' },
                ],
              },
            ],
          },
        },
      })
      expect(createRes.ok(), `Failed to create option schema: ${createRes.status()}`).toBeTruthy()
      const createBody = (await createRes.json()) as { id?: string }
      schemaId = typeof createBody.id === 'string' ? createBody.id : null
      expect(schemaId, 'Option schema id is required').toBeTruthy()

      const listRes = await apiRequest(
        request,
        'GET',
        `/api/catalog/option-schemas?page=1&pageSize=50&id=${encodeURIComponent(schemaId as string)}`,
        { token },
      )
      expect(listRes.ok(), `Failed to list option schemas: ${listRes.status()}`).toBeTruthy()
      const listBody = (await listRes.json()) as { items?: Array<Record<string, unknown>> }
      const items = Array.isArray(listBody.items) ? listBody.items : []
      const found = items.find((item) => item.id === schemaId)
      expect(found, 'Created option schema should appear in list').toBeTruthy()
      expect(found?.name).toBe(schemaName)
    } finally {
      if (token && schemaId) {
        await apiRequest(request, 'DELETE', `/api/catalog/option-schemas?id=${encodeURIComponent(schemaId as string)}`, {
          token,
        })
      }
    }
  })

  test('should update option schema name and options via API', async ({ request }) => {
    const stamp = Date.now()
    const originalName = `QA Schema Update ${stamp}`
    const updatedName = `QA Schema Updated ${stamp}`
    let token: string | null = null
    let schemaId: string | null = null

    try {
      token = await getAuthToken(request)

      const createRes = await apiRequest(request, 'POST', '/api/catalog/option-schemas', {
        token,
        data: {
          name: originalName,
          schema: {
            options: [
              {
                code: 'color',
                label: 'Color',
                inputType: 'select',
                choices: [
                  { code: 'red', label: 'Red' },
                  { code: 'blue', label: 'Blue' },
                ],
              },
            ],
          },
        },
      })
      expect(createRes.ok(), `Failed to create option schema: ${createRes.status()}`).toBeTruthy()
      const createBody = (await createRes.json()) as { id?: string }
      schemaId = typeof createBody.id === 'string' ? createBody.id : null
      expect(schemaId, 'Option schema id is required').toBeTruthy()

      const updateRes = await apiRequest(request, 'PUT', '/api/catalog/option-schemas', {
        token,
        data: {
          id: schemaId,
          name: updatedName,
          schema: {
            options: [
              {
                code: 'color',
                label: 'Color',
                inputType: 'select',
                choices: [
                  { code: 'red', label: 'Red' },
                  { code: 'blue', label: 'Blue' },
                  { code: 'green', label: 'Green' },
                ],
              },
            ],
          },
        },
      })
      expect(updateRes.ok(), `Failed to update option schema: ${updateRes.status()}`).toBeTruthy()

      const listRes = await apiRequest(
        request,
        'GET',
        `/api/catalog/option-schemas?page=1&pageSize=50&id=${encodeURIComponent(schemaId as string)}`,
        { token },
      )
      expect(listRes.ok(), `Failed to list option schemas: ${listRes.status()}`).toBeTruthy()
      const listBody = (await listRes.json()) as { items?: Array<Record<string, unknown>> }
      const items = Array.isArray(listBody.items) ? listBody.items : []
      const found = items.find((item) => item.id === schemaId)
      expect(found, 'Updated option schema should appear in list').toBeTruthy()
      expect(found?.name).toBe(updatedName)

      const schema = found?.schema as { options?: Array<{ choices?: Array<Record<string, unknown>> }> } | undefined
      const choices = schema?.options?.[0]?.choices
      expect(Array.isArray(choices), 'Schema options should have choices').toBeTruthy()
      expect(choices?.length).toBe(3)
      const choiceCodes = choices?.map((c) => c.code)
      expect(choiceCodes).toContain('green')
    } finally {
      if (token && schemaId) {
        await apiRequest(request, 'DELETE', `/api/catalog/option-schemas?id=${encodeURIComponent(schemaId as string)}`, {
          token,
        })
      }
    }
  })

  test('should delete option schema via API and verify removal', async ({ request }) => {
    const stamp = Date.now()
    const schemaName = `QA Schema Delete ${stamp}`
    let token: string | null = null
    let schemaId: string | null = null

    try {
      token = await getAuthToken(request)

      const createRes = await apiRequest(request, 'POST', '/api/catalog/option-schemas', {
        token,
        data: {
          name: schemaName,
          schema: {
            options: [
              {
                code: 'material',
                label: 'Material',
                inputType: 'select',
                choices: [
                  { code: 'cotton', label: 'Cotton' },
                  { code: 'polyester', label: 'Polyester' },
                ],
              },
            ],
          },
        },
      })
      expect(createRes.ok(), `Failed to create option schema: ${createRes.status()}`).toBeTruthy()
      const createBody = (await createRes.json()) as { id?: string }
      schemaId = typeof createBody.id === 'string' ? createBody.id : null
      expect(schemaId, 'Option schema id is required').toBeTruthy()

      const deleteRes = await apiRequest(
        request,
        'DELETE',
        `/api/catalog/option-schemas?id=${encodeURIComponent(schemaId as string)}`,
        { token },
      )
      expect(deleteRes.ok(), `Failed to delete option schema: ${deleteRes.status()}`).toBeTruthy()

      const listRes = await apiRequest(
        request,
        'GET',
        `/api/catalog/option-schemas?page=1&pageSize=50&id=${encodeURIComponent(schemaId as string)}`,
        { token },
      )
      expect(listRes.ok(), `Failed to list option schemas: ${listRes.status()}`).toBeTruthy()
      const listBody = (await listRes.json()) as { items?: Array<Record<string, unknown>> }
      const items = Array.isArray(listBody.items) ? listBody.items : []
      const found = items.find((item) => item.id === schemaId)
      expect(found, 'Deleted option schema should not appear in list').toBeFalsy()

      schemaId = null
    } finally {
      if (token && schemaId) {
        await apiRequest(request, 'DELETE', `/api/catalog/option-schemas?id=${encodeURIComponent(schemaId as string)}`, {
          token,
        })
      }
    }
  })

  test('should prevent deletion of option schema in use by a product', async ({ request }) => {
    const stamp = Date.now()
    const schemaName = `QA Schema InUse ${stamp}`
    let token: string | null = null
    let schemaId: string | null = null
    let productId: string | null = null

    try {
      token = await getAuthToken(request)

      const createSchemaRes = await apiRequest(request, 'POST', '/api/catalog/option-schemas', {
        token,
        data: {
          name: schemaName,
          schema: {
            options: [
              {
                code: 'size',
                label: 'Size',
                inputType: 'select',
                choices: [
                  { code: 's', label: 'S' },
                  { code: 'm', label: 'M' },
                ],
              },
            ],
          },
        },
      })
      expect(
        createSchemaRes.ok(),
        `Failed to create option schema: ${createSchemaRes.status()}`,
      ).toBeTruthy()
      const schemaBody = (await createSchemaRes.json()) as { id?: string }
      schemaId = typeof schemaBody.id === 'string' ? schemaBody.id : null
      expect(schemaId, 'Option schema id is required').toBeTruthy()

      const createProductRes = await apiRequest(request, 'POST', '/api/catalog/products', {
        token,
        data: {
          title: `QA TC-CAT-019 Product ${stamp}`,
          sku: `QA-CAT-019-${stamp}`,
          description:
            'Long enough description for option schema deletion prevention test. This text keeps the create validation satisfied.',
          optionSchemaId: schemaId,
          isConfigurable: true,
        },
      })
      expect(
        createProductRes.ok(),
        `Failed to create product with option schema: ${createProductRes.status()}`,
      ).toBeTruthy()
      const productBody = (await createProductRes.json()) as { id?: string }
      productId = typeof productBody.id === 'string' ? productBody.id : null
      expect(productId, 'Product id is required').toBeTruthy()

      const deleteRes = await apiRequest(
        request,
        'DELETE',
        `/api/catalog/option-schemas?id=${encodeURIComponent(schemaId as string)}`,
        { token },
      )
      const deleteStatus = deleteRes.status()
      expect(
        deleteStatus >= 400,
        `Deletion of in-use option schema should fail, got status ${deleteStatus}`,
      ).toBeTruthy()
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
      if (token && schemaId) {
        await apiRequest(request, 'DELETE', `/api/catalog/option-schemas?id=${encodeURIComponent(schemaId as string)}`, {
          token,
        })
      }
    }
  })
})
