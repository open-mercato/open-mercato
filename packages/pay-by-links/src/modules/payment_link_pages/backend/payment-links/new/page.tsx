"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFieldOption, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import { ExternalLink } from 'lucide-react'
import { InjectedField } from '@open-mercato/ui/backend/injection/InjectedField'
import { useInjectionDataWidgets } from '@open-mercato/ui/backend/injection/useInjectionDataWidgets'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { buildPaymentGatewayTransactionCreateFieldSpotId } from '@open-mercato/shared/modules/payment_gateways/types'
import { PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID } from '@open-mercato/shared/modules/payment_link_pages/types'
import type { InjectionFieldDefinition } from '@open-mercato/shared/modules/widgets/injection'
import {
  paymentLinkCreateSchema,
  buildPaymentLinkFormFields,
  buildPaymentLinkFormGroups,
  paymentLinkFormToSessionPayload,
  paymentLinkFormToTemplatePayload,
  type PaymentLinkCreateFormValues,
  type ProviderItem,
  type TemplateOption,
} from '../../../components/paymentLinkFormConfig'
import { recordToTemplateFormValues } from '../../../components/templateFormConfig'

function ProviderInjectedFields({
  provider,
  values,
  setValue,
  onFieldsResolved,
  errors,
  onFieldChange,
  onValueCapture,
}: {
  provider: ProviderItem | null
  values: Record<string, unknown>
  setValue: (id: string, value: unknown) => void
  onFieldsResolved: (providerKey: string, fields: InjectionFieldDefinition[]) => void
  errors?: Record<string, string>
  onFieldChange?: (fieldId: string) => void
  onValueCapture?: (fieldId: string, value: unknown) => void
}) {
  const t = useT()
  const spotId = provider?.transactionCreateFieldSpotId?.trim()
    || (provider?.providerKey ? buildPaymentGatewayTransactionCreateFieldSpotId(provider.providerKey) : '')
  const { widgets } = useInjectionDataWidgets(spotId || '__disabled__:fields')
  const providerFields = React.useMemo(
    () => widgets.flatMap(w => 'fields' in w && Array.isArray(w.fields) ? w.fields : []),
    [widgets],
  )

  React.useEffect(() => {
    onFieldsResolved(provider?.providerKey ?? '', providerFields)
  }, [onFieldsResolved, provider?.providerKey, providerFields])

  const handleChange = React.useCallback((fieldId: string, value: unknown) => {
    setValue(fieldId, value)
    onFieldChange?.(fieldId)
    onValueCapture?.(fieldId, value)
  }, [setValue, onFieldChange, onValueCapture])

  if (!provider?.description && providerFields.length === 0) return null

  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      {provider?.description ? <p className="text-sm text-muted-foreground">{provider.description}</p> : null}
      {providerFields.length > 0 ? (
        <div className={provider?.description ? 'mt-4 space-y-4' : 'space-y-4'}>
          <div>
            <div className="text-sm font-medium">{t('payment_gateways.create.providerSettings', 'Provider settings')}</div>
            <div className="text-xs text-muted-foreground">{t('payment_gateways.create.providerSettingsHelp', 'These options are defined by the selected payment gateway.')}</div>
          </div>
          <div className="grid gap-4">
            {providerFields.map(field => (
              <InjectedField
                key={field.id}
                field={field}
                value={values[field.id]}
                onChange={handleChange}
                context={{ record: { providerKey: provider?.providerKey ?? null } }}
                formData={values}
                readOnly={false}
                error={errors?.[field.id]}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default function CreatePaymentLinkPage() {
  const t = useT()
  const router = useRouter()

  const [providers, setProviders] = React.useState<ProviderItem[]>([])
  const [currencies, setCurrencies] = React.useState<CrudFieldOption[]>([])
  const [templates, setTemplates] = React.useState<TemplateOption[]>([])
  const [loadingProviders, setLoadingProviders] = React.useState(true)
  const [loadingCurrencies, setLoadingCurrencies] = React.useState(true)
  const [loadingTemplates, setLoadingTemplates] = React.useState(true)
  const [currentProviderKey, setCurrentProviderKey] = React.useState('')
  const providerFieldsRef = React.useRef<InjectionFieldDefinition[]>([])
  const providerValuesRef = React.useRef<Record<string, unknown>>({})
  const [providerErrors, setProviderErrors] = React.useState<Record<string, string>>({})
  const [formResetKey, setFormResetKey] = React.useState(0)
  const [initialValues, setInitialValues] = React.useState<Partial<PaymentLinkCreateFormValues>>({})
  const openPreviewAfterCreateRef = React.useRef(false)
  const paymentLinkFormId = 'create-payment-link-form'

  React.useEffect(() => {
    let mounted = true
    Promise.all([
      apiCall<{ items?: ProviderItem[] }>('/api/payment_gateways/providers', undefined, { fallback: { items: [] } }),
      apiCall<{ items?: CrudFieldOption[] }>('/api/currencies/currencies/options', undefined, { fallback: { items: [] } }),
      apiCall<{ items?: Array<{ id: string; name: string }> }>('/api/payment_link_pages/templates?pageSize=100', undefined, { fallback: { items: [] } }),
    ]).then(([providerRes, currencyRes, templateRes]) => {
      if (!mounted) return
      const nextProviders = Array.isArray(providerRes.result?.items) ? providerRes.result.items : []
      const nextCurrencies = Array.isArray(currencyRes.result?.items) ? currencyRes.result.items : []
      const nextTemplates = (Array.isArray(templateRes.result?.items) ? templateRes.result.items : [])
        .map(item => ({ id: String(item.id), name: String(item.name ?? '') }))
      setProviders(nextProviders)
      setCurrencies(nextCurrencies)
      setTemplates(nextTemplates)
      const defaultProvider = nextProviders[0]?.providerKey ?? ''
      const defaultCurrency = nextCurrencies.find(c => c.value === 'USD')?.value ?? nextCurrencies[0]?.value ?? ''
      setCurrentProviderKey(defaultProvider)
      setInitialValues({ providerKey: defaultProvider, currencyCode: defaultCurrency })
      setFormResetKey(k => k + 1)
      setLoadingProviders(false)
      setLoadingCurrencies(false)
      setLoadingTemplates(false)
    })
    return () => { mounted = false }
  }, [])

  const handleTemplateSelect = React.useCallback(async (templateId: string | null) => {
    if (!templateId) return
    try {
      const res = await apiCall<{ items?: Record<string, unknown>[] }>(
        `/api/payment_link_pages/templates?id=${templateId}&pageSize=1`,
        undefined,
        { fallback: { items: [] } },
      )
      const record = res.result?.items?.[0]
      if (!record) return
      const templateValues = recordToTemplateFormValues(record)
      const cfEntries: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(templateValues)) {
        if (key.startsWith('cf_')) cfEntries[key] = value
      }
      setInitialValues(prev => ({
        ...prev,
        ...cfEntries,
        templateId,
        brandingLogoUrl: templateValues.brandingLogoUrl,
        brandingBrandName: templateValues.brandingBrandName,
        brandingSecuritySubtitle: templateValues.brandingSecuritySubtitle,
        brandingAccentColor: templateValues.brandingAccentColor,
        defaultTitle: templateValues.defaultTitle,
        defaultDescription: templateValues.defaultDescription,
        completedContent: templateValues.completedContent,
        customerCaptureEnabled: templateValues.customerCaptureEnabled,
        customerCaptureHandlingMode: templateValues.customerCaptureHandlingMode,
        customerCaptureCompanyRequired: templateValues.customerCaptureCompanyRequired,
        captureFirstNameVisible: templateValues.captureFirstNameVisible,
        captureFirstNameRequired: templateValues.captureFirstNameRequired,
        captureLastNameVisible: templateValues.captureLastNameVisible,
        captureLastNameRequired: templateValues.captureLastNameRequired,
        capturePhoneVisible: templateValues.capturePhoneVisible,
        capturePhoneRequired: templateValues.capturePhoneRequired,
        captureCompanyVisible: templateValues.captureCompanyVisible,
        captureCompanyRequired: templateValues.captureCompanyRequired,
        captureAddressVisible: templateValues.captureAddressVisible,
        captureAddressRequired: templateValues.captureAddressRequired,
        captureAddressFormat: templateValues.captureAddressFormat,
        customerCaptureTermsRequired: templateValues.customerCaptureTermsRequired,
        customerCaptureTermsMarkdown: templateValues.customerCaptureTermsMarkdown,
        customerFieldsetCode: templateValues.customerFieldsetCode,
        displayCustomFields: templateValues.displayCustomFields,
        amountType: templateValues.amountType,
        amountOptions: templateValues.amountOptions,
        minAmount: templateValues.minAmount,
        maxAmount: templateValues.maxAmount,
        customFieldsetCode: templateValues.customFieldsetCode,
        customFieldsJson: templateValues.customFieldsJson,
        metadataJson: templateValues.metadataJson,
      }))
      setFormResetKey(k => k + 1)
    } catch {
      flash(t('payment_link_pages.create.templateLoadError', 'Failed to load template'), 'error')
    }
  }, [t])

  const selectedProvider = React.useMemo(
    () => providers.find(p => p.providerKey === currentProviderKey) ?? null,
    [currentProviderKey, providers],
  )

  const fields = React.useMemo(() => buildPaymentLinkFormFields(t, {
    providers,
    currencies,
    templates,
    loadingProviders,
    loadingCurrencies,
    loadingTemplates,
    onProviderChange: (key) => setCurrentProviderKey(key),
    onTemplateSelect: handleTemplateSelect,
  }), [t, providers, currencies, templates, loadingProviders, loadingCurrencies, loadingTemplates, handleTemplateSelect])

  const handleProviderFieldChange = React.useCallback((fieldId: string) => {
    setProviderErrors(prev => {
      if (!(fieldId in prev)) return prev
      const next = { ...prev }
      delete next[fieldId]
      return next
    })
  }, [])

  const groups = React.useMemo<CrudFormGroup[]>(() => {
    const baseGroups = buildPaymentLinkFormGroups(t)

    const providerFieldsGroup: CrudFormGroup = {
      id: 'providerFields',
      column: 2,
      bare: true,
      component: ({ values, setValue }) => (
        <ProviderInjectedFields
          provider={selectedProvider}
          values={values}
          setValue={setValue}
          errors={providerErrors}
          onFieldChange={handleProviderFieldChange}
          onValueCapture={(fieldId, value) => { providerValuesRef.current[fieldId] = value }}
          onFieldsResolved={(providerKey, resolvedFields) => {
            if (providerKey !== currentProviderKey) return
            providerFieldsRef.current = resolvedFields
          }}
        />
      ),
    }

    const previewGroup: CrudFormGroup = {
      id: 'preview',
      column: 2,
      bare: true,
      component: () => (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => {
            openPreviewAfterCreateRef.current = true
            const form = document.getElementById(paymentLinkFormId) as HTMLFormElement | null
            form?.requestSubmit()
          }}
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          {t('payment_link_pages.create.createAndPreview', 'Create & Open Preview')}
        </Button>
      ),
    }

    // Insert provider fields at the beginning of column 2 groups (before custom-fields)
    const customFieldsIdx = baseGroups.findIndex(g => g.id === 'custom-fields')
    const withProvider = [...baseGroups]
    withProvider.splice(customFieldsIdx >= 0 ? customFieldsIdx : baseGroups.length, 0, providerFieldsGroup)

    return [...withProvider, previewGroup]
  }, [t, selectedProvider, currentProviderKey, providerErrors, handleProviderFieldChange])

  const handleSubmit = React.useCallback(async (values: PaymentLinkCreateFormValues) => {
    const pValues = providerValuesRef.current

    const fieldErrors: Record<string, string> = {}
    for (const field of providerFieldsRef.current) {
      if (field.required) {
        const fieldValue = pValues[field.id]
        if (fieldValue == null || fieldValue === '' || fieldValue === undefined) {
          fieldErrors[field.id] = t('ui.forms.fieldRequired', 'This field is required')
        }
      }
    }
    if (Object.keys(fieldErrors).length > 0) {
      setProviderErrors(fieldErrors)
      throw createCrudFormError(t('payment_link_pages.create.providerFieldsRequired', 'Please fill in all required provider settings'))
    }

    const providerInput = providerFieldsRef.current.reduce<Record<string, unknown>>((acc, field) => {
      if (field.id in pValues) acc[field.id] = pValues[field.id]
      return acc
    }, {})

    const sessionPayload = {
      ...paymentLinkFormToSessionPayload(values),
      providerInput,
    }

    const call = await apiCallOrThrow<{ transactionId: string; paymentLinkUrl?: string | null }>(
      '/api/payment_gateways/sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sessionPayload),
      },
      { errorMessage: t('payment_link_pages.create.error', 'Failed to create payment link') },
    )

    if (!call.result) {
      throw createCrudFormError(t('payment_link_pages.create.error', 'Failed to create payment link'))
    }

    if (values.saveAsTemplate && values.templateName?.trim()) {
      try {
        const templatePayload = paymentLinkFormToTemplatePayload(values)
        await apiCallOrThrow('/api/payment_link_pages/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(templatePayload),
        })
        flash(t('payment_link_pages.create.templateSaved', 'Template saved'), 'success')
      } catch {
        flash(t('payment_link_pages.create.templateSaveError', 'Template could not be saved, but the payment link was created'), 'error')
      }
    }

    if (openPreviewAfterCreateRef.current && call.result.paymentLinkUrl) {
      window.open(call.result.paymentLinkUrl, '_blank')
      openPreviewAfterCreateRef.current = false
    }

    flash(t('payment_link_pages.create.success', 'Payment link created successfully'), 'success')
    router.push('/backend/payment-links')
  }, [router, t])

  return (
    <Page>
      <PageBody>
        <CrudForm<PaymentLinkCreateFormValues>
          key={formResetKey}
          formId={paymentLinkFormId}
          title={t('payment_link_pages.create.title', 'Create Payment Link')}
          backHref="/backend/payment-links"
          cancelHref="/backend/payment-links"
          schema={paymentLinkCreateSchema}
          fields={fields}
          groups={groups}
          twoColumn
          initialValues={initialValues}
          isLoading={loadingProviders || loadingCurrencies}
          loadingMessage={t('ui.forms.loading', 'Loading data...')}
          entityIds={[PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID]}
          customFieldsetBindings={{ [PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID]: { valueKey: 'customFieldsetCode' } }}
          submitLabel={t('payment_link_pages.create.submit', 'Create Payment Link')}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
