import type { WarrantyClaim, WarrantyClaimLine } from '../data/entities'
import { tryResolve } from '../lib/tryResolve'

export type WarrantyReturnLabelResult =
  | { status: 'created'; labelUrl: string; trackingNumber: string; carrier: string }
  | { status: 'notConfigured' }

export interface WarrantyReturnLabelProvider {
  createReturnLabel(
    input: { claim: WarrantyClaim; lines: WarrantyClaimLine[] },
    scope: { tenantId: string; organizationId: string },
    container: { resolve: <R = unknown>(n: string) => R },
  ): Promise<WarrantyReturnLabelResult>
}

/**
 * Default core provider. Enterprise or carrier packages override the
 * `warrantyReturnLabelProvider` DI key with concrete label generation.
 */
export function createWarrantyReturnLabelProvider(): WarrantyReturnLabelProvider {
  return {
    async createReturnLabel(_input, _scope, container) {
      const shippingCarrierService = tryResolve<unknown>(container, 'shippingCarrierService')
      if (!shippingCarrierService) return { status: 'notConfigured' }

      // Carrier packages can transition awaiting_return -> received via the existing transition command on delivery scan.
      return { status: 'notConfigured' }
    },
  }
}
