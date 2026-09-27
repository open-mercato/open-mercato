'use client'

/**
 * The ZATCA invoice preview, on the sales order it belongs to.
 *
 * This is the manual-reporting workflow made concrete: an operator can see the exact
 * XML, hash and QR code a Saudi tax invoice will carry, copy the document and file it
 * in the Fatoora portal — without anything being issued, counters being consumed or
 * files being written. The endpoint behind it peeks the chain for exactly this reason.
 *
 * Nothing renders until the operator asks: the document is a few kilobytes of XML, and
 * most visits to an order are not about compliance.
 */

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import type { ZatcaInvoiceRecord } from '../zatca-qr/widget.client'

type PreviewStatus = 'ready' | 'settings_incomplete' | 'qr_disabled' | 'missing_invoice_data'

type PreviewResponse = {
  status?: PreviewStatus
  invoiceNumber?: string
  icv?: number
  previousInvoiceHash?: string
  invoiceHash?: string
  qrPayload?: string
  xml?: string
  error?: string
}

type PreviewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; result: PreviewResponse }
  | { kind: 'failed'; message: string }

const ENDPOINT = '/api/saudi_localization/zatca/invoice-preview'

function downloadXml(fileName: string, xml: string): void {
  const blob = new Blob([xml], { type: 'application/xml' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function ZatcaInvoicePreviewWidget({ data }: InjectionWidgetComponentProps<unknown, ZatcaInvoiceRecord>) {
  const t = useT()
  const orderId = typeof data?.id === 'string' ? data.id : null
  const [state, setState] = React.useState<PreviewState>({ kind: 'idle' })

  const load = React.useCallback(async () => {
    if (!orderId) return
    setState({ kind: 'loading' })
    const response = await apiCall<PreviewResponse>(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId }),
    })
    if (!response.ok || !response.result) {
      setState({
        kind: 'failed',
        message: response.result?.error ?? t('saudi_localization.widgets.invoice_preview.error', 'Unable to build the invoice preview.'),
      })
      return
    }
    setState({ kind: 'loaded', result: response.result })
  }, [orderId, t])

  const copyXml = React.useCallback(async (xml: string) => {
    try {
      await navigator.clipboard.writeText(xml)
      flash(t('saudi_localization.widgets.invoice_preview.copied', 'Invoice XML copied.'), 'success')
    } catch {
      flash(t('saudi_localization.widgets.invoice_preview.copy_failed', 'Copying is not available in this browser.'), 'error')
    }
  }, [t])

  if (!orderId) return null

  const result = state.kind === 'loaded' ? state.result : null
  const xml = typeof result?.xml === 'string' ? result.xml : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('saudi_localization.widgets.invoice_preview.title', 'ZATCA invoice preview')}</CardTitle>
        <CardDescription>
          {t(
            'saudi_localization.widgets.invoice_preview.description',
            'The tax invoice this order would produce, with nothing issued: the counter is read, not claimed.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={load} disabled={state.kind === 'loading'}>
            {state.kind === 'loading'
              ? t('saudi_localization.widgets.invoice_preview.loading', 'Building…')
              : t('saudi_localization.widgets.invoice_preview.action', 'Preview invoice')}
          </Button>
          {state.kind === 'loading' ? <Spinner size="sm" /> : null}
          {xml ? (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => void copyXml(xml)}>
                {t('saudi_localization.widgets.invoice_preview.copy', 'Copy XML')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  downloadXml(
                    `${result?.invoiceNumber ?? orderId}.xml`,
                    xml,
                  )
                }
              >
                {t('saudi_localization.widgets.invoice_preview.download', 'Download XML')}
              </Button>
            </>
          ) : null}
        </div>

        {state.kind === 'failed' ? (
          <Alert variant="warning">
            <AlertTitle>{t('saudi_localization.widgets.invoice_preview.failed.title', 'The preview could not be built')}</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}

        {result?.status === 'ready' && xml ? (
          <div className="grid gap-2 text-sm">
            <p className="text-muted-foreground">
              {t('saudi_localization.widgets.invoice_preview.icv', 'Invoice counter value')}: {result.icv}
            </p>
            <p className="break-all text-muted-foreground">
              {t('saudi_localization.widgets.invoice_preview.previous_hash', 'Previous invoice hash')}:{' '}
              <code className="text-xs">{result.previousInvoiceHash}</code>
            </p>
            <p className="break-all text-muted-foreground">
              {t('saudi_localization.widgets.invoice_preview.invoice_hash', 'Invoice hash')}:{' '}
              <code className="text-xs">{result.invoiceHash}</code>
            </p>
            <details>
              <summary className="cursor-pointer">
                {t('saudi_localization.widgets.invoice_preview.xml_heading', 'UBL 2.1 invoice XML')}
              </summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded border border-border bg-muted p-2 text-xs">
                {xml}
              </pre>
            </details>
          </div>
        ) : null}

        {result?.status === 'settings_incomplete' ? (
          <Alert variant="warning">
            <AlertTitle>
              {t('saudi_localization.widgets.invoice_preview.settings_incomplete.title', 'VAT settings are incomplete')}
            </AlertTitle>
            <AlertDescription>
              {t(
                'saudi_localization.widgets.invoice_preview.settings_incomplete.body',
                'The seller name and VAT registration number are required before an invoice can be built.',
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        {result?.status === 'qr_disabled' ? (
          <Alert>
            <AlertTitle>{t('saudi_localization.widgets.invoice_preview.qr_disabled.title', 'The ZATCA QR code is turned off')}</AlertTitle>
            <AlertDescription>
              {t(
                'saudi_localization.widgets.invoice_preview.qr_disabled.body',
                'A simplified invoice is not built while the QR code is disabled. Standard invoices carry no QR and can still be previewed.',
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        {result?.status === 'missing_invoice_data' ? (
          <Alert variant="warning">
            <AlertTitle>
              {t('saudi_localization.widgets.invoice_preview.missing_data.title', 'This order cannot be invoiced yet')}
            </AlertTitle>
            <AlertDescription>
              {t(
                'saudi_localization.widgets.invoice_preview.missing_data.body',
                'The invoice needs the order totals and its issue timestamp.',
              )}
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}
