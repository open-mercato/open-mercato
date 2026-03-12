"use client"

import * as React from 'react'
import { z } from 'zod'
import {
  CrudForm,
  type CrudCustomFieldRenderProps,
  type CrudField,
  type CrudFieldOption,
  type CrudFormGroup,
  type CrudFormGroupComponentProps,
} from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { InjectedField } from '@open-mercato/ui/backend/injection/InjectedField'
import { useInjectionDataWidgets } from '@open-mercato/ui/backend/injection/useInjectionDataWidgets'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  buildPaymentGatewayTransactionCreateFieldSpotId,
  PAYMENT_GATEWAY_TRANSACTION_CREATE_FORM_SPOT_ID,
} from '@open-mercato/shared/modules/payment_gateways/types'
import type { InjectionFieldDefinition } from '@open-mercato/shared/modules/widgets/injection'
import { CheckCircle2, Copy, ExternalLink, Share2 } from 'lucide-react'

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

type CreatedPaymentLinkState = {
  transactionId: string
  paymentLinkUrl: string
}

type CreatePaymentTransactionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (transactionId: string) => Promise<void> | void
}

type CreatePaymentTransactionFormValues = {
  providerKey: string
  amount: number | ''
  currencyCode: string
  description: string
  createPaymentLink: boolean
  paymentLinkTitle: string
  paymentLinkDescription: string
  paymentLinkPassword: string
} & Record<string, unknown>

const DEFAULT_FORM_VALUES: CreatePaymentTransactionFormValues = {
  providerKey: '',
  amount: '',
  currencyCode: '',
  description: '',
  createPaymentLink: true,
  paymentLinkTitle: '',
  paymentLinkDescription: '',
  paymentLinkPassword: '',
}

function formatProviderLabel(provider: ProviderItem): string {
  return provider.title || provider.providerKey
}

function ProviderSelectField({
  value,
  setValue,
  autoFocus,
  disabled,
  providers,
  isLoading,
  placeholder,
  onProviderChange,
}: CrudCustomFieldRenderProps & {
  providers: ProviderItem[]
  isLoading: boolean
  placeholder: string
  onProviderChange: (providerKey: string) => void
}) {
  return (
    <select
      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => {
        const nextProviderKey = event.target.value
        setValue(nextProviderKey)
        onProviderChange(nextProviderKey)
      }}
      autoFocus={autoFocus}
      disabled={disabled || isLoading}
    >
      <option value="">{placeholder}</option>
      {providers.map((provider) => (
        <option key={provider.providerKey} value={provider.providerKey}>
          {formatProviderLabel(provider)}
        </option>
      ))}
    </select>
  )
}

function CurrencySelectField({
  value,
  setValue,
  autoFocus,
  disabled,
  currencies,
  isLoading,
  placeholder,
}: CrudCustomFieldRenderProps & {
  currencies: CrudFieldOption[]
  isLoading: boolean
  placeholder: string
}) {
  return (
    <select
      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => setValue(event.target.value)}
      autoFocus={autoFocus}
      disabled={disabled || isLoading}
    >
      <option value="">{placeholder}</option>
      {currencies.map((currency) => (
        <option key={currency.value} value={currency.value}>
          {currency.label}
        </option>
      ))}
    </select>
  )
}

function ProviderInjectedFieldsSection({
  provider,
  values,
  setValue,
  onFieldsResolved,
}: {
  provider: ProviderItem | null
  values: Record<string, unknown>
  setValue: (id: string, value: unknown) => void
  onFieldsResolved: (providerKey: string, fields: InjectionFieldDefinition[]) => void
}) {
  const t = useT()
  const providerFieldSpotId =
    provider?.transactionCreateFieldSpotId?.trim() ||
    (provider?.providerKey ? buildPaymentGatewayTransactionCreateFieldSpotId(provider.providerKey) : '')
  const { widgets: providerFieldWidgets } = useInjectionDataWidgets(providerFieldSpotId || '__disabled__:fields')
  const providerFields = React.useMemo(
    () =>
      providerFieldWidgets.flatMap((widget) =>
        'fields' in widget && Array.isArray(widget.fields) ? widget.fields : [],
      ),
    [providerFieldWidgets],
  )

  React.useEffect(() => {
    onFieldsResolved(provider?.providerKey ?? '', providerFields)
  }, [onFieldsResolved, provider?.providerKey, providerFields])

  if (!provider && providerFields.length === 0) return null
  if (!provider?.description && providerFields.length === 0) return null

  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      {provider?.description ? (
        <p className="text-sm text-muted-foreground">{provider.description}</p>
      ) : null}

      {providerFields.length > 0 ? (
        <div className={provider?.description ? 'mt-4 space-y-4' : 'space-y-4'}>
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
                onChange={setValue}
                context={{ record: { providerKey: provider?.providerKey ?? null } }}
                formData={values}
                readOnly={false}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function PaymentLinkSection({
  provider,
  values,
  errors,
  setValue,
}: CrudFormGroupComponentProps & {
  provider: ProviderItem | null
}) {
  const t = useT()

  if (!provider?.supportsPaymentLinks) return null

  const paymentLinkEnabled = values.createPaymentLink === true

  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <label className="flex items-center gap-3 text-sm font-medium">
        <Checkbox
          checked={paymentLinkEnabled}
          onCheckedChange={(checked) => setValue('createPaymentLink', checked === true)}
        />
        <span>{t('payment_gateways.create.paymentLinkToggle', 'Create payment link')}</span>
      </label>

      {paymentLinkEnabled ? (
        <div className="mt-4 grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="paymentLinkTitle">
              {t('payment_gateways.create.paymentLinkTitle', 'Link title')}
              <span className="text-red-600"> *</span>
            </Label>
            <Input
              id="paymentLinkTitle"
              value={typeof values.paymentLinkTitle === 'string' ? values.paymentLinkTitle : ''}
              onChange={(event) => setValue('paymentLinkTitle', event.target.value)}
              aria-invalid={errors.paymentLinkTitle ? 'true' : 'false'}
            />
            {errors.paymentLinkTitle ? <p className="text-xs text-destructive">{errors.paymentLinkTitle}</p> : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="paymentLinkDescription">{t('payment_gateways.create.paymentLinkDescription', 'Link description')}</Label>
            <Textarea
              id="paymentLinkDescription"
              value={typeof values.paymentLinkDescription === 'string' ? values.paymentLinkDescription : ''}
              onChange={(event) => setValue('paymentLinkDescription', event.target.value)}
              aria-invalid={errors.paymentLinkDescription ? 'true' : 'false'}
            />
            {errors.paymentLinkDescription ? <p className="text-xs text-destructive">{errors.paymentLinkDescription}</p> : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="paymentLinkPassword">{t('payment_gateways.create.paymentLinkPassword', 'Password (optional)')}</Label>
            <Input
              id="paymentLinkPassword"
              type="password"
              value={typeof values.paymentLinkPassword === 'string' ? values.paymentLinkPassword : ''}
              onChange={(event) => setValue('paymentLinkPassword', event.target.value)}
              aria-invalid={errors.paymentLinkPassword ? 'true' : 'false'}
            />
            {errors.paymentLinkPassword ? <p className="text-xs text-destructive">{errors.paymentLinkPassword}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function CreatePaymentTransactionDialog({
  open,
  onOpenChange,
  onCreated,
}: CreatePaymentTransactionDialogProps) {
  const t = useT()
  const dialogContentRef = React.useRef<HTMLDivElement | null>(null)
  const providerFieldsRef = React.useRef<InjectionFieldDefinition[]>([])
  const [providers, setProviders] = React.useState<ProviderItem[]>([])
  const [currencies, setCurrencies] = React.useState<CrudFieldOption[]>([])
  const [loadingProviders, setLoadingProviders] = React.useState(false)
  const [loadingCurrencies, setLoadingCurrencies] = React.useState(false)
  const [currentProviderKey, setCurrentProviderKey] = React.useState('')
  const [formInitialValues, setFormInitialValues] = React.useState<CreatePaymentTransactionFormValues>(DEFAULT_FORM_VALUES)
  const [formResetKey, setFormResetKey] = React.useState(0)
  const [createdPaymentLink, setCreatedPaymentLink] = React.useState<CreatedPaymentLinkState | null>(null)
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    let mounted = true

    const loadProviders = async () => {
      setLoadingProviders(true)
      setLoadingCurrencies(true)
      const [providersCall, currenciesCall] = await Promise.all([
        apiCall<{ items?: ProviderItem[] }>('/api/payment_gateways/providers', undefined, {
          fallback: { items: [] },
        }),
        apiCall<{ items?: CrudFieldOption[] }>('/api/currencies/currencies/options', undefined, {
          fallback: { items: [] },
        }),
      ])

      if (!mounted) return

      const nextProviders = Array.isArray(providersCall.result?.items) ? providersCall.result.items : []
      const nextCurrencies = Array.isArray(currenciesCall.result?.items) ? currenciesCall.result.items : []
      const defaultProviderKey = nextProviders[0]?.providerKey ?? ''
      const defaultCurrencyCode = nextCurrencies.find((currency) => currency.value === 'USD')?.value
        ?? nextCurrencies[0]?.value
        ?? ''

      setProviders(nextProviders)
      setCurrencies(nextCurrencies)
      setCurrentProviderKey(defaultProviderKey)
      providerFieldsRef.current = []
      setFormInitialValues({
        ...DEFAULT_FORM_VALUES,
        providerKey: defaultProviderKey,
        currencyCode: defaultCurrencyCode,
      })
      setFormResetKey((current) => current + 1)
      setLoadingProviders(false)
      setLoadingCurrencies(false)
    }

    void loadProviders()

    return () => {
      mounted = false
    }
  }, [open])

  React.useEffect(() => {
    if (open) return
    setProviders([])
    setCurrencies([])
    setLoadingProviders(false)
    setLoadingCurrencies(false)
    setCurrentProviderKey('')
    providerFieldsRef.current = []
    setFormInitialValues(DEFAULT_FORM_VALUES)
    setCreatedPaymentLink(null)
    setCopied(false)
    setFormResetKey((current) => current + 1)
  }, [open])

  const selectedProvider = React.useMemo(
    () => providers.find((provider) => provider.providerKey === currentProviderKey) ?? null,
    [currentProviderKey, providers],
  )

  const schema = React.useMemo<z.ZodType<CreatePaymentTransactionFormValues>>(() => z.object({
    providerKey: z.string(),
    amount: z.union([z.number(), z.literal('')]),
    currencyCode: z.string(),
    description: z.string(),
    createPaymentLink: z.boolean(),
    paymentLinkTitle: z.string(),
    paymentLinkDescription: z.string(),
    paymentLinkPassword: z.string(),
  }).catchall(z.unknown()).superRefine((value, ctx) => {
    const provider = providers.find((item) => item.providerKey === value.providerKey) ?? null
    const paymentLinkEnabled = provider?.supportsPaymentLinks === true && value.createPaymentLink === true
    const validationMessage = t('payment_gateways.create.validation', 'Provider, amount, and currency are required.')

    if (!value.providerKey.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['providerKey'],
        message: t('payment_gateways.create.providerPlaceholder', 'Select provider'),
      })
    }

    if (typeof value.amount !== 'number' || !Number.isFinite(value.amount) || value.amount <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amount'],
        message: validationMessage,
      })
    }

    if (value.currencyCode.trim().length !== 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currencyCode'],
        message: validationMessage,
      })
    }

    if (paymentLinkEnabled && (!value.paymentLinkTitle || value.paymentLinkTitle.trim().length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['paymentLinkTitle'],
        message: t('payment_gateways.create.paymentLinkTitleRequired', 'Enter a title for the payment link.'),
      })
    }

    if (value.paymentLinkDescription && value.paymentLinkDescription.trim().length > 500) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['paymentLinkDescription'],
        message: t('payment_gateways.create.paymentLinkDescriptionTooLong', 'Link description must be 500 characters or fewer.'),
      })
    }

    if (
      paymentLinkEnabled &&
      value.paymentLinkPassword &&
      value.paymentLinkPassword.trim().length > 0 &&
      value.paymentLinkPassword.trim().length < 4
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['paymentLinkPassword'],
        message: t('payment_gateways.create.paymentLinkPasswordInvalid', 'Password must be at least 4 characters.'),
      })
    }
  }), [providers, t])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'providerKey',
      label: t('payment_gateways.create.provider', 'Provider'),
      type: 'custom',
      layout: 'half',
      required: true,
      component: (props) => (
        <ProviderSelectField
          {...props}
          providers={providers}
          isLoading={loadingProviders}
          placeholder={t('payment_gateways.create.providerPlaceholder', 'Select provider')}
          onProviderChange={(providerKey) => setCurrentProviderKey(providerKey)}
        />
      ),
    },
    {
      id: 'currencyCode',
      label: t('payment_gateways.create.currency', 'Currency'),
      type: 'custom',
      layout: 'half',
      required: true,
      component: (props) => (
        <CurrencySelectField
          {...props}
          currencies={currencies}
          isLoading={loadingCurrencies}
          placeholder={t('payment_gateways.create.currencyPlaceholder', 'Select currency')}
        />
      ),
    },
    {
      id: 'amount',
      label: t('payment_gateways.create.amount', 'Amount'),
      type: 'number',
      layout: 'half',
      required: true,
    },
    {
      id: 'description',
      label: t('payment_gateways.create.description', 'Description'),
      type: 'text',
      layout: 'half',
    },
  ], [currencies, loadingCurrencies, loadingProviders, providers, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'details',
      fields: ['providerKey', 'currencyCode', 'amount', 'description'],
    },
    {
      id: 'providerFields',
      bare: true,
      component: ({ values, setValue }) => (
        <ProviderInjectedFieldsSection
          provider={selectedProvider}
          values={values}
          setValue={setValue}
          onFieldsResolved={(providerKey, resolvedFields) => {
            if (providerKey !== currentProviderKey) return
            providerFieldsRef.current = resolvedFields
          }}
        />
      ),
    },
    {
      id: 'paymentLink',
      bare: true,
      component: (ctx) => <PaymentLinkSection {...ctx} provider={selectedProvider} />,
    },
  ], [currentProviderKey, selectedProvider])

  const handleSubmit = React.useCallback(async (values: CreatePaymentTransactionFormValues) => {
    const providerKey = typeof values.providerKey === 'string' ? values.providerKey.trim() : ''
    const currencyCode = typeof values.currencyCode === 'string' ? values.currencyCode.trim().toUpperCase() : ''
    const amount = typeof values.amount === 'number' ? values.amount : Number(values.amount)
    const fieldErrors: Record<string, string> = {}

    if (!providerKey) {
      fieldErrors.providerKey = t('payment_gateways.create.validation', 'Provider, amount, and currency are required.')
    }
    if (!currencyCode || currencyCode.length !== 3) {
      fieldErrors.currencyCode = t('payment_gateways.create.validation', 'Provider, amount, and currency are required.')
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      fieldErrors.amount = t('payment_gateways.create.validation', 'Provider, amount, and currency are required.')
    }

    const provider = providers.find((item) => item.providerKey === providerKey) ?? null
    if (!provider) {
      fieldErrors.providerKey = t('payment_gateways.create.providerPlaceholder', 'Select provider')
    }

    const paymentLinkEnabled = provider?.supportsPaymentLinks === true && values.createPaymentLink === true
    const paymentLinkTitle =
      typeof values.paymentLinkTitle === 'string' ? values.paymentLinkTitle.trim() : ''
    const paymentLinkDescription =
      typeof values.paymentLinkDescription === 'string' ? values.paymentLinkDescription.trim() : ''
    const paymentLinkPassword =
      typeof values.paymentLinkPassword === 'string' ? values.paymentLinkPassword.trim() : ''
    if (paymentLinkEnabled && !paymentLinkTitle) {
      fieldErrors.paymentLinkTitle = t('payment_gateways.create.paymentLinkTitleRequired', 'Enter a title for the payment link.')
    }
    if (paymentLinkDescription.length > 500) {
      fieldErrors.paymentLinkDescription = t('payment_gateways.create.paymentLinkDescriptionTooLong', 'Link description must be 500 characters or fewer.')
    }
    if (paymentLinkEnabled && paymentLinkPassword.length > 0 && paymentLinkPassword.length < 4) {
      fieldErrors.paymentLinkPassword = t('payment_gateways.create.paymentLinkPasswordInvalid', 'Password must be at least 4 characters.')
    }

    if (Object.keys(fieldErrors).length > 0) {
      throw createCrudFormError(
        t('payment_gateways.create.validation', 'Provider, amount, and currency are required.'),
        fieldErrors,
      )
    }

    const providerInput = providerFieldsRef.current.reduce<Record<string, unknown>>((acc, field) => {
      if (field.id in values) acc[field.id] = values[field.id]
      return acc
    }, {})

    const captureMethod =
      typeof providerInput.captureMethod === 'string' && (providerInput.captureMethod === 'automatic' || providerInput.captureMethod === 'manual')
        ? providerInput.captureMethod
        : 'automatic'

    const call = await apiCallOrThrow<CreateSessionResult>('/api/payment_gateways/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerKey,
        amount,
        currencyCode,
        description: typeof values.description === 'string' ? values.description.trim() || undefined : undefined,
        captureMethod,
        providerInput,
        paymentLink: paymentLinkEnabled ? {
          enabled: true,
          title: paymentLinkTitle || undefined,
          description: paymentLinkDescription || undefined,
          password: paymentLinkPassword || undefined,
        } : undefined,
      }),
    }, {
      errorMessage: t('payment_gateways.create.error', 'Failed to create the payment transaction.'),
    })

    if (!call.result) {
      throw createCrudFormError(t('payment_gateways.create.error', 'Failed to create the payment transaction.'))
    }

    flash(
      call.result.paymentLinkUrl
        ? t('payment_gateways.create.successWithLink', 'Payment transaction created and the payment link is ready to share.')
        : t('payment_gateways.create.success', 'Payment transaction created.'),
      'success',
    )
    await onCreated?.(call.result.transactionId)
    if (call.result.paymentLinkUrl) {
      setCreatedPaymentLink({
        transactionId: call.result.transactionId,
        paymentLinkUrl: call.result.paymentLinkUrl,
      })
      setCopied(false)
      return
    }
    onOpenChange(false)
  }, [onCreated, onOpenChange, providers, t])

  const handleShortcutSubmit = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      const form = dialogContentRef.current?.querySelector('form')
      form?.requestSubmit()
    }
  }, [])

  const handleCopyLink = React.useCallback(async () => {
    if (!createdPaymentLink?.paymentLinkUrl || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      flash(t('payment_gateways.create.copyUnavailable', 'Copy is not available in this browser.'), 'error')
      return
    }
    try {
      await navigator.clipboard.writeText(createdPaymentLink.paymentLinkUrl)
      setCopied(true)
      flash(t('payment_gateways.create.linkCopied', 'Payment link copied.'), 'success')
    } catch {
      flash(t('payment_gateways.create.copyFailed', 'Unable to copy the payment link.'), 'error')
    }
  }, [createdPaymentLink?.paymentLinkUrl, t])

  const handleNativeShare = React.useCallback(async () => {
    if (!createdPaymentLink?.paymentLinkUrl || typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
      await handleCopyLink()
      return
    }
    try {
      await navigator.share({
        title: t('payment_gateways.create.shareTitle', 'Payment link'),
        url: createdPaymentLink.paymentLinkUrl,
      })
    } catch {
      // Ignore dismissed share dialogs.
    }
  }, [createdPaymentLink?.paymentLinkUrl, handleCopyLink, t])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={dialogContentRef}
        className="max-w-2xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onOpenChange(false)
          }
          handleShortcutSubmit(event)
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {createdPaymentLink
              ? t('payment_gateways.create.shareReady', 'Payment link ready')
              : t('payment_gateways.create.title', 'Create new transaction')}
          </DialogTitle>
        </DialogHeader>
        {createdPaymentLink ? (
          <div className="space-y-6">
            <div className="rounded-xl border bg-muted/20 p-5">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-600" />
                <div className="space-y-1">
                  <div className="font-medium">
                    {t('payment_gateways.create.shareDescription', 'The payment transaction was created successfully. Share the link below with the customer.')}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {t('payment_gateways.create.transactionReference', 'Transaction ID: {id}', {
                      id: createdPaymentLink.transactionId,
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <Label htmlFor="createdPaymentLink">{t('payment_gateways.create.generatedLink', 'Payment link')}</Label>
                <Input
                  id="createdPaymentLink"
                  readOnly
                  value={createdPaymentLink.paymentLinkUrl}
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button type="button" onClick={() => void handleCopyLink()}>
                  <Copy className="mr-2 h-4 w-4" />
                  {copied ? t('payment_gateways.create.copied', 'Copied') : t('payment_gateways.create.copy', 'Copy link')}
                </Button>
                <Button type="button" variant="outline" onClick={() => void handleNativeShare()}>
                  <Share2 className="mr-2 h-4 w-4" />
                  {t('payment_gateways.create.share', 'Share')}
                </Button>
                <Button asChild type="button" variant="outline">
                  <a href={createdPaymentLink.paymentLinkUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    {t('payment_gateways.create.openLink', 'Open link')}
                  </a>
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const resetCurrencyCode = currencies.find((currency) => currency.value === 'USD')?.value
                    ?? currencies[0]?.value
                    ?? ''
                  setCreatedPaymentLink(null)
                  setCopied(false)
                  providerFieldsRef.current = []
                  setFormInitialValues({
                    ...DEFAULT_FORM_VALUES,
                    providerKey: providers[0]?.providerKey ?? '',
                    currencyCode: resetCurrencyCode,
                  })
                  setCurrentProviderKey(providers[0]?.providerKey ?? '')
                  setFormResetKey((current) => current + 1)
                }}
              >
                {t('payment_gateways.create.createAnother', 'Create another')}
              </Button>
              <Button type="button" onClick={() => onOpenChange(false)}>
                {t('common.done', 'Done')}
              </Button>
            </div>
          </div>
        ) : (
          <CrudForm<CreatePaymentTransactionFormValues>
            key={formResetKey}
            embedded
            schema={schema}
            fields={fields}
            groups={groups}
            initialValues={formInitialValues}
            isLoading={loadingProviders || loadingCurrencies}
            loadingMessage={t('ui.forms.loading', 'Loading data...')}
            submitLabel={t('payment_gateways.create.submit', 'Create transaction')}
            injectionSpotId={PAYMENT_GATEWAY_TRANSACTION_CREATE_FORM_SPOT_ID}
            onSubmit={handleSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

export default CreatePaymentTransactionDialog
