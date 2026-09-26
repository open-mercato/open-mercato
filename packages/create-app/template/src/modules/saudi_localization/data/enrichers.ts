import type { EnricherContext, ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { formatSaudDecimal } from '../lib/saudi/vat'
import { ZatcaQrError, buildZatcaQrPayload } from '../lib/zatca/qr'
import { isSaudiVatSettingsComplete, readSaudiVatSettings, type SaudiVatSettings } from '../lib/vat-settings'

/**
 * Puts the ZATCA QR payload on sales order responses.
 *
 * The platform's sales order API already opts into the `sales:sales_order`
 * enricher surface, so the invoice QR travels to whoever needs it — a print view,
 * a PDF pipeline, an integration — without this module reaching into the sales
 * module's internals or the sales module knowing this one exists.
 *
 * The payload is computed, never stored, and the status says *why* it is absent
 * when it is: an operator who reads `settings_incomplete` knows to open the VAT
 * settings screen, while `missing_invoice_data` points at the order itself. That
 * distinction is the difference between a support ticket and a fix.
 *
 * `cacheableOnListHit` stays off: the payload depends on the tenant's settings and
 * on each record's own totals, so a cached list must re-run it.
 */

export type ZatcaQrStatus = 'ready' | 'qr_disabled' | 'settings_incomplete' | 'missing_invoice_data'

export type ZatcaQrEnrichment = {
  _saudi_localization: {
    zatcaQrPayload: string | null
    zatcaQrStatus: ZatcaQrStatus
  }
}

type SalesDocumentRecord = Record<string, unknown> & { id: string }

const NOT_READY: ZatcaQrEnrichment = {
  _saudi_localization: { zatcaQrPayload: null, zatcaQrStatus: 'settings_incomplete' },
}

async function resolveSettings(context: EnricherContext): Promise<SaudiVatSettings | null> {
  try {
    const container = context.container as AppContainer
    const configService = container.resolve('moduleConfigService') as ModuleConfigService
    return await readSaudiVatSettings(configService, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    })
  } catch {
    // A missing container or an unreachable store means we cannot know the seller
    // identity, which is exactly `settings_incomplete` — never a silent QR.
    return null
  }
}

function toIsoTimestamp(record: SalesDocumentRecord): string | null {
  const candidate = record.placedAt ?? record.createdAt
  if (candidate instanceof Date) return candidate.toISOString()
  if (typeof candidate === 'string') {
    const parsed = new Date(candidate)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

function toAmount(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  try {
    return formatSaudDecimal(value)
  } catch {
    return null
  }
}

function buildEnrichment(record: SalesDocumentRecord, settings: SaudiVatSettings | null): ZatcaQrEnrichment {
  if (!settings) return { ...NOT_READY }
  if (!settings.invoiceQrEnabled) {
    return { _saudi_localization: { zatcaQrPayload: null, zatcaQrStatus: 'qr_disabled' } }
  }
  if (!isSaudiVatSettingsComplete(settings)) return { ...NOT_READY }

  const issuedAt = toIsoTimestamp(record)
  const invoiceTotalWithVat = toAmount(record.grandTotalGrossAmount)
  const vatTotal = toAmount(record.taxTotalAmount)
  if (!issuedAt || !invoiceTotalWithVat || !vatTotal) {
    return { _saudi_localization: { zatcaQrPayload: null, zatcaQrStatus: 'missing_invoice_data' } }
  }

  try {
    return {
      _saudi_localization: {
        zatcaQrPayload: buildZatcaQrPayload({
          sellerName: settings.sellerName,
          vatRegistrationNumber: settings.vatRegistrationNumber,
          issuedAt,
          invoiceTotalWithVat,
          vatTotal,
        }),
        zatcaQrStatus: 'ready',
      },
    }
  } catch (error) {
    const status: ZatcaQrStatus =
      error instanceof ZatcaQrError && (error.code === 'invalid_vat_number' || error.code === 'invalid_seller_name')
        ? 'settings_incomplete'
        : 'missing_invoice_data'
    return { _saudi_localization: { zatcaQrPayload: null, zatcaQrStatus: status } }
  }
}

const zatcaInvoiceQrEnricher: ResponseEnricher<SalesDocumentRecord, ZatcaQrEnrichment> = {
  id: 'saudi_localization.zatca-invoice-qr',
  targetEntity: 'sales:sales_order',
  features: ['saudi_localization.settings.view'],
  priority: 20,
  timeout: 2000,
  fallback: { ...NOT_READY },
  cacheableOnListHit: false,

  async enrichOne(record, context) {
    return { ...record, ...buildEnrichment(record, await resolveSettings(context)) }
  },

  async enrichMany(records, context) {
    // One settings read for the whole batch: the seller identity is the same for
    // every row, so a per-record read would be pure N+1.
    const settings = await resolveSettings(context)
    return records.map((record) => ({ ...record, ...buildEnrichment(record, settings) }))
  },
}

export const enrichers: ResponseEnricher[] = [zatcaInvoiceQrEnricher]
