import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'

/**
 * TC-CAT-029: Option schemas — delete is blocked while a product references the schema.
 * Source: issue #2484 (catalog integration coverage), scenario TC-CAT-029.
 *
 * Note: the issue framed this around a *variant* reference, but variants carry
 * no option-schema FK in the data model. The referential link lives on the
 * PRODUCT (`optionSchemaId` / `isConfigurable`), and the delete command blocks
 * with `HTTP 400 { error: 'Detach products from this schema before deleting it.' }`
 * while any product is attached. TC-CAT-019 asserts only `status >= 400`; this
 * spec pins the exact status + message, proves the schema survives the failed
 * delete, and proves the delete succeeds once the product is detached.
 */
test.describe('TC-CAT-029: Option schema referential integrity on delete', () => {
  test('blocks delete while attached, then succeeds after the product is detached', async ({
    request,
  }) => {
    const stamp = Date.now()
    let token: string | null = null
    let schemaId: string | null = null
    let productId: string | null = null

    try {
      token = await getAuthToken(request)

      const createSchemaRes = await apiRequest(request, 'POST', '/api/catalog/option-schemas', {
        token,
        data: {
          name: `QA Schema Ref ${stamp}`,
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
      schemaId = ((await createSchemaRes.json()) as { id?: string }).id ?? null
      expect(schemaId, 'Option schema id is required').toBeTruthy()

      const createProductRes = await apiRequest(request, 'POST', '/api/catalog/products', {
        token,
        data: {
          title: `QA TC-CAT-029 Product ${stamp}`,
          sku: `QA-CAT-029-${stamp}`,
          description:
            'Long enough description for the option-schema referential-integrity test. This text keeps the create validation satisfied.',
          optionSchemaId: schemaId,
          isConfigurable: true,
        },
      })
      expect(
        createProductRes.ok(),
        `Failed to create product referencing schema: ${createProductRes.status()}`,
      ).toBeTruthy()
      productId = ((await createProductRes.json()) as { id?: string }).id ?? null
      expect(productId, 'Product id is required').toBeTruthy()

      // Delete must be blocked while the product references the schema.
      const blockedRes = await apiRequest(
        request,
        'DELETE',
        `/api/catalog/option-schemas?id=${encodeURIComponent(schemaId as string)}`,
        { token },
      )
      expect(blockedRes.status(), 'Delete of an in-use schema must be blocked').toBe(400)
      const blockedBody = (await blockedRes.json()) as { error?: string }
      expect(blockedBody.error).toBe('Detach products from this schema before deleting it.')

      // The schema must still exist after the failed delete.
      const stillThereRes = await apiRequest(
        request,
        'GET',
        `/api/catalog/option-schemas?page=1&pageSize=50&id=${encodeURIComponent(schemaId as string)}`,
        { token },
      )
      expect(stillThereRes.ok()).toBeTruthy()
      const stillThereBody = (await stillThereRes.json()) as { items?: Array<{ id: string }> }
      expect((stillThereBody.items ?? []).some((item) => item.id === schemaId)).toBeTruthy()

      // Detach the product, then the delete should succeed.
      const detachRes = await apiRequest(request, 'PUT', '/api/catalog/products', {
        token,
        data: { id: productId, optionSchemaId: null, isConfigurable: false },
      })
      expect(detachRes.ok(), `Failed to detach product from schema: ${detachRes.status()}`).toBeTruthy()

      const deleteRes = await apiRequest(
        request,
        'DELETE',
        `/api/catalog/option-schemas?id=${encodeURIComponent(schemaId as string)}`,
        { token },
      )
      expect(deleteRes.ok(), `Detached schema should delete: ${deleteRes.status()}`).toBeTruthy()

      const goneRes = await apiRequest(
        request,
        'GET',
        `/api/catalog/option-schemas?page=1&pageSize=50&id=${encodeURIComponent(schemaId as string)}`,
        { token },
      )
      expect(goneRes.ok()).toBeTruthy()
      const goneBody = (await goneRes.json()) as { items?: Array<{ id: string }> }
      expect((goneBody.items ?? []).some((item) => item.id === schemaId)).toBeFalsy()

      schemaId = null
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
      if (token && schemaId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/catalog/option-schemas?id=${encodeURIComponent(schemaId as string)}`,
          { token },
        ).catch(() => undefined)
      }
    }
  })
})
