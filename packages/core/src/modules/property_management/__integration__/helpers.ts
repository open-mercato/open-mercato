import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCategoryFixture,
  deleteCatalogCategoryIfExists,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import { purgeBuildingsInDb } from './dbCleanup'

export type FloorRow = { id: string; number: number; name: string; sizeX: number; sizeY: number; updatedAt: string }
export type SpaceRow = { id: string; name: string; isDefault: boolean; x: number; y: number; width: number; depth: number; updatedAt: string }
export type UnitRow = { id: string; name: string; spaceId: string; catalogProductId: string; updatedAt: string }

export function layoutOf(below: number, above: number, size: { x: number; y: number } = { x: 20, y: 10 }) {
  const floors: Array<{ number: number; name: string; sizeX: number; sizeY: number }> = []
  for (let index = below; index >= 1; index -= 1) floors.push({ number: -index, name: `Level -${index}`, sizeX: size.x, sizeY: size.y })
  for (let index = 0; index < above; index += 1) floors.push({ number: index, name: `Level ${index}`, sizeX: size.x, sizeY: size.y })
  return { below, above, floors }
}

export async function createBuilding(
  request: APIRequestContext,
  token: string,
  input: { name: string; below?: number; above?: number; size?: { x: number; y: number }; managerUserIds?: string[] },
): Promise<string> {
  await purgeBuildingsOfEarlierTests()
  const response = await apiRequest(request, 'POST', '/api/property_management/buildings', {
    token,
    data: {
      name: input.name,
      address: `${input.name} street 1`,
      managerUserIds: input.managerUserIds,
      layout: layoutOf(input.below ?? 0, input.above ?? 1, input.size),
    },
  })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.status(), `POST buildings should return 201, got ${JSON.stringify(body)}`).toBe(201)
  const id = expectId(body?.id, 'Building id')
  createdBuildings.set(id, test.info().testId)
  return id
}

export async function deleteBuildingIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
  options: { productIds?: ReadonlyArray<string | null | undefined> } = {},
): Promise<void> {
  if (!id) return
  if (token) {
    await apiRequest(request, 'DELETE', `/api/property_management/buildings?id=${encodeURIComponent(id)}`, { token }).catch(() => undefined)
  }
  try {
    await purgeBuildingsInDb([id], options)
    createdBuildings.delete(id)
  } catch (error) {
    console.warn(`[property_management] could not purge building ${id} from the database`, error)
  }
}

const createdBuildings = new Map<string, string>()

async function purgeBuildingsOfEarlierTests(): Promise<void> {
  const currentTestId = test.info().testId
  const abandoned = Array.from(createdBuildings.entries())
    .filter(([, testId]) => testId !== currentTestId)
    .map(([id]) => id)
  if (!abandoned.length) return
  try {
    await purgeBuildingsInDb(abandoned)
    for (const id of abandoned) createdBuildings.delete(id)
  } catch (error) {
    test.info().annotations.push({
      type: 'warning',
      description: `[property_management] could not purge buildings ${abandoned.join(', ')} left by earlier tests: ${error instanceof Error ? error.message : String(error)}`,
    })
  }
}

export async function listFloors(request: APIRequestContext, token: string, buildingId: string): Promise<FloorRow[]> {
  const response = await apiRequest(request, 'GET', `/api/property_management/floors?buildingId=${buildingId}&pageSize=100`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: FloorRow[] }>(response)
  return (body?.items ?? []).slice().sort((left, right) => left.number - right.number)
}

export async function listSpaces(request: APIRequestContext, token: string, floorId: string): Promise<SpaceRow[]> {
  const response = await apiRequest(request, 'GET', `/api/property_management/spaces?floorId=${floorId}&pageSize=100`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: SpaceRow[] }>(response)
  return body?.items ?? []
}

export async function updateSpace(request: APIRequestContext, token: string, data: Record<string, unknown>) {
  return apiRequest(request, 'PUT', '/api/property_management/spaces', { token, data })
}

export async function createSpace(request: APIRequestContext, token: string, data: Record<string, unknown>): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/property_management/spaces', { token, data })
  const body = await readJsonSafe<{ id?: string; error?: string }>(response)
  expect(response.status(), `POST spaces should return 201, got ${JSON.stringify(body)}`).toBe(201)
  return expectId(body?.id, 'Space id')
}

export async function createUnit(request: APIRequestContext, token: string, data: Record<string, unknown>) {
  return apiRequest(request, 'POST', '/api/property_management/units', { token, data })
}

export type UnitProductFixture = { categoryId: string; productId: string; secondProductId: string }

export async function createProductInCategory(
  request: APIRequestContext,
  token: string,
  input: { title: string; sku: string; categoryId: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/catalog/products', {
    token,
    data: {
      title: input.title,
      sku: input.sku,
      description: 'Long enough description for SEO checks in QA automation flows. This text keeps the create validation satisfied.',
      categoryIds: [input.categoryId],
    },
  })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.ok(), `POST catalog/products failed: ${response.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return expectId(body?.id, 'Product id')
}

export async function setProductUse(
  request: APIRequestContext,
  token: string,
  productId: string,
  use: 'leasable' | 'bookable' | null,
  billingUnit: 'month' | 'hour' | 'day' | null,
) {
  return apiRequest(request, 'POST', '/api/property_management/product-uses', {
    token,
    data: { catalogProductId: productId, use, billingUnit },
  })
}

export async function createUnitProducts(request: APIRequestContext, token: string, stamp: string): Promise<UnitProductFixture> {
  const categoryId = await createCategoryFixture(request, token, { name: `QA PM offices ${stamp}` })
  const created: string[] = []
  try {
    const productId = await createProductInCategory(request, token, { title: `QA PM office ${stamp}`, sku: `QA-PM-OFF-${stamp}`, categoryId })
    created.push(productId)
    const secondProductId = await createProductInCategory(request, token, { title: `QA PM big office ${stamp}`, sku: `QA-PM-BIG-${stamp}`, categoryId })
    created.push(secondProductId)
    for (const id of created) {
      const response = await setProductUse(request, token, id, 'leasable', 'month')
      expect(response.status(), 'POST product-uses should return 201').toBe(201)
    }
    return { categoryId, productId, secondProductId }
  } catch (error) {
    for (const id of created) {
      await setProductUse(request, token, id, null, null).catch(() => undefined)
      await deleteCatalogProductIfExists(request, token, id)
    }
    await deleteCatalogCategoryIfExists(request, token, categoryId)
    throw error
  }
}

export async function deleteUnitProducts(request: APIRequestContext, token: string | null, fixture: UnitProductFixture | null): Promise<void> {
  if (!token || !fixture) return
  for (const id of [fixture.productId, fixture.secondProductId]) {
    await setProductUse(request, token, id, null, null).catch(() => undefined)
  }
  await deleteCatalogProductIfExists(request, token, fixture.productId)
  await deleteCatalogProductIfExists(request, token, fixture.secondProductId)
  await deleteCatalogCategoryIfExists(request, token, fixture.categoryId)
}

export function stampOf(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}
