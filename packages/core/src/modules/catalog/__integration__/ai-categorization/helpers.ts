import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe, expectId } from '@open-mercato/core/helpers/integration/generalFixtures'

export const SETTINGS_PATH = '/api/catalog/ai-categorization/settings'
export const SUGGESTIONS_PATH = '/api/catalog/category-suggestions'

export type SuggestionDto = {
  id: string
  productId: string
  outcome: 'suggested' | 'no_match' | string
  categoryId: string | null
  categoryPathIds: string[]
  confidence: number | null
  status: string
  categoryLive?: boolean
  updatedAt: string
}

export async function setAiCategorizationEnabled(
  request: APIRequestContext,
  token: string,
  enabled: boolean,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', SETTINGS_PATH, {
    token,
    data: { settings: { enabled, applyMode: 'suggest', autoApplyThreshold: 0.85, autoSuggestOnCreate: false } },
  })
  expect(response.ok(), `PUT ${SETTINGS_PATH} enabled=${enabled} should succeed: ${response.status()}`).toBeTruthy()
}

export async function createCategory(
  request: APIRequestContext,
  token: string,
  name: string,
  options?: { parentId?: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/catalog/categories', {
    token,
    data: { name, ...(options?.parentId ? { parentId: options.parentId } : {}) },
  })
  expect(response.ok(), `Failed to create category "${name}": ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'Category creation response should include id')
}

export async function deleteCategory(request: APIRequestContext, token: string, categoryId: string | null): Promise<void> {
  if (!categoryId) return
  await apiRequest(request, 'DELETE', `/api/catalog/categories?id=${encodeURIComponent(categoryId)}`, { token }).catch(() => undefined)
}

export async function createProduct(
  request: APIRequestContext,
  token: string,
  input: { title: string; sku: string; description: string; categoryIds?: string[] },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/catalog/products', {
    token,
    data: { title: input.title, sku: input.sku, description: input.description, categoryIds: input.categoryIds ?? [] },
  })
  expect(response.ok(), `Failed to create product "${input.title}": ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'Product creation response should include id')
}

export async function deleteProduct(request: APIRequestContext, token: string, productId: string | null): Promise<void> {
  if (!productId) return
  await apiRequest(request, 'DELETE', `/api/catalog/products?id=${encodeURIComponent(productId)}`, { token }).catch(() => undefined)
}

export async function readProductCategoryIds(request: APIRequestContext, token: string, productId: string): Promise<string[]> {
  const response = await apiRequest(request, 'GET', `/api/catalog/products?id=${encodeURIComponent(productId)}`, { token })
  expect(response.ok(), `GET product ${productId} failed: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ items?: Array<{ id?: string; categoryIds?: string[] }> }>(response)
  const item = (body?.items ?? []).find((entry) => entry.id === productId)
  return Array.isArray(item?.categoryIds) ? (item!.categoryIds as string[]) : []
}

export async function suggestCategory(
  request: APIRequestContext,
  token: string,
  productId: string,
): Promise<{ status: number; body: { suggestion?: SuggestionDto; outcome?: string; code?: string } }> {
  const response = await apiRequest(request, 'POST', `/api/catalog/products/${encodeURIComponent(productId)}/category-suggestion`, {
    token,
    data: {},
  })
  const body = (await readJsonSafe<{ suggestion?: SuggestionDto; outcome?: string; code?: string }>(response)) ?? {}
  return { status: response.status(), body }
}

export async function acceptSuggestion(
  request: APIRequestContext,
  token: string,
  suggestionId: string,
  input: { categoryId?: string; makeMain?: boolean } = {},
) {
  return apiRequest(request, 'POST', `${SUGGESTIONS_PATH}/${encodeURIComponent(suggestionId)}/accept`, { token, data: input })
}

export async function rejectSuggestion(request: APIRequestContext, token: string, suggestionId: string) {
  return apiRequest(request, 'POST', `${SUGGESTIONS_PATH}/${encodeURIComponent(suggestionId)}/reject`, { token, data: {} })
}

export async function getPendingSuggestion(
  request: APIRequestContext,
  token: string,
  productId: string,
): Promise<SuggestionDto | null> {
  const params = new URLSearchParams({ productId, status: 'pending', pageSize: '1' })
  const response = await apiRequest(request, 'GET', `${SUGGESTIONS_PATH}?${params.toString()}`, { token })
  expect(response.ok(), `GET ${SUGGESTIONS_PATH} failed: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ items?: SuggestionDto[] }>(response)
  return body?.items?.[0] ?? null
}
