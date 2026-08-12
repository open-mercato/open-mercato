import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['eudr', 'customers'],
}

const PLOTS_PATH = '/api/eudr/plots'
const PLOTS_IMPORT_PATH = '/api/eudr/plots/import'
const CUSTOMERS_COMPANIES_PATH = '/api/customers/companies'

type PlotRow = {
  id: string
  name?: string | null
  supplierEntityId?: string | null
  commodity?: string | null
  originCountry?: string | null
  plotType?: string | null
  areaHa?: string | number | null
  geometry?: unknown
  validationWarnings?: string[]
  updatedAt?: string | null
}

type PlotListResponse = {
  items?: PlotRow[]
}

type ImportResponse = {
  created?: number
  failed?: Array<{ index?: number; errorKey?: string; message?: string }>
  ids?: string[]
  createdIds?: string[]
}

type GeoJsonGeometry = {
  type: 'Point' | 'Polygon'
  coordinates: unknown
}

function polygonGeometry(): GeoJsonGeometry {
  return {
    type: 'Polygon',
    coordinates: [[
      [-3.9921644, 5.1189651],
      [-3.9831442, 5.1189651],
      [-3.9831442, 5.1279483],
      [-3.9921644, 5.1279483],
      [-3.9921644, 5.1189651],
    ]],
  }
}

function lowPrecisionPolygonGeometry(): GeoJsonGeometry {
  return {
    type: 'Polygon',
    coordinates: [[
      [-3.9921, 5.1189],
      [-3.9831, 5.1189],
      [-3.9831, 5.1279],
      [-3.9921, 5.1279],
      [-3.9921, 5.1189],
    ]],
  }
}

function pointGeometry(): GeoJsonGeometry {
  return { type: 'Point', coordinates: [-3.9876543, 5.1234567] }
}

function unclosedPolygonGeometry(): GeoJsonGeometry {
  return {
    type: 'Polygon',
    coordinates: [[
      [-3.9921644, 5.1189651],
      [-3.9831442, 5.1189651],
      [-3.9831442, 5.1279483],
      [-3.9921644, 5.1279483],
    ]],
  }
}

function invalidLatitudePolygonGeometry(): GeoJsonGeometry {
  return {
    type: 'Polygon',
    coordinates: [[
      [-3.9921644, 95],
      [-3.9831442, 95],
      [-3.9831442, 95.01],
      [-3.9921644, 95.01],
      [-3.9921644, 95],
    ]],
  }
}

function approximatePolygonAreaHa(geometry: GeoJsonGeometry): number {
  if (geometry.type !== 'Polygon' || !Array.isArray(geometry.coordinates)) return 0
  const ring = geometry.coordinates[0]
  if (!Array.isArray(ring)) return 0
  const points = ring
    .filter((value): value is [number, number] => (
      Array.isArray(value)
      && typeof value[0] === 'number'
      && typeof value[1] === 'number'
    ))
  if (points.length < 4) return 0
  const averageLat = points.reduce((sum, point) => sum + point[1], 0) / points.length
  const metersPerLatDegree = 111_320
  const metersPerLonDegree = metersPerLatDegree * Math.cos((averageLat * Math.PI) / 180)
  let areaMeters = 0
  for (let index = 0; index < points.length - 1; index += 1) {
    const [lonA, latA] = points[index]
    const [lonB, latB] = points[index + 1]
    const xA = lonA * metersPerLonDegree
    const yA = latA * metersPerLatDegree
    const xB = lonB * metersPerLonDegree
    const yB = latB * metersPerLatDegree
    areaMeters += xA * yB - xB * yA
  }
  return Math.abs(areaMeters) / 2 / 10_000
}

function plotCreatePayload(
  supplierEntityId: string,
  stamp: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: `TC-EUDR-005 Plot ${stamp}`,
    supplierEntityId,
    commodity: 'cocoa',
    originCountry: 'CI',
    plotType: 'polygon',
    geometry: polygonGeometry(),
    ...overrides,
  }
}

async function readPlotByIds(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<PlotRow | null> {
  const response = await apiRequest(request, 'GET', `${PLOTS_PATH}?ids=${encodeURIComponent(id)}`, { token })
  expect(response.status(), `GET plot by ids should return 200: ${response.status()}`).toBe(200)
  const body = await readJsonSafe<PlotListResponse>(response)
  return body?.items?.find((item) => item.id === id) ?? null
}

async function listPlotsBySupplier(
  request: APIRequestContext,
  token: string,
  supplierEntityId: string,
): Promise<PlotRow[]> {
  const response = await apiRequest(
    request,
    'GET',
    `${PLOTS_PATH}?supplierEntityId=${encodeURIComponent(supplierEntityId)}`,
    { token },
  )
  expect(response.status(), `GET plots by supplier should return 200: ${response.status()}`).toBe(200)
  const body = await readJsonSafe<PlotListResponse>(response)
  return body?.items ?? []
}

async function deletePlotIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(request, 'DELETE', `${PLOTS_PATH}?id=${encodeURIComponent(id)}`, { token }).catch(() => undefined)
}

function expectErrorKey(body: unknown, errorKey: string): void {
  expect(JSON.stringify(body), `error response should contain ${errorKey}`).toContain(errorKey)
}

/**
 * TC-EUDR-005: Plot registry API coverage.
 */
test.describe('TC-EUDR-005: Plots API', () => {
  test('enforces auth/RBAC, validates geometry, imports GeoJSON, and soft-deletes plots', async ({ request }) => {
    const stamp = `${Date.now()}-${randomUUID()}`
    const createdPlotIds = new Set<string>()
    let supplierId: string | null = null

    const unauthenticatedGet = await request.get(PLOTS_PATH)
    expect(unauthenticatedGet.status(), 'GET without auth should return 401').toBe(401)

    const unauthenticatedPost = await request.post(PLOTS_PATH, {
      data: plotCreatePayload(randomUUID(), stamp),
    })
    expect(unauthenticatedPost.status(), 'POST without auth should return 401').toBe(401)

    const adminToken = await getAuthToken(request, 'admin')

    try {
      supplierId = await createCompanyFixture(request, adminToken, `TC-EUDR-005 Supplier ${stamp}`)

      const polygon = polygonGeometry()
      const createPolygonResponse = await apiRequest(request, 'POST', PLOTS_PATH, {
        token: adminToken,
        data: plotCreatePayload(supplierId, stamp, { geometry: polygon }),
      })
      expect(createPolygonResponse.status(), `create polygon plot failed: ${createPolygonResponse.status()}`).toBe(201)
      const createdPolygon = await readJsonSafe<{ id?: string }>(createPolygonResponse)
      const polygonId = expectId(createdPolygon?.id, 'Polygon plot create response should include id')
      createdPlotIds.add(polygonId)

      const polygonReadback = await readPlotByIds(request, adminToken, polygonId)
      expect(polygonReadback?.plotType).toBe('polygon')
      expect(Number(polygonReadback?.areaHa)).toBeGreaterThan(0)
      const expectedAreaHa = approximatePolygonAreaHa(polygon)
      expect(Number(polygonReadback?.areaHa)).toBeGreaterThanOrEqual(expectedAreaHa * 0.95)
      expect(Number(polygonReadback?.areaHa)).toBeLessThanOrEqual(expectedAreaHa * 1.05)
      expect(polygonReadback?.validationWarnings).toEqual([])
      expect(polygonReadback?.geometry).toEqual(polygon)

      const bareListItems = await listPlotsBySupplier(request, adminToken, supplierId)
      const barePolygon = bareListItems.find((item) => item.id === polygonId)
      expect(barePolygon, 'bare supplier list should include created polygon').toBeTruthy()
      expect(Object.prototype.hasOwnProperty.call(barePolygon ?? {}, 'geometry'), 'bare list item should omit geometry').toBe(false)

      const pointWithoutAreaResponse = await apiRequest(request, 'POST', PLOTS_PATH, {
        token: adminToken,
        data: plotCreatePayload(supplierId, stamp, {
          name: `TC-EUDR-005 Point no area ${stamp}`,
          plotType: 'point',
          geometry: pointGeometry(),
        }),
      })
      expect(pointWithoutAreaResponse.status(), 'point plot without areaHa should return 400').toBe(400)
      expectErrorKey(await readJsonSafe(pointWithoutAreaResponse), 'pointAreaRequired')

      const pointTooLargeResponse = await apiRequest(request, 'POST', PLOTS_PATH, {
        token: adminToken,
        data: plotCreatePayload(supplierId, stamp, {
          name: `TC-EUDR-005 Point too large ${stamp}`,
          plotType: 'point',
          geometry: pointGeometry(),
          areaHa: 5,
        }),
      })
      expect(pointTooLargeResponse.status(), 'point plot over area threshold should return 400').toBe(400)
      expectErrorKey(await readJsonSafe(pointTooLargeResponse), 'polygonRequired')

      const validPointResponse = await apiRequest(request, 'POST', PLOTS_PATH, {
        token: adminToken,
        data: plotCreatePayload(supplierId, stamp, {
          name: `TC-EUDR-005 Point valid ${stamp}`,
          plotType: 'point',
          geometry: pointGeometry(),
          areaHa: 2,
        }),
      })
      expect(validPointResponse.status(), `create point plot failed: ${validPointResponse.status()}`).toBe(201)
      const validPoint = await readJsonSafe<{ id?: string }>(validPointResponse)
      createdPlotIds.add(expectId(validPoint?.id, 'Point plot create response should include id'))

      const lowPrecisionResponse = await apiRequest(request, 'POST', PLOTS_PATH, {
        token: adminToken,
        data: plotCreatePayload(supplierId, stamp, {
          name: `TC-EUDR-005 Low precision ${stamp}`,
          geometry: lowPrecisionPolygonGeometry(),
        }),
      })
      expect(lowPrecisionResponse.status(), `create low precision plot failed: ${lowPrecisionResponse.status()}`).toBe(201)
      const lowPrecision = await readJsonSafe<{ id?: string }>(lowPrecisionResponse)
      const lowPrecisionId = expectId(lowPrecision?.id, 'Low precision plot create response should include id')
      createdPlotIds.add(lowPrecisionId)
      const lowPrecisionReadback = await readPlotByIds(request, adminToken, lowPrecisionId)
      expect(lowPrecisionReadback?.validationWarnings).toContain('low_precision')

      const unclosedResponse = await apiRequest(request, 'POST', PLOTS_PATH, {
        token: adminToken,
        data: plotCreatePayload(supplierId, stamp, {
          name: `TC-EUDR-005 Unclosed ${stamp}`,
          geometry: unclosedPolygonGeometry(),
        }),
      })
      expect(unclosedResponse.status(), 'unclosed polygon ring should return 400').toBe(400)

      const invalidLatitudeResponse = await apiRequest(request, 'POST', PLOTS_PATH, {
        token: adminToken,
        data: plotCreatePayload(supplierId, stamp, {
          name: `TC-EUDR-005 Invalid lat ${stamp}`,
          geometry: invalidLatitudePolygonGeometry(),
        }),
      })
      expect(invalidLatitudeResponse.status(), 'latitude outside valid range should return 400').toBe(400)

      const invalidCountryResponse = await apiRequest(request, 'POST', PLOTS_PATH, {
        token: adminToken,
        data: plotCreatePayload(supplierId, stamp, {
          name: `TC-EUDR-005 Invalid country ${stamp}`,
          originCountry: 'XXX',
        }),
      })
      expect(invalidCountryResponse.status(), 'unknown origin country should return 400').toBe(400)

      const importResponse = await apiRequest(request, 'POST', PLOTS_IMPORT_PATH, {
        token: adminToken,
        data: {
          supplierEntityId: supplierId,
          commodity: 'cocoa',
          defaultCountry: 'CI',
          featureCollection: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { name: `TC-EUDR-005 Import polygon ${stamp}` },
                geometry: polygonGeometry(),
              },
              {
                type: 'Feature',
                properties: { name: `TC-EUDR-005 Import point ${stamp}`, Area: 4 },
                geometry: pointGeometry(),
              },
              {
                type: 'Feature',
                properties: { name: `TC-EUDR-005 Import broken ${stamp}` },
                geometry: unclosedPolygonGeometry(),
              },
            ],
          },
        },
      })
      expect(importResponse.status(), `plot import failed: ${importResponse.status()}`).toBe(200)
      const importBody = await readJsonSafe<ImportResponse>(importResponse)
      expect(importBody?.created).toBe(2)
      expect(importBody?.failed?.[0]?.index).toBe(2)
      for (const id of [...(importBody?.ids ?? []), ...(importBody?.createdIds ?? [])]) {
        createdPlotIds.add(id)
      }

      const importedSupplierPlots = await listPlotsBySupplier(request, adminToken, supplierId)
      const importedByName = importedSupplierPlots.filter((item) => item.name?.startsWith(`TC-EUDR-005 Import `))
      expect(importedByName).toHaveLength(2)
      for (const item of importedByName) createdPlotIds.add(item.id)

      const employeeToken = await getAuthToken(request, 'employee')
      const employeeGetResponse = await apiRequest(request, 'GET', PLOTS_PATH, { token: employeeToken })
      expect(employeeGetResponse.status(), 'employee should be allowed to view plots').toBe(200)
      const employeePostResponse = await apiRequest(request, 'POST', PLOTS_PATH, {
        token: employeeToken,
        data: plotCreatePayload(supplierId, stamp, { name: `TC-EUDR-005 Employee create ${stamp}` }),
      })
      expect(employeePostResponse.status(), 'employee should not be allowed to create plots').toBe(403)

      const updateResponse = await apiRequest(request, 'PUT', PLOTS_PATH, {
        token: adminToken,
        data: { id: polygonId, name: `TC-EUDR-005 Updated ${stamp}` },
      })
      expect(updateResponse.status(), `update plot failed: ${updateResponse.status()}`).toBe(200)
      const updatedReadback = await readPlotByIds(request, adminToken, polygonId)
      expect(updatedReadback?.name).toBe(`TC-EUDR-005 Updated ${stamp}`)

      const deleteResponse = await apiRequest(request, 'DELETE', `${PLOTS_PATH}?id=${encodeURIComponent(polygonId)}`, {
        token: adminToken,
      })
      expect(deleteResponse.status(), `delete plot failed: ${deleteResponse.status()}`).toBe(200)
      createdPlotIds.delete(polygonId)
      const afterDelete = await readPlotByIds(request, adminToken, polygonId)
      expect(afterDelete, 'soft-deleted plot should disappear from id readback').toBeNull()
    } finally {
      for (const id of Array.from(createdPlotIds).reverse()) {
        await deletePlotIfExists(request, adminToken, id)
      }
      await deleteEntityIfExists(request, adminToken, CUSTOMERS_COMPANIES_PATH, supplierId)
    }
  })
})
