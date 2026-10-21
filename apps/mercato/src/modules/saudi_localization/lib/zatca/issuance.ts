import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { SaudiEinvoiceSubmission } from '../../data/entities'
import { isSaudiVatSettingsComplete, readSaudiVatSettings } from '../vat-settings'
import { allocateNextInvoiceChain, commitInvoiceChain } from './chain'
import { createModuleConfigZatcaInvoiceChainStore } from './chain-store'
import { buildZatcaOrderInvoice } from './order-invoice'
import { loadZatcaOrderSource } from './sales-order-source'

/**
 * The persistent issuance flow.
 *
 * Preview peeks the chain; issuance claims a counter, builds the document,
 * persists the exact bytes, and only then advances the hash pointer. The order
 * is deliberate: a crash after the claim leaves a gap in the ICV sequence, which
 * ZATCA tolerates, while committing the pointer before the row exists would make
 * the next invoice point at an invoice that was never stored.
 *
 * Nothing here signs or transmits. `status` stays `pending` and the route says
 * so; live clearance needs a CSID and a sandbox-validated client.
 */

export type SaudiIssuanceScope = { tenantId: string; organizationId: string }

export type IssueSaudiInvoiceInput = {
  em: EntityManager
  configService: ModuleConfigService
  scope: SaudiIssuanceScope
  orderId: string
  subtype?: 'standard' | 'simplified'
  actorUserId?: string | null
}

export type SaudiIssuanceResult = {
  submission: SaudiEinvoiceSubmission
  reused: boolean
}

export class SaudiIssuanceError extends Error {
  constructor(
    readonly code: 'settings_incomplete' | 'qr_disabled' | 'order_not_found' | 'missing_invoice_data',
    message: string,
  ) {
    super(message)
    this.name = 'SaudiIssuanceError'
  }
}

export async function issueSaudiInvoice(input: IssueSaudiInvoiceInput): Promise<SaudiIssuanceResult> {
  const { em, configService, scope, orderId } = input

  const existing = await em.findOne(SaudiEinvoiceSubmission, {
    orderId,
    ...scope,
    deletedAt: null,
    status: { $ne: 'rejected' },
  })
  if (existing) return { submission: existing, reused: true }

  const settings = await readSaudiVatSettings(configService, scope)
  if (!isSaudiVatSettingsComplete(settings)) {
    throw new SaudiIssuanceError('settings_incomplete', 'The seller VAT settings are incomplete.')
  }
  const subtype = input.subtype ?? 'simplified'
  if (subtype === 'simplified' && !settings.invoiceQrEnabled) {
    throw new SaudiIssuanceError('qr_disabled', 'A simplified invoice requires the QR code, which is disabled.')
  }

  const order = await loadZatcaOrderSource({ em, orderId, scope })
  if (!order) throw new SaudiIssuanceError('order_not_found', 'Sales order not found.')
  if (order.lines.length === 0) {
    throw new SaudiIssuanceError('missing_invoice_data', 'The order has no invoiceable lines.')
  }

  const store = createModuleConfigZatcaInvoiceChainStore(configService)
  const reservation = await allocateNextInvoiceChain({ store, scope })
  const invoice = buildZatcaOrderInvoice({
    order,
    settings,
    icv: reservation.icv,
    previousInvoiceHash: reservation.previousInvoiceHash,
    uuid: orderId,
    subtype,
  })

  const now = new Date()
  const submission = em.create(SaudiEinvoiceSubmission, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    orderId,
    invoiceNumber: invoice.input.invoiceNumber,
    invoiceUuid: orderId,
    icv: reservation.icv,
    invoiceHash: invoice.document.invoiceHash,
    previousInvoiceHash: reservation.previousInvoiceHash,
    qrPayload: invoice.qrPayload,
    xml: invoice.xml,
    status: 'pending',
    createdBy: input.actorUserId ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
  await em.persist(submission).flush()
  await commitInvoiceChain({
    store,
    scope,
    icv: reservation.icv,
    invoiceHash: invoice.document.invoiceHash,
  })
  return { submission, reused: false }
}
