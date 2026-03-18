"use client"

import * as React from 'react'
import { JsonBuilder } from '@open-mercato/ui/backend/JsonBuilder'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { SwitchableMarkdownInput } from '@open-mercato/ui/backend/inputs/SwitchableMarkdownInput'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { normalizePaymentLinkDraft, readPaymentLinkDraft, type PaymentLinkDraft } from './payment-link-draft'

type ProviderItem = {
  providerKey: string
  supportsPaymentLinks: boolean
}

type TransactionFormData = Record<string, unknown>

function setDraftValue(
  data: TransactionFormData | undefined,
  onDataChange: InjectionWidgetComponentProps<unknown, TransactionFormData>['onDataChange'],
  updater: (current: PaymentLinkDraft | null) => PaymentLinkDraft | null,
) {
  if (!onDataChange) return
  const next = { ...(data ?? {}) }
  const updated = updater(readPaymentLinkDraft(next.paymentLink))
  if (updated) {
    next.paymentLink = updated
  } else {
    delete next.paymentLink
  }
  onDataChange(next)
}

export default function PaymentTransactionLinkWidget({
  data,
  onDataChange,
  disabled,
}: InjectionWidgetComponentProps<Record<string, unknown>, TransactionFormData>) {
  const t = useT()
  const [providers, setProviders] = React.useState<ProviderItem[]>([])

  React.useEffect(() => {
    let mounted = true

    void apiCall<{ items?: ProviderItem[] }>('/api/payment_gateways/providers', undefined, {
      fallback: { items: [] },
    }).then((call) => {
      if (!mounted) return
      setProviders(Array.isArray(call.result?.items) ? call.result.items : [])
    })

    return () => {
      mounted = false
    }
  }, [])

  const providerKey = typeof data?.providerKey === 'string' ? data.providerKey : ''
  const provider = providers.find((item) => item.providerKey === providerKey) ?? null
  const supportsPaymentLinks = provider?.supportsPaymentLinks === true
  const paymentLink = readPaymentLinkDraft(data?.paymentLink)
  const paymentLinkEnabled = supportsPaymentLinks && paymentLink?.enabled !== false
  const customerCaptureEnabled = paymentLinkEnabled && paymentLink?.customerCapture?.enabled === true
  const requireTerms = customerCaptureEnabled && paymentLink?.customerCapture?.termsRequired === true

  React.useEffect(() => {
    if (!supportsPaymentLinks) {
      if (data?.paymentLink) {
        setDraftValue(data, onDataChange, () => null)
      }
      return
    }

    if (!paymentLink) {
      setDraftValue(data, onDataChange, () => ({ enabled: true }))
    }
  }, [data, onDataChange, paymentLink, supportsPaymentLinks])

  if (!supportsPaymentLinks) return null

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-3 text-sm font-medium">
        <Checkbox
          checked={paymentLinkEnabled}
          disabled={disabled}
          onCheckedChange={(checked) => {
            const enabled = checked === true
            setDraftValue(data, onDataChange, (current) => (enabled ? { ...(current ?? {}), enabled: true } : null))
          }}
        />
        <span>{t('payment_gateways.create.paymentLinkToggle', 'Create payment link')}</span>
      </label>

      {paymentLinkEnabled ? (
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="paymentLinkTitle">
              {t('payment_gateways.create.paymentLinkTitle', 'Link title')}
              <span className="text-red-600"> *</span>
            </Label>
            <Input
              id="paymentLinkTitle"
              disabled={disabled}
              value={paymentLink?.title ?? ''}
              onChange={(event) => {
                const title = event.target.value
                setDraftValue(data, onDataChange, (current) => ({ ...(current ?? {}), enabled: true, title }))
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="paymentLinkDescription">
              {t('payment_gateways.create.paymentLinkDescription', 'Link description')}
            </Label>
            <Textarea
              id="paymentLinkDescription"
              disabled={disabled}
              value={paymentLink?.description ?? ''}
              onChange={(event) => {
                const description = event.target.value
                setDraftValue(data, onDataChange, (current) => ({ ...(current ?? {}), enabled: true, description }))
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="paymentLinkPassword">
              {t('payment_gateways.create.paymentLinkPassword', 'Password (optional)')}
            </Label>
            <Input
              id="paymentLinkPassword"
              type="password"
              disabled={disabled}
              value={paymentLink?.password ?? ''}
              onChange={(event) => {
                const password = event.target.value
                setDraftValue(data, onDataChange, (current) => ({ ...(current ?? {}), enabled: true, password }))
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="paymentLinkToken">
              {t('payment_gateways.create.paymentLinkCustomPath', 'Custom link path (optional)')}
            </Label>
            <Input
              id="paymentLinkToken"
              disabled={disabled}
              placeholder={t('payment_gateways.create.paymentLinkCustomPathPlaceholder', 'invoice-inv-10024')}
              value={paymentLink?.token ?? ''}
              onChange={(event) => {
                const token = event.target.value
                setDraftValue(data, onDataChange, (current) => ({ ...(current ?? {}), enabled: true, token }))
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('payment_gateways.create.paymentLinkMetadata', 'Page metadata (JSON)')}</Label>
            <JsonBuilder
              disabled={disabled}
              value={paymentLink?.metadata ?? {}}
              onChange={(metadata) => {
                setDraftValue(data, onDataChange, (current) => ({ ...(current ?? {}), enabled: true, metadata }))
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('payment_gateways.create.paymentLinkCustomFieldsGroup', 'Page metadata custom fields')}</Label>
            <JsonBuilder
              disabled={disabled}
              value={paymentLink?.customFields ?? {}}
              onChange={(customFields) => {
                setDraftValue(data, onDataChange, (current) => ({ ...(current ?? {}), enabled: true, customFields }))
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="paymentLinkCustomFieldsetCode">
              {t('payment_link_pages.templates.form.customFieldsetCode', 'Fieldset code')}
            </Label>
            <Input
              id="paymentLinkCustomFieldsetCode"
              disabled={disabled}
              value={paymentLink?.customFieldsetCode ?? ''}
              onChange={(event) => {
                const customFieldsetCode = event.target.value
                setDraftValue(data, onDataChange, (current) => ({ ...(current ?? {}), enabled: true, customFieldsetCode }))
              }}
            />
          </div>

          <div className="rounded-lg border border-border/60 bg-background/80 p-4">
            <label className="flex items-start gap-3 text-sm font-medium">
              <Checkbox
                checked={customerCaptureEnabled}
                disabled={disabled}
                onCheckedChange={(checked) => {
                  const enabled = checked === true
                  setDraftValue(data, onDataChange, (current) => ({
                    ...(current ?? {}),
                    enabled: true,
                    customerCapture: enabled
                      ? {
                          enabled: true,
                          companyRequired: current?.customerCapture?.companyRequired === true,
                          termsRequired: current?.customerCapture?.termsRequired === true,
                          termsMarkdown: current?.customerCapture?.termsMarkdown ?? '',
                        }
                      : undefined,
                  }))
                }}
              />
              <span className="space-y-1">
                <span className="block">
                  {t('payment_gateways.create.paymentLinkCollectCustomer', 'Collect customer details before checkout')}
                </span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {t(
                    'payment_gateways.create.paymentLinkCollectCustomerHelp',
                    'Show a checkout-style customer form on the pay link and create or reuse the matching customer records before payment starts.',
                  )}
                </span>
              </span>
            </label>

            {customerCaptureEnabled ? (
              <div className="mt-4 space-y-4">
                <label className="flex items-start gap-3 text-sm">
                  <Checkbox
                    checked={paymentLink?.customerCapture?.companyRequired === true}
                    disabled={disabled}
                    onCheckedChange={(checked) => {
                      const companyRequired = checked === true
                      setDraftValue(data, onDataChange, (current) => ({
                        ...(current ?? {}),
                        enabled: true,
                        customerCapture: {
                          ...(current?.customerCapture ?? {}),
                          enabled: true,
                          companyRequired,
                        },
                      }))
                    }}
                  />
                  <span className="space-y-1">
                    <span className="block font-medium">
                      {t('payment_gateways.create.paymentLinkRequireCompany', 'Require company name')}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t(
                        'payment_gateways.create.paymentLinkRequireCompanyHelp',
                        'Require a company and link the created person to that company.',
                      )}
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-3 text-sm">
                  <Checkbox
                    checked={paymentLink?.customerCapture?.termsRequired === true}
                    disabled={disabled}
                    onCheckedChange={(checked) => {
                      const termsRequired = checked === true
                      setDraftValue(data, onDataChange, (current) => ({
                        ...(current ?? {}),
                        enabled: true,
                        customerCapture: {
                          ...(current?.customerCapture ?? {}),
                          enabled: true,
                          termsRequired,
                          termsMarkdown: termsRequired ? (current?.customerCapture?.termsMarkdown ?? '') : '',
                        },
                      }))
                    }}
                  />
                  <span className="space-y-1">
                    <span className="block font-medium">
                      {t('payment_gateways.create.paymentLinkRequireTerms', 'Require terms / GDPR acceptance')}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t(
                        'payment_gateways.create.paymentLinkRequireTermsHelp',
                        'Render markdown terms content and require the customer to accept it before filling customer details.',
                      )}
                    </span>
                  </span>
                </label>

                {requireTerms ? (
                  <div className="space-y-2">
                    <Label htmlFor="paymentLinkTermsMarkdown">
                      {t('payment_gateways.create.paymentLinkTermsMarkdown', 'Terms content (Markdown)')}
                    </Label>
                    <SwitchableMarkdownInput
                      height={220}
                      isMarkdownEnabled
                      value={paymentLink?.customerCapture?.termsMarkdown ?? ''}
                      onChange={(termsMarkdown) => {
                        setDraftValue(data, onDataChange, (current) => ({
                          ...(current ?? {}),
                          enabled: true,
                          customerCapture: {
                            ...(current?.customerCapture ?? {}),
                            enabled: true,
                            termsRequired: true,
                            termsMarkdown,
                          },
                        }))
                      }}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
