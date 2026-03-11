"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useInjectionDataWidgets } from '@open-mercato/ui/backend/injection/useInjectionDataWidgets'
import { InjectedField } from '@open-mercato/ui/backend/injection/InjectedField'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ProviderItem = {
  id: string
  title: string
  description?: string | null
  providerKey: string
  supportsPaymentLinks: boolean
  transactionCreateFieldSpotId?: string | null
}

type CreateSessionResult = {
  transactionId: string
  paymentLinkUrl?: string | null
}

type CreatePaymentTransactionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (transactionId: string) => Promise<void> | void
}

function formatProviderLabel(provider: ProviderItem): string {
  return provider.title || provider.providerKey
}

export function CreatePaymentTransactionDialog({
  open,
  onOpenChange,
  onCreated,
}: CreatePaymentTransactionDialogProps) {
  const t = useT()
  const { runMutation } = useGuardedMutation<{ dialog: string }>({
    contextId: 'payment_gateways.create-transaction',
  })
  const [providers, setProviders] = React.useState<ProviderItem[]>([])
  const [loadingProviders, setLoadingProviders] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [values, setValues] = React.useState<Record<string, unknown>>({
    providerKey: '',
    amount: 0,
    currencyCode: 'USD',
    description: '',
    createPaymentLink: true,
    paymentLinkTitle: '',
    paymentLinkDescription: '',
    paymentLinkPassword: '',
  })

  React.useEffect(() => {
    if (!open) return
    let mounted = true
    const loadProviders = async () => {
      setLoadingProviders(true)
      const call = await apiCall<{ items?: ProviderItem[] }>('/api/payment_gateways/providers', undefined, {
        fallback: { items: [] },
      })
      if (mounted) {
        const nextProviders = Array.isArray(call.result?.items) ? call.result.items : []
        setProviders(nextProviders)
        setValues((current) => {
          const currentProviderKey = typeof current.providerKey === 'string' ? current.providerKey : ''
          return {
            ...current,
            providerKey: currentProviderKey || nextProviders[0]?.providerKey || '',
          }
        })
        setLoadingProviders(false)
      }
    }
    void loadProviders()
    return () => {
      mounted = false
    }
  }, [open])

  const selectedProvider = React.useMemo(
    () => providers.find((provider) => provider.providerKey === values.providerKey) ?? null,
    [providers, values.providerKey],
  )

  const providerFieldsSpotId =
    selectedProvider?.transactionCreateFieldSpotId?.trim() ||
    (selectedProvider?.providerKey ? `payment-gateways.transaction-create:${selectedProvider.providerKey}:fields` : '')
  const { widgets: providerFieldWidgets } = useInjectionDataWidgets(providerFieldsSpotId || '__disabled__:fields')
  const providerFields = React.useMemo(
    () =>
      providerFieldWidgets.flatMap((widget) =>
        'fields' in widget && Array.isArray(widget.fields) ? widget.fields : [],
      ),
    [providerFieldWidgets],
  )

  React.useEffect(() => {
    if (!open) {
      setValues({
        providerKey: '',
        amount: 0,
        currencyCode: 'USD',
        description: '',
        createPaymentLink: true,
        paymentLinkTitle: '',
        paymentLinkDescription: '',
        paymentLinkPassword: '',
      })
    }
  }, [open])

  const handleChange = React.useCallback((fieldId: string, value: unknown) => {
    setValues((current) => ({ ...current, [fieldId]: value }))
  }, [])

  const handleSubmit = React.useCallback(async () => {
    const providerKey = typeof values.providerKey === 'string' ? values.providerKey : ''
    const currencyCode = typeof values.currencyCode === 'string' ? values.currencyCode.trim().toUpperCase() : ''
    const amount = typeof values.amount === 'number' ? values.amount : Number(values.amount)
    if (!providerKey || !currencyCode || !Number.isFinite(amount) || amount <= 0) {
      flash(t('payment_gateways.create.validation', 'Provider, amount, and currency are required.'), 'error')
      return
    }

    const providerInput = providerFields.reduce<Record<string, unknown>>((acc, field) => {
      if (field.id in values) acc[field.id] = values[field.id]
      return acc
    }, {})
    const captureMethod =
      typeof providerInput.captureMethod === 'string' && (providerInput.captureMethod === 'automatic' || providerInput.captureMethod === 'manual')
        ? providerInput.captureMethod
        : 'automatic'
    const createPaymentLink = values.createPaymentLink === true && Boolean(selectedProvider?.supportsPaymentLinks)

    setSubmitting(true)
    try {
      const result = await runMutation<CreateSessionResult>({
        context: { dialog: 'payment-gateways.create-transaction' },
        mutationPayload: values,
        operation: async () => {
          const call = await apiCall<CreateSessionResult>('/api/payment_gateways/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              providerKey,
              amount,
              currencyCode,
              description: typeof values.description === 'string' ? values.description.trim() : undefined,
              captureMethod,
              providerInput,
              paymentLink: createPaymentLink ? {
                enabled: true,
                title: typeof values.paymentLinkTitle === 'string' ? values.paymentLinkTitle.trim() || undefined : undefined,
                description:
                  typeof values.paymentLinkDescription === 'string'
                    ? values.paymentLinkDescription.trim() || undefined
                    : undefined,
                password:
                  typeof values.paymentLinkPassword === 'string'
                    ? values.paymentLinkPassword.trim() || undefined
                    : undefined,
              } : undefined,
            }),
          }, { fallback: null })
          if (!call.ok || !call.result) {
            throw new Error(t('payment_gateways.create.error', 'Failed to create the payment transaction.'))
          }
          return call.result
        },
      })

      if (result.paymentLinkUrl && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(result.paymentLinkUrl)
      }
      flash(
        result.paymentLinkUrl
          ? t('payment_gateways.create.successWithLink', 'Payment transaction created and the payment link was copied.')
          : t('payment_gateways.create.success', 'Payment transaction created.'),
        'success',
      )
      await onCreated?.(result.transactionId)
      onOpenChange(false)
    } catch (error) {
      flash(error instanceof Error ? error.message : t('payment_gateways.create.error', 'Failed to create the payment transaction.'), 'error')
    } finally {
      setSubmitting(false)
    }
  }, [onCreated, onOpenChange, providerFields, runMutation, selectedProvider?.supportsPaymentLinks, t, values])

  const paymentLinkEnabled = values.createPaymentLink === true && Boolean(selectedProvider?.supportsPaymentLinks)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('payment_gateways.create.title', 'Create new transaction')}</DialogTitle>
        </DialogHeader>
        <div
          className="space-y-6"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void handleSubmit()
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="providerKey">{t('payment_gateways.create.provider', 'Provider')}</Label>
              <select
                id="providerKey"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={typeof values.providerKey === 'string' ? values.providerKey : ''}
                onChange={(event) => handleChange('providerKey', event.target.value)}
                disabled={loadingProviders || submitting}
              >
                <option value="">{t('payment_gateways.create.providerPlaceholder', 'Select provider')}</option>
                {providers.map((provider) => (
                  <option key={provider.providerKey} value={provider.providerKey}>
                    {formatProviderLabel(provider)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="currencyCode">{t('payment_gateways.create.currency', 'Currency')}</Label>
              <Input
                id="currencyCode"
                value={typeof values.currencyCode === 'string' ? values.currencyCode : ''}
                onChange={(event) => handleChange('currencyCode', event.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">{t('payment_gateways.create.amount', 'Amount')}</Label>
              <Input
                id="amount"
                type="number"
                min="0"
                step="0.01"
                value={typeof values.amount === 'number' ? String(values.amount) : String(values.amount ?? '')}
                onChange={(event) => handleChange('amount', event.target.value === '' ? '' : Number(event.target.value))}
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">{t('payment_gateways.create.description', 'Description')}</Label>
              <Input
                id="description"
                value={typeof values.description === 'string' ? values.description : ''}
                onChange={(event) => handleChange('description', event.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          {selectedProvider?.description ? (
            <p className="text-sm text-muted-foreground">{selectedProvider.description}</p>
          ) : null}

          {providerFields.length > 0 ? (
            <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
              <div>
                <div className="text-sm font-medium">{t('payment_gateways.create.providerSettings', 'Provider settings')}</div>
                <div className="text-xs text-muted-foreground">
                  {t('payment_gateways.create.providerSettingsHelp', 'These options are defined by the selected payment gateway.')}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {providerFields.map((field) => (
                  <InjectedField
                    key={field.id}
                    field={field}
                    value={values[field.id]}
                    onChange={handleChange}
                    context={{}}
                    formData={values}
                    readOnly={submitting}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {selectedProvider?.supportsPaymentLinks ? (
            <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
              <label className="flex items-center gap-3 text-sm font-medium">
                <Checkbox
                  checked={values.createPaymentLink === true}
                  onCheckedChange={(checked) => handleChange('createPaymentLink', checked === true)}
                  disabled={submitting}
                />
                <span>{t('payment_gateways.create.paymentLinkToggle', 'Create payment link')}</span>
              </label>

              {paymentLinkEnabled ? (
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="paymentLinkTitle">{t('payment_gateways.create.paymentLinkTitle', 'Link title')}</Label>
                    <Input
                      id="paymentLinkTitle"
                      value={typeof values.paymentLinkTitle === 'string' ? values.paymentLinkTitle : ''}
                      onChange={(event) => handleChange('paymentLinkTitle', event.target.value)}
                      disabled={submitting}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="paymentLinkDescription">{t('payment_gateways.create.paymentLinkDescription', 'Link description')}</Label>
                    <Textarea
                      id="paymentLinkDescription"
                      value={typeof values.paymentLinkDescription === 'string' ? values.paymentLinkDescription : ''}
                      onChange={(event) => handleChange('paymentLinkDescription', event.target.value)}
                      disabled={submitting}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="paymentLinkPassword">{t('payment_gateways.create.paymentLinkPassword', 'Password (optional)')}</Label>
                    <Input
                      id="paymentLinkPassword"
                      type="password"
                      value={typeof values.paymentLinkPassword === 'string' ? values.paymentLinkPassword : ''}
                      onChange={(event) => handleChange('paymentLinkPassword', event.target.value)}
                      disabled={submitting}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={() => void handleSubmit()} disabled={loadingProviders || !selectedProvider || submitting}>
              {submitting ? <Spinner className="mr-2 h-4 w-4" /> : null}
              {t('payment_gateways.create.submit', 'Create transaction')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default CreatePaymentTransactionDialog
