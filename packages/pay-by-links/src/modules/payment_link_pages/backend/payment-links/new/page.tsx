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
}: {
  provider: ProviderItem | null
  values: Record<string, unknown>
  setValue: (id: string, value: unknown) => void
  onFieldsResolved: (providerKey: string, fields: InjectionFieldDefinition[]) => void
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
          <div className="grid gap-4 sm:grid-cols-2">
            {providerFields.map(field => (
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
  const [formResetKey, setFormResetKey] = React.useState(0)
  const [initialValues, setInitialValues] = React.useState<Partial<PaymentLinkCreateFormValues>>({})
  const logoSetValueRef = React.useRef<((url: string) => void) | null>(null)
  const openPreviewAfterCreateRef = React.useRef(false)
  const paymentLinkFormId = 'create-payment-link-form'

  const handleLogoFileSelect = React.useCallback(async (file: File) => {
    const fd = new FormData()
    fd.set('file', file)
    fd.set('entityId', 'payment_link_pages:branding')
    fd.set('recordId', 'logo-upload')
    try {
      const call = await apiCallOrThrow<{ item?: { url?: string } }>('/api/attachments', {
        method: 'POST',
        body: fd,
      })
      const url = call.result?.item?.url
      if (url) {
        setInitialValues(prev => ({ ...prev, brandingLogoUrl: url }))
        setFormResetKey(k => k + 1)
        flash(t('payment_link_pages.create.branding.logoUploaded', 'Logo uploaded'), 'success')
      }
    } catch {
      flash(t('payment_link_pages.create.branding.logoUploadError', 'Failed to upload logo'), 'error')
    }
  }, [t])

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
      setInitialValues(prev => ({
        ...prev,
        templateId,
        brandingLogoUrl: templateValues.brandingLogoUrl,
        brandingBrandName: templateValues.brandingBrandName,
        brandingSecuritySubtitle: templateValues.brandingSecuritySubtitle,
        brandingAccentColor: templateValues.brandingAccentColor,
        brandingCustomCss: templateValues.brandingCustomCss,
        defaultTitle: templateValues.defaultTitle,
        defaultDescription: templateValues.defaultDescription,
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
        customerCaptureTermsRequired: templateValues.customerCaptureTermsRequired,
        customerCaptureTermsMarkdown: templateValues.customerCaptureTermsMarkdown,
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
    onLogoFileSelect: handleLogoFileSelect,
  }), [t, providers, currencies, templates, loadingProviders, loadingCurrencies, loadingTemplates, handleTemplateSelect, handleLogoFileSelect])

  const groups = React.useMemo<CrudFormGroup[]>(() => {
    const baseGroups = buildPaymentLinkFormGroups(t)

    const providerFieldsGroup: CrudFormGroup = {
      id: 'providerFields',
      bare: true,
      component: ({ values, setValue }) => (
        <ProviderInjectedFields
          provider={selectedProvider}
          values={values}
          setValue={setValue}
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

    const paymentIdx = baseGroups.findIndex(g => g.id === 'payment')
    const withProvider = [...baseGroups]
    withProvider.splice(paymentIdx + 1, 0, providerFieldsGroup)

    return [...withProvider, previewGroup]
  }, [t, selectedProvider, currentProviderKey])

  const handleSubmit = React.useCallback(async (values: PaymentLinkCreateFormValues) => {
    const formValues = values as Record<string, unknown>
    const providerInput = providerFieldsRef.current.reduce<Record<string, unknown>>((acc, field) => {
      if (field.id in formValues) acc[field.id] = formValues[field.id]
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
          submitLabel={t('payment_link_pages.create.submit', 'Create Payment Link')}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
