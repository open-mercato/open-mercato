import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createOrganizationFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  deleteGeneralEntityIfExists,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCrudFixture, ensureRoleFeatures, toNumber } from './helpers/wmsFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog', 'auth', 'directory'],
}

const WMS_ADMIN_FEATURES = [
  'wms.view',
  'wms.manage_warehouses',
  'wms.manage_locations',
  'wms.manage_inventory',
  'wms.manage_asn',
  'wms.manage_putaway',
  'wms.receive_inventory',
  'wms.adjust_inventory',
]

type LabelResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
}

type AsnCreateResponse = {
  id?: string
  lineIds?: string[]
}

type ReceivingLineListResponse = {
  items?: Array<{
    id?: string
    received_qty?: string | number | null
  }>
}

type BalanceListResponse = {
  items?: Array<{
    quantity_on_hand?: string | number | null
    serial_number?: string | null
  }>
}

type PutawayTaskListResponse = {
  items?: Array<{
    id?: string
    status?: string | null
  }>
}

const LABEL_FIELDS = ['id', 'is_active', 'name', 'sku']

async function createWarehouseFixture(
  request: APIRequestContext,
  token: string,
  scope: { organizationId: string; tenantId: string },
  suffix: string,
  capacityUnits: number,
) {
  const warehouseId = await createCrudFixture(request, token, '/api/wms/warehouses', {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    name: `WMS-P2 Race WH ${suffix}`,
    code: `P2R${suffix}`,
    city: 'Lodz',
    country: 'PL',
    timezone: 'Europe/Warsaw',
    isActive: true,
  })
  const stagingId = await createCrudFixture(request, token, '/api/wms/locations', {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    warehouseId,
    code: `STG-${suffix}`,
    type: 'staging',
    capacityUnits: 500,
    isActive: true,
  })
  const binId = await createCrudFixture(request, token, '/api/wms/locations', {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    warehouseId,
    code: `BIN-${suffix}`,
    type: 'bin',
    capacityUnits,
    isActive: true,
  })
  return { warehouseId, stagingId, binId }
}

async function createAsnLine(
  request: APIRequestContext,
  token: string,
  input: {
    scope: { organizationId: string; tenantId: string }
    warehouseId: string
    variantId: string
    suffix: string
    expectedQty: number
  },
) {
  const response = await apiRequest(request, 'POST', '/api/wms/asns', {
    token,
    data: {
      organizationId: input.scope.organizationId,
      tenantId: input.scope.tenantId,
      warehouseId: input.warehouseId,
      expectedAt: new Date().toISOString(),
      referenceNumber: `ASN-${input.suffix}-${randomUUID().slice(0, 8)}`,
      lines: [{ catalogVariantId: input.variantId, expectedQty: input.expectedQty }],
    },
  })
  const raw = await response.text()
  expect(response.ok(), `Failed create ASN: ${response.status()} ${raw}`).toBeTruthy()
  const created = raw ? (JSON.parse(raw) as AsnCreateResponse) : null
  const asnId = created?.id ?? null
  const lineId = created?.lineIds?.[0] ?? null
  expect(asnId).toBeTruthy()
  expect(lineId).toBeTruthy()
  return { asnId: asnId as string, lineId: lineId as string }
}

test.describe('WMS-P2-INT-10 / label projection, serial identity, destination capacity', () => {
  test('returns only variant labels under wms.view and keeps catalog prices forbidden', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)
    const password = 'QaWmsLabels123!'
    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      superadminToken,
      scope.tenantId,
      'admin',
      WMS_ADMIN_FEATURES,
    )

    let productId: string | null = null
    let foreignOrganizationId: string | null = null
    let viewRoleId: string | null = null
    let foreignRoleId: string | null = null
    let deniedRoleId: string | null = null
    let viewUserId: string | null = null
    let deniedUserId: string | null = null
    let foreignUserId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `WMS-P2 Labels ${suffix}`,
        sku: `P2LBL-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `WMS-P2 Label Variant ${suffix}`,
        sku: `P2LBLV-${suffix}`,
      })

      viewRoleId = await createRoleFixture(request, superadminToken, {
        name: `wms-labels-view-${suffix}`,
        tenantId: scope.tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: viewRoleId,
        features: ['wms.view'],
        organizations: [scope.organizationId],
      })
      const viewEmail = `wms-labels-view-${suffix}@example.com`
      viewUserId = await createUserFixture(request, superadminToken, {
        email: viewEmail,
        password,
        organizationId: scope.organizationId,
        roles: [viewRoleId],
      })
      const viewToken = await getAuthToken(request, viewEmail, password)

      deniedRoleId = await createRoleFixture(request, superadminToken, {
        name: `wms-labels-denied-${suffix}`,
        tenantId: scope.tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: deniedRoleId,
        features: [],
        organizations: [scope.organizationId],
      })
      const deniedEmail = `wms-labels-denied-${suffix}@example.com`
      deniedUserId = await createUserFixture(request, superadminToken, {
        email: deniedEmail,
        password,
        organizationId: scope.organizationId,
        roles: [deniedRoleId],
      })
      const deniedToken = await getAuthToken(request, deniedEmail, password)

      foreignOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `WMS-P2 Foreign ${suffix}`,
        tenantId: scope.tenantId,
      })
      foreignRoleId = await createRoleFixture(request, superadminToken, {
        name: `wms-labels-foreign-${suffix}`,
        tenantId: scope.tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: foreignRoleId,
        features: ['wms.view'],
        organizations: [foreignOrganizationId],
      })
      const foreignEmail = `wms-labels-foreign-${suffix}@example.com`
      foreignUserId = await createUserFixture(request, superadminToken, {
        email: foreignEmail,
        password,
        organizationId: foreignOrganizationId,
        roles: [foreignRoleId],
      })
      const foreignToken = await getAuthToken(request, foreignEmail, password)

      const labels = await apiRequest(
        request,
        'GET',
        `/api/wms/catalog-variant-labels?id=${encodeURIComponent(variantId)}&organizationId=${encodeURIComponent(foreignOrganizationId)}&tenantId=${encodeURIComponent(randomUUID())}`,
        { token: viewToken },
      )
      const labelText = await labels.text()
      expect(labels.status(), labelText).toBe(200)
      const labelBody = labelText ? (JSON.parse(labelText) as LabelResponse) : null
      expect(labelBody?.items).toHaveLength(1)
      const item = labelBody?.items?.[0] ?? {}
      expect(Object.keys(item).sort()).toEqual(LABEL_FIELDS)
      expect(item.id).toBe(variantId)
      expect(item.sku).toBe(`P2LBLV-${suffix}`)
      expect(item).not.toHaveProperty('barcode')
      expect(item).not.toHaveProperty('price')

      const prices = await apiRequest(request, 'GET', '/api/catalog/prices?page=1&pageSize=20', {
        token: viewToken,
      })
      expect(prices.status()).toBe(403)

      const denied = await apiRequest(
        request,
        'GET',
        `/api/wms/catalog-variant-labels?id=${encodeURIComponent(variantId)}`,
        { token: deniedToken },
      )
      expect(denied.status()).toBe(403)

      const foreign = await apiRequest(
        request,
        'GET',
        `/api/wms/catalog-variant-labels?id=${encodeURIComponent(variantId)}`,
        { token: foreignToken },
      )
      const foreignText = await foreign.text()
      expect(foreign.status(), foreignText).toBe(200)
      const foreignBody = foreignText ? (JSON.parse(foreignText) as LabelResponse) : null
      expect(foreignBody?.items ?? []).toEqual([])
      expect(foreignBody?.total ?? 0).toBe(0)
    } finally {
      await deleteUserIfExists(request, superadminToken, foreignUserId)
      await deleteUserIfExists(request, superadminToken, deniedUserId)
      await deleteUserIfExists(request, superadminToken, viewUserId)
      await deleteRoleIfExists(request, superadminToken, deniedRoleId)
      await deleteRoleIfExists(request, superadminToken, foreignRoleId)
      await deleteRoleIfExists(request, superadminToken, viewRoleId)
      await deleteOrganizationIfExists(request, superadminToken, foreignOrganizationId)
      if (productId) await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })

  test('lets only one of two ASN receipts keep the same active serial', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)
    const serial = `SN-${suffix}`
    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      superadminToken,
      scope.tenantId,
      'admin',
      WMS_ADMIN_FEATURES,
    )

    let productId: string | null = null
    let warehouseId: string | null = null
    let stagingId: string | null = null
    let binId: string | null = null
    let profileId: string | null = null
    const asnIds: string[] = []

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `WMS-P2 Serial ${suffix}`,
        sku: `P2SER-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `WMS-P2 Serial Variant ${suffix}`,
        sku: `P2SERV-${suffix}`,
      })
      const warehouse = await createWarehouseFixture(request, adminToken, scope, suffix, 500)
      warehouseId = warehouse.warehouseId
      stagingId = warehouse.stagingId
      binId = warehouse.binId
      profileId = await createCrudFixture(request, adminToken, '/api/wms/inventory-profiles', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogProductId: productId,
        catalogVariantId: variantId,
        defaultUom: 'pcs',
        defaultStrategy: 'fifo',
      })
      const first = await createAsnLine(request, adminToken, {
        scope,
        warehouseId,
        variantId,
        suffix: `${suffix}-a`,
        expectedQty: 1,
      })
      const second = await createAsnLine(request, adminToken, {
        scope,
        warehouseId,
        variantId,
        suffix: `${suffix}-b`,
        expectedQty: 1,
      })
      asnIds.push(first.asnId, second.asnId)

      const receiveBody = (lineId: string) => ({
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        lineId,
        receivedQty: 1,
        targetReceivedQty: 1,
        targetStagingLocationId: stagingId,
        qcStatus: 'passed',
        serialNumbers: [serial],
        performedBy: scope.userId,
      })
      const [left, right] = await Promise.all([
        apiRequest(request, 'POST', `/api/wms/asns/${first.asnId}/receive`, {
          token: adminToken,
          data: receiveBody(first.lineId),
        }),
        apiRequest(request, 'POST', `/api/wms/asns/${second.asnId}/receive`, {
          token: adminToken,
          data: receiveBody(second.lineId),
        }),
      ])
      const outcomes = [left, right].sort((a, b) => a.status() - b.status())
      expect(outcomes[0]?.status(), await outcomes[0]!.text()).toBe(200)
      expect(outcomes[1]?.status()).toBe(422)
      expect(await readJsonSafe<{ error?: string }>(outcomes[1]!)).toEqual({ error: 'duplicate_serial' })

      const received: number[] = []
      for (const lineId of [first.lineId, second.lineId]) {
        const lineResponse = await apiRequest(
          request,
          'GET',
          `/api/wms/receiving-lines?ids=${encodeURIComponent(lineId)}&page=1&pageSize=1`,
          { token: adminToken },
        )
        expect(lineResponse.ok()).toBeTruthy()
        const lineBody = await readJsonSafe<ReceivingLineListResponse>(lineResponse)
        received.push(toNumber(lineBody?.items?.[0]?.received_qty))
      }
      expect(received.sort()).toEqual([0, 1])

      const balances = await apiRequest(
        request,
        'GET',
        `/api/wms/inventory/balances?page=1&pageSize=20&warehouseId=${encodeURIComponent(warehouseId)}&catalogVariantId=${encodeURIComponent(variantId)}&serialNumber=${encodeURIComponent(serial)}`,
        { token: adminToken },
      )
      expect(balances.ok()).toBeTruthy()
      const balanceBody = await readJsonSafe<BalanceListResponse>(balances)
      const onHand = (balanceBody?.items ?? []).reduce(
        (sum, row) => sum + toNumber(row.quantity_on_hand),
        0,
      )
      expect(onHand).toBe(1)
    } finally {
      for (const asnId of asnIds) {
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/asns', asnId)
      }
      if (profileId) {
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      }
      if (binId) await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', binId)
      if (stagingId) await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', stagingId)
      if (warehouseId) {
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      }
      if (productId) await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })

  test('refuses the second putaway when the destination has one unit left', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)
    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      superadminToken,
      scope.tenantId,
      'admin',
      WMS_ADMIN_FEATURES,
    )

    let productId: string | null = null
    let warehouseId: string | null = null
    let stagingId: string | null = null
    let binId: string | null = null
    let profileId: string | null = null
    const asnIds: string[] = []

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `WMS-P2 Capacity ${suffix}`,
        sku: `P2CAP-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `WMS-P2 Capacity Variant ${suffix}`,
        sku: `P2CAPV-${suffix}`,
      })
      const warehouse = await createWarehouseFixture(request, adminToken, scope, suffix, 1)
      warehouseId = warehouse.warehouseId
      stagingId = warehouse.stagingId
      binId = warehouse.binId
      profileId = await createCrudFixture(request, adminToken, '/api/wms/inventory-profiles', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogProductId: productId,
        catalogVariantId: variantId,
        defaultUom: 'pcs',
        defaultStrategy: 'fifo',
      })

      const tasks: string[] = []
      for (const marker of ['a', 'b']) {
        const asn = await createAsnLine(request, adminToken, {
          scope,
          warehouseId,
          variantId,
          suffix: `${suffix}-${marker}`,
          expectedQty: 1,
        })
        asnIds.push(asn.asnId)
        const received = await apiRequest(request, 'POST', `/api/wms/asns/${asn.asnId}/receive`, {
          token: adminToken,
          data: {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            lineId: asn.lineId,
            receivedQty: 1,
            targetReceivedQty: 1,
            targetStagingLocationId: stagingId,
            qcStatus: 'passed',
            performedBy: scope.userId,
          },
        })
        const receivedText = await received.text()
        expect(received.ok(), receivedText).toBeTruthy()
        const body = receivedText
          ? (JSON.parse(receivedText) as { putawayTaskIds?: string[] })
          : null
        const taskId = body?.putawayTaskIds?.[0]
        expect(taskId).toBeTruthy()
        tasks.push(taskId as string)
      }

      const completeBody = {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        confirmedQuantity: 1,
        targetLocationId: binId,
        performedBy: scope.userId,
      }
      const [left, right] = await Promise.all([
        apiRequest(request, 'POST', `/api/wms/putaway-tasks/${tasks[0]}/complete`, {
          token: adminToken,
          data: completeBody,
        }),
        apiRequest(request, 'POST', `/api/wms/putaway-tasks/${tasks[1]}/complete`, {
          token: adminToken,
          data: completeBody,
        }),
      ])
      const outcomes = [left, right].sort((a, b) => a.status() - b.status())
      expect(outcomes[0]?.status(), await outcomes[0]!.text()).toBe(200)
      expect(outcomes[1]?.status()).toBe(422)
      expect(await readJsonSafe<{ error?: string }>(outcomes[1]!)).toEqual({
        error: 'location_capacity_exceeded',
      })

      const balances = await apiRequest(
        request,
        'GET',
        `/api/wms/inventory/balances?page=1&pageSize=20&warehouseId=${encodeURIComponent(warehouseId)}&locationId=${encodeURIComponent(binId!)}&catalogVariantId=${encodeURIComponent(variantId)}`,
        { token: adminToken },
      )
      expect(balances.ok()).toBeTruthy()
      const balanceBody = await readJsonSafe<BalanceListResponse>(balances)
      const onHand = (balanceBody?.items ?? []).reduce(
        (sum, row) => sum + toNumber(row.quantity_on_hand),
        0,
      )
      expect(onHand).toBe(1)

      const taskList = await apiRequest(
        request,
        'GET',
        `/api/wms/putaway-tasks?ids=${encodeURIComponent(tasks.join(','))}&page=1&pageSize=10`,
        { token: adminToken },
      )
      expect(taskList.ok()).toBeTruthy()
      const taskBody = await readJsonSafe<PutawayTaskListResponse>(taskList)
      const statuses = (taskBody?.items ?? []).map((row) => row.status).sort()
      expect(statuses).toEqual(['done', 'open'])
    } finally {
      for (const asnId of asnIds) {
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/asns', asnId)
      }
      if (profileId) {
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      }
      if (binId) await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', binId)
      if (stagingId) await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', stagingId)
      if (warehouseId) {
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      }
      if (productId) await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })
})
