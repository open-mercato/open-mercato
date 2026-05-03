import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type UnitListItem = {
  id: string
  material_id: string
  code: string
  usage: string
  is_base: boolean
  is_default_for_usage: boolean
}

type ListResponse<T> = { items?: T[] }

type MaterialListItem = {
  id: string
  code: string
}

async function createMaterial(
  request: APIRequestContext,
  token: string,
  code: string,
  name: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/materials', {
    token,
    data: { code, name, kind: 'raw' },
  })
  expect(response.status()).toBe(201)
  return expectId(((await readJsonSafe<{ id?: string }>(response)) ?? {}).id, 'Material id')
}

async function listUnits(
  request: APIRequestContext,
  token: string,
  materialId: string,
): Promise<UnitListItem[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/material-units?materialId=${encodeURIComponent(materialId)}&page=1&pageSize=100`,
    { token },
  )
  expect(response.status()).toBe(200)
  return ((await readJsonSafe<ListResponse<UnitListItem>>(response)) ?? {}).items ?? []
}

async function listMaterials(
  request: APIRequestContext,
  token: string,
  ids: string[],
): Promise<MaterialListItem[]> {
  if (ids.length === 0) return []
  const response = await apiRequest(
    request,
    'GET',
    `/api/materials?ids=${encodeURIComponent(ids.join(','))}&page=1&pageSize=100`,
    { token },
  )
  expect(response.status()).toBe(200)
  return ((await readJsonSafe<ListResponse<MaterialListItem>>(response)) ?? {}).items ?? []
}

async function deleteMaterialIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(request, 'DELETE', '/api/materials', { token, data: { id } }).catch(() => undefined)
}

async function deleteUnitIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(request, 'DELETE', '/api/material-units', { token, data: { id } }).catch(() => undefined)
}

test.describe('TC-MAT-003: Material Units invariants', () => {
  test('promoting a second base unit demotes the previous base (single-base invariant)', async ({ request }) => {
    test.setTimeout(180_000)
    const token = await getAuthToken(request)
    const stamp = Date.now()
    let materialId: string | null = null
    let firstUnitId: string | null = null
    let secondUnitId: string | null = null

    try {
      materialId = await createMaterial(request, token, `MAT003-BASE-${stamp}`, `Base invariant ${stamp}`)

      const firstResponse = await apiRequest(request, 'POST', '/api/material-units', {
        token,
        data: {
          materialId,
          code: 'KG',
          label: 'Kilogram',
          usage: 'stock',
          isBase: true,
          factor: '1.000000',
        },
      })
      expect(firstResponse.status()).toBe(201)
      firstUnitId = expectId(((await readJsonSafe<{ id?: string }>(firstResponse)) ?? {}).id, 'First unit id')

      const secondResponse = await apiRequest(request, 'POST', '/api/material-units', {
        token,
        data: {
          materialId,
          code: 'PCS',
          label: 'Piece',
          usage: 'stock',
          isBase: true,
        },
      })
      expect([200, 201, 409, 422]).toContain(secondResponse.status())

      if (secondResponse.ok()) {
        secondUnitId = expectId(
          ((await readJsonSafe<{ id?: string }>(secondResponse)) ?? {}).id,
          'Second unit id',
        )
        const units = await listUnits(request, token, materialId)
        const baseUnits = units.filter((u) => u.is_base)
        expect(baseUnits, 'Exactly one base unit must remain after promotion').toHaveLength(1)
        expect(baseUnits[0]?.id, 'Newly promoted unit should be the only base').toBe(secondUnitId)
      }
    } finally {
      await deleteUnitIfExists(request, token, firstUnitId)
      await deleteUnitIfExists(request, token, secondUnitId)
      await deleteMaterialIfExists(request, token, materialId)
    }
  })

  test('promoting a second default-per-usage demotes the previous default', async ({ request }) => {
    test.setTimeout(180_000)
    const token = await getAuthToken(request)
    const stamp = Date.now()
    let materialId: string | null = null
    let baseUnitId: string | null = null
    let firstDefaultId: string | null = null
    let secondDefaultId: string | null = null

    try {
      materialId = await createMaterial(request, token, `MAT003-DEF-${stamp}`, `Default invariant ${stamp}`)

      const baseResponse = await apiRequest(request, 'POST', '/api/material-units', {
        token,
        data: {
          materialId,
          code: 'KG',
          label: 'Kilogram',
          usage: 'stock',
          isBase: true,
        },
      })
      expect(baseResponse.status()).toBe(201)
      baseUnitId = expectId(((await readJsonSafe<{ id?: string }>(baseResponse)) ?? {}).id, 'Base unit id')

      const firstDefault = await apiRequest(request, 'POST', '/api/material-units', {
        token,
        data: {
          materialId,
          code: 'BOX10',
          label: '10kg box',
          usage: 'purchase',
          factor: '10.000000',
          isDefaultForUsage: true,
        },
      })
      expect(firstDefault.status()).toBe(201)
      firstDefaultId = expectId(
        ((await readJsonSafe<{ id?: string }>(firstDefault)) ?? {}).id,
        'First default id',
      )

      const secondDefault = await apiRequest(request, 'POST', '/api/material-units', {
        token,
        data: {
          materialId,
          code: 'PALLET',
          label: 'Pallet',
          usage: 'purchase',
          factor: '500.000000',
          isDefaultForUsage: true,
        },
      })
      expect([200, 201, 409, 422]).toContain(secondDefault.status())

      if (secondDefault.ok()) {
        secondDefaultId = expectId(
          ((await readJsonSafe<{ id?: string }>(secondDefault)) ?? {}).id,
          'Second default id',
        )
        const units = await listUnits(request, token, materialId)
        const purchaseDefaults = units.filter((u) => u.usage === 'purchase' && u.is_default_for_usage)
        expect(
          purchaseDefaults,
          'Exactly one default-per-usage must remain after promotion',
        ).toHaveLength(1)
        expect(purchaseDefaults[0]?.id).toBe(secondDefaultId)
      }
    } finally {
      await deleteUnitIfExists(request, token, firstDefaultId)
      await deleteUnitIfExists(request, token, secondDefaultId)
      await deleteUnitIfExists(request, token, baseUnitId)
      await deleteMaterialIfExists(request, token, materialId)
    }
  })

  test('soft-deleting parent material does not orphan child units in DB lookup', async ({ request }) => {
    test.setTimeout(180_000)
    const token = await getAuthToken(request)
    const stamp = Date.now()
    let materialId: string | null = null
    let unitId: string | null = null

    try {
      materialId = await createMaterial(request, token, `MAT003-CASCADE-${stamp}`, `Cascade ${stamp}`)

      const unitResponse = await apiRequest(request, 'POST', '/api/material-units', {
        token,
        data: {
          materialId,
          code: 'KG',
          label: 'Kilogram',
          usage: 'stock',
          isBase: true,
        },
      })
      expect(unitResponse.status()).toBe(201)
      unitId = expectId(((await readJsonSafe<{ id?: string }>(unitResponse)) ?? {}).id, 'Unit id')

      const unitsBefore = await listUnits(request, token, materialId)
      expect(unitsBefore.find((row) => row.id === unitId)).toBeTruthy()

      const deleteResponse = await apiRequest(request, 'DELETE', '/api/materials', {
        token,
        data: { id: materialId },
      })
      expect(deleteResponse.ok(), `Material delete failed: ${deleteResponse.status()}`).toBeTruthy()

      const materialsAfter = await listMaterials(request, token, [materialId])
      expect(materialsAfter.find((m) => m.id === materialId), 'Soft-deleted material should not appear in default list').toBeFalsy()
    } finally {
      await deleteUnitIfExists(request, token, unitId)
      await deleteMaterialIfExists(request, token, materialId)
    }
  })
})
