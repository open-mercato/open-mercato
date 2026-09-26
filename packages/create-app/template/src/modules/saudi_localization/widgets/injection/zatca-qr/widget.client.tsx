'use client'

/**
 * The ZATCA QR panel on a sales order.
 *
 * Renders what the invoice must carry and, when it cannot, says why — the status
 * comes straight from the `saudi_localization.zatca-invoice-qr` enricher, so the
 * panel, the API and a print pipeline share one source of truth instead of three
 * guesses.
 *
 * The QR is drawn from the payload with `qrcode` and the payload is shown as text
 * underneath, so an operator checking a code against ZATCA's verifier has the
 * exact string in front of them.
 */

import * as React from 'react'
import QRCode from 'qrcode'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { formatDualCalendarDate } from '../../../lib/saudi/hijri'

export type ZatcaQrStatus = 'ready' | 'qr_disabled' | 'settings_incomplete' | 'missing_invoice_data'

export type ZatcaInvoiceRecord = Record<string, unknown> & {
  id?: string
  grandTotalGrossAmount?: unknown
  taxTotalAmount?: unknown
  placedAt?: unknown
  createdAt?: unknown
  _saudi_localization?: {
    zatcaQrPayload?: string | null
    zatcaQrStatus?: ZatcaQrStatus
  }
}

const SETTINGS_PATH = '/backend/saudi/vat-settings'
const QR_SIZE = 160

function toAmountLabel(value: unknown): string | null {
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  return null
}

export default function ZatcaQrWidget({ data }: InjectionWidgetComponentProps<unknown, ZatcaInvoiceRecord>) {
  const t = useT()
  const enrichment = data?._saudi_localization
  const payload = typeof enrichment?.zatcaQrPayload === 'string' ? enrichment.zatcaQrPayload : null
  const status = enrichment?.zatcaQrStatus ?? null
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null)
  const [qrRenderFailed, setQrRenderFailed] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    if (!payload) {
      setQrDataUrl(null)
      setQrRenderFailed(false)
      return () => {
        cancelled = true
      }
    }
    QRCode.toDataURL(payload, { margin: 1, width: QR_SIZE, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setQrRenderFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [payload])

  // No enrichment means the enricher did not run for this caller (the view feature
  // is missing) — rendering nothing is the polite answer, not a warning.
  if (!status) return null

  const placedAt = data?.placedAt ?? data?.createdAt ?? null
  const dualCalendarDate = status === 'ready' ? formatDualCalendarDate(placedAt) : null
  const totalLabel = toAmountLabel(data?.grandTotalGrossAmount)
  const settingsAction = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        window.location.href = SETTINGS_PATH
      }}
    >
      {t('saudi_localization.widgets.zatca_qr.open_settings', 'Open VAT settings')}
    </Button>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('saudi_localization.widgets.zatca_qr.title', 'ZATCA invoice QR')}</CardTitle>
        <CardDescription>
          {t(
            'saudi_localization.widgets.zatca_qr.description',
            'The code a simplified tax invoice must carry, generated from the seller VAT settings.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {status === 'ready' ? (
          <div className="flex flex-wrap items-start gap-4">
            {qrRenderFailed ? (
              <Alert variant="warning">
                <AlertTitle>
                  {t('saudi_localization.widgets.zatca_qr.render_failed.title', 'The code could not be drawn')}
                </AlertTitle>
                <AlertDescription>
                  {t(
                    'saudi_localization.widgets.zatca_qr.render_failed.body',
                    'The payload below is still the exact value ZATCA expects, and any QR generator can encode it.',
                  )}
                </AlertDescription>
              </Alert>
            ) : qrDataUrl ? (
              <img
                src={qrDataUrl}
                width={QR_SIZE}
                height={QR_SIZE}
                alt={t('saudi_localization.widgets.zatca_qr.image_alt', 'ZATCA e-invoice QR code')}
                className="rounded border border-border bg-background p-1"
              />
            ) : (
              <Spinner size="sm" />
            )}
            <div className="grid gap-1 text-sm">
              {dualCalendarDate ? <p className="text-muted-foreground">{dualCalendarDate}</p> : null}
              {totalLabel ? (
                <p className="text-muted-foreground">
                  {t('saudi_localization.widgets.zatca_qr.total', 'Total including VAT')}: {totalLabel}
                </p>
              ) : null}
              <code className="max-w-md break-all rounded bg-muted px-2 py-1 text-xs">{payload}</code>
            </div>
          </div>
        ) : null}

        {status === 'settings_incomplete' ? (
          <Alert variant="warning">
            <AlertTitle>
              {t('saudi_localization.widgets.zatca_qr.settings_incomplete.title', 'VAT settings are incomplete')}
            </AlertTitle>
            <AlertDescription className="grid gap-2">
              <span>
                {t(
                  'saudi_localization.widgets.zatca_qr.settings_incomplete.body',
                  'The seller name and VAT registration number are required before an invoice can carry a ZATCA QR code.',
                )}
              </span>
              {settingsAction}
            </AlertDescription>
          </Alert>
        ) : null}

        {status === 'qr_disabled' ? (
          <Alert>
            <AlertTitle>{t('saudi_localization.widgets.zatca_qr.disabled.title', 'The ZATCA QR code is turned off')}</AlertTitle>
            <AlertDescription className="grid gap-2">
              <span>
                {t(
                  'saudi_localization.widgets.zatca_qr.disabled.body',
                  'Invoices are issued without a QR code. Turn it on unless the entity is not VAT-registered.',
                )}
              </span>
              {settingsAction}
            </AlertDescription>
          </Alert>
        ) : null}

        {status === 'missing_invoice_data' ? (
          <Alert variant="warning">
            <AlertTitle>
              {t('saudi_localization.widgets.zatca_qr.missing_data.title', 'This order cannot be encoded yet')}
            </AlertTitle>
            <AlertDescription>
              {t(
                'saudi_localization.widgets.zatca_qr.missing_data.body',
                'The QR code needs the order total, its VAT total and the issue timestamp.',
              )}
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}
