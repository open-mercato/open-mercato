/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Asn, InventoryLot, PutawayTask, ReceivingLine, WarehouseLocation } from '../../data/entities'
import { resolveAsnReceiveAttempt } from '../asnReceiving'
import {
  resolveLocationByCode,
  resolveLotByNumber,
  resolveScanPutawayCommandInput,
  resolveScanReceiveCommandInput,
} from '../scanResolve'

const findOneWithDecryptionMock = jest.mocked(findOneWithDecryption)

const scoped = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}

describe('scanResolve helpers', () => {
  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
  })

  it('resolves location by warehouse + code', async () => {
    findOneWithDecryptionMock.mockResolvedValue({
      id: 'loc-1',
      code: 'STG-A',
      type: 'staging',
    } as WarehouseLocation)

    await expect(
      resolveLocationByCode({} as never, {
        ...scoped,
        warehouseId: '33333333-3333-4333-8333-333333333333',
        code: 'STG-A',
      }),
    ).resolves.toEqual({
      locationId: 'loc-1',
      code: 'STG-A',
      type: 'staging',
    })
    // Helper trusts the scope the route passes; routes must override body organizationId
    // from auth/session (see api/scan/resolve-location|resolve-lot).
    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(
      expect.anything(),
      WarehouseLocation,
      expect.objectContaining({
        organizationId: scoped.organizationId,
        tenantId: scoped.tenantId,
      }),
      undefined,
      scoped,
    )
  })

  it('returns 404 when location code is unknown', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    await expect(
      resolveLocationByCode({} as never, {
        ...scoped,
        warehouseId: '33333333-3333-4333-8333-333333333333',
        code: 'MISSING',
      }),
    ).rejects.toMatchObject({ status: 404, body: { error: 'not_found' } })
  })

  it('resolves lot by variant + lot number', async () => {
    findOneWithDecryptionMock.mockResolvedValue({
      id: 'lot-1',
      lotNumber: 'LOT-9',
      expiresAt: new Date('2026-12-01T00:00:00.000Z'),
    } as InventoryLot)

    await expect(
      resolveLotByNumber({} as never, {
        ...scoped,
        catalogVariantId: '44444444-4444-4444-8444-444444444444',
        lotNumber: 'LOT-9',
      }),
    ).resolves.toEqual({
      lotId: 'lot-1',
      lotNumber: 'LOT-9',
      expiresAt: '2026-12-01T00:00:00.000Z',
    })
  })

  it('maps scan receive input onto ASN receive command shape', async () => {
    findOneWithDecryptionMock.mockImplementation(async (_em, entity) => {
      if (entity === Asn) {
        return {
          id: '55555555-5555-4555-8555-555555555555',
          warehouse: { id: '33333333-3333-4333-8333-333333333333' },
        } as Asn
      }
      if (entity === WarehouseLocation) {
        return {
          id: '66666666-6666-4666-8666-666666666666',
          code: 'STG-A',
          type: 'staging',
        } as WarehouseLocation
      }
      return null
    })

    const result = await resolveScanReceiveCommandInput({} as never, {
      ...scoped,
      asnId: '55555555-5555-4555-8555-555555555555',
      lineId: '77777777-7777-4777-8777-777777777777',
      locationCode: 'STG-A',
      lotNumber: 'LOT-9',
      receivedQty: 3,
      targetReceivedQty: 3,
      qcStatus: 'passed',
      performedBy: '88888888-8888-4888-8888-888888888888',
    })

    expect(result).toMatchObject({
      asnId: '55555555-5555-4555-8555-555555555555',
      lineId: '77777777-7777-4777-8777-777777777777',
      targetStagingLocationId: '66666666-6666-4666-8666-666666666666',
      lotNumber: 'LOT-9',
      receivedQty: 3,
      targetReceivedQty: 3,
      qcStatus: 'passed',
      organizationId: scoped.organizationId,
      tenantId: scoped.tenantId,
    })
    // Helper trusts the scope the route passes; scan/receive must override body
    // organizationId from auth/session (same as resolve-location|resolve-lot).
    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(
      expect.anything(),
      Asn,
      expect.objectContaining({
        organizationId: scoped.organizationId,
        tenantId: scoped.tenantId,
      }),
      undefined,
      scoped,
    )
  })

  it('scopes ASN/location lookup to the organizationId the caller supplies', async () => {
    const otherOrg = '33333333-3333-4333-8333-333333333333'
    findOneWithDecryptionMock.mockResolvedValue(null)
    await expect(
      resolveScanReceiveCommandInput({} as never, {
        tenantId: scoped.tenantId,
        organizationId: otherOrg,
        asnId: '55555555-5555-4555-8555-555555555555',
        lineId: '77777777-7777-4777-8777-777777777777',
        locationCode: 'STG-A',
        receivedQty: 1,
        targetReceivedQty: 1,
        qcStatus: 'passed',
        performedBy: '88888888-8888-4888-8888-888888888888',
      }),
    ).rejects.toMatchObject({ status: 404 })
    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(
      expect.anything(),
      Asn,
      expect.objectContaining({ organizationId: otherOrg, tenantId: scoped.tenantId }),
      undefined,
      { organizationId: otherOrg, tenantId: scoped.tenantId },
    )
  })

  it('passes absolute target through so identical scan retry yields applyQty=0', async () => {
    findOneWithDecryptionMock.mockImplementation(async (_em, entity) => {
      if (entity === Asn) {
        return {
          id: '55555555-5555-4555-8555-555555555555',
          warehouse: { id: '33333333-3333-4333-8333-333333333333' },
        } as Asn
      }
      if (entity === WarehouseLocation) {
        return {
          id: '66666666-6666-4666-8666-666666666666',
          code: 'STG-A',
          type: 'staging',
        } as WarehouseLocation
      }
      return null
    })

    const scanInput = {
      ...scoped,
      asnId: '55555555-5555-4555-8555-555555555555',
      lineId: '77777777-7777-4777-8777-777777777777',
      locationCode: 'STG-A',
      receivedQty: 3,
      targetReceivedQty: 5,
      qcStatus: 'passed' as const,
      performedBy: '88888888-8888-4888-8888-888888888888',
    }

    const firstResolved = await resolveScanReceiveCommandInput({} as never, scanInput)
    expect(firstResolved.targetReceivedQty).toBe(5)
    // Scan resolve must not load ReceivingLine or recompute prior+delta.
    expect(findOneWithDecryptionMock.mock.calls.some((call) => call[1] === ReceivingLine)).toBe(
      false,
    )

    const firstAttempt = resolveAsnReceiveAttempt({
      lineId: firstResolved.lineId,
      priorReceivedQty: 2,
      receivedQty: firstResolved.receivedQty,
      targetReceivedQty: firstResolved.targetReceivedQty,
    })
    expect(firstAttempt.applyQty).toBe(3)

    // Identical retry after success: same absolute target, prior already at target.
    const retryResolved = await resolveScanReceiveCommandInput({} as never, scanInput)
    expect(retryResolved.targetReceivedQty).toBe(5)
    const retryAttempt = resolveAsnReceiveAttempt({
      lineId: retryResolved.lineId,
      priorReceivedQty: 5,
      receivedQty: retryResolved.receivedQty,
      targetReceivedQty: retryResolved.targetReceivedQty,
    })
    expect(retryAttempt.applyQty).toBe(0)
    expect(retryAttempt.attemptKey).toBe(firstAttempt.attemptKey)
  })

  it('maps scan putaway input onto complete-putaway command shape', async () => {
    findOneWithDecryptionMock.mockImplementation(async (_em, entity) => {
      if (entity === PutawayTask) {
        return {
          id: '99999999-9999-4999-8999-999999999999',
          warehouse: { id: '33333333-3333-4333-8333-333333333333' },
        } as PutawayTask
      }
      if (entity === WarehouseLocation) {
        return {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          code: 'BIN-1',
          type: 'bin',
        } as WarehouseLocation
      }
      return null
    })

    const result = await resolveScanPutawayCommandInput({} as never, {
      ...scoped,
      taskId: '99999999-9999-4999-8999-999999999999',
      targetLocationCode: 'BIN-1',
      confirmedQuantity: 2,
      performedBy: '88888888-8888-4888-8888-888888888888',
    })

    expect(result).toMatchObject({
      id: '99999999-9999-4999-8999-999999999999',
      targetLocationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      confirmedQuantity: 2,
      organizationId: scoped.organizationId,
      tenantId: scoped.tenantId,
    })
    // Helper trusts the scope the route passes; scan/putaway must override body
    // organizationId from auth/session (same as scan/receive and resolve-location/lot).
    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(
      expect.anything(),
      PutawayTask,
      expect.objectContaining({
        organizationId: scoped.organizationId,
        tenantId: scoped.tenantId,
      }),
      undefined,
      scoped,
    )
  })

  it('scopes putaway task/location lookup to the organizationId the caller supplies', async () => {
    const otherOrg = '33333333-3333-4333-8333-333333333333'
    findOneWithDecryptionMock.mockResolvedValue(null)
    await expect(
      resolveScanPutawayCommandInput({} as never, {
        tenantId: scoped.tenantId,
        organizationId: otherOrg,
        taskId: '99999999-9999-4999-8999-999999999999',
        targetLocationCode: 'BIN-1',
        confirmedQuantity: 1,
        performedBy: '88888888-8888-4888-8888-888888888888',
      }),
    ).rejects.toMatchObject({ status: 404 })
    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(
      expect.anything(),
      PutawayTask,
      expect.objectContaining({ organizationId: otherOrg, tenantId: scoped.tenantId }),
      undefined,
      { organizationId: otherOrg, tenantId: scoped.tenantId },
    )
  })

  it('throws CrudHttpError when ASN is missing for scan receive', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    await expect(
      resolveScanReceiveCommandInput({} as never, {
        ...scoped,
        asnId: '55555555-5555-4555-8555-555555555555',
        lineId: '77777777-7777-4777-8777-777777777777',
        locationCode: 'STG-A',
        receivedQty: 1,
        targetReceivedQty: 1,
        qcStatus: 'passed',
        performedBy: '88888888-8888-4888-8888-888888888888',
      }),
    ).rejects.toBeInstanceOf(CrudHttpError)
  })
})
