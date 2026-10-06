'use client'

import * as React from 'react'
import { CrudForm, type CrudCustomFieldRenderProps, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ECOMMERCE_BRANDING_FONTS } from '../lib/brandingStyles'
import { BrandingColorInput, BrandingRadiusSlider } from './StoreBrandingControls'
import { StoreBrandingPreview } from './StoreBrandingPreview'
import {
  BRANDING_COLOR_KEYS,
  BRANDING_FONT_INHERIT,
  STORE_BRANDING_API_PATH,
  buildStoreBrandingInitialValues,
  buildStoreBrandingPayload,
  storeBrandingFormSchema,
  type StoreBrandingFormValues,
} from './storeBrandingForm'
import type { StoreAdminRecord } from './storeAdmin'
import { useStoreAccess } from './useStoreAccess'

type StoreBrandingTabProps = {
  store: StoreAdminRecord
  reload: () => Promise<void>
}

const COLOR_LABELS: Record<(typeof BRANDING_COLOR_KEYS)[number], { key: string; fallback: string }> = {
  primaryColor: { key: 'ecommerce.backend.store.branding.primaryColor', fallback: 'Primary colour' },
  primaryForeground: { key: 'ecommerce.backend.store.branding.primaryForeground', fallback: 'Text on primary' },
  accentColor: { key: 'ecommerce.backend.store.branding.accentColor', fallback: 'Accent colour' },
  accentForeground: { key: 'ecommerce.backend.store.branding.accentForeground', fallback: 'Text on accent' },
  backgroundColor: { key: 'ecommerce.backend.store.branding.backgroundColor', fallback: 'Background colour' },
  foregroundColor: { key: 'ecommerce.backend.store.branding.foregroundColor', fallback: 'Text colour' },
}

const SYSTEM_FONT_LABELS: Record<string, { key: string; fallback: string }> = {
  'system-sans': { key: 'ecommerce.backend.store.branding.font.systemSans', fallback: 'System sans-serif' },
  'system-serif': { key: 'ecommerce.backend.store.branding.font.systemSerif', fallback: 'System serif' },
  'system-mono': { key: 'ecommerce.backend.store.branding.font.systemMono', fallback: 'System monospace' },
}

export function StoreBrandingTab({ store, reload }: StoreBrandingTabProps) {
  const t = useT()
  const { canManageBranding } = useStoreAccess()
  const [formKey, setFormKey] = React.useState(0)

  const fontOptions = React.useMemo(
    () =>
      ECOMMERCE_BRANDING_FONTS.map((font) => {
        const system = SYSTEM_FONT_LABELS[font.id]
        return { value: font.id, label: system ? t(system.key, system.fallback) : font.label }
      }),
    [t],
  )

  const fields = React.useMemo<CrudField[]>(() => {
    const colorFields: CrudField[] = BRANDING_COLOR_KEYS.map((key) => ({
      id: key,
      type: 'custom',
      label: t(COLOR_LABELS[key].key, COLOR_LABELS[key].fallback),
      layout: 'half',
      disabled: !canManageBranding,
      component: (props: CrudCustomFieldRenderProps) => (
        <BrandingColorInput
          id={props.id}
          value={props.value}
          error={props.error}
          disabled={props.disabled || !canManageBranding}
          setValue={props.setValue}
        />
      ),
    }))
    return [
      ...colorFields,
      {
        id: 'borderRadius',
        type: 'custom',
        label: t('ecommerce.backend.store.branding.radius', 'Corner radius'),
        description: t(
          'ecommerce.backend.store.branding.radiusHint',
          'How rounded buttons, cards and inputs are, from square (0) to 5rem.',
        ),
        disabled: !canManageBranding,
        component: (props: CrudCustomFieldRenderProps) => (
          <BrandingRadiusSlider
            id={props.id}
            value={props.value}
            error={props.error}
            disabled={props.disabled || !canManageBranding}
            setValue={props.setValue}
          />
        ),
      },
      {
        id: 'fontFamilyBase',
        type: 'select',
        label: t('ecommerce.backend.store.branding.fontBase', 'Body font'),
        options: fontOptions,
        layout: 'half',
        disabled: !canManageBranding,
      },
      {
        id: 'fontFamilyHeading',
        type: 'select',
        label: t('ecommerce.backend.store.branding.fontHeading', 'Heading font'),
        options: [
          { value: BRANDING_FONT_INHERIT, label: t('ecommerce.backend.store.branding.fontInherit', 'Same as body font') },
          ...fontOptions,
        ],
        layout: 'half',
        disabled: !canManageBranding,
      },
      {
        id: 'logoUrl',
        type: 'text',
        label: t('ecommerce.backend.store.branding.logoUrl', 'Logo URL'),
        description: t(
          'ecommerce.backend.store.branding.assetUrlHint',
          'An http(s) address or a path starting with /. Leave empty for none.',
        ),
        maxLength: 2048,
        disabled: !canManageBranding,
      },
      {
        id: 'faviconUrl',
        type: 'text',
        label: t('ecommerce.backend.store.branding.faviconUrl', 'Favicon URL'),
        description: t(
          'ecommerce.backend.store.branding.assetUrlHint',
          'An http(s) address or a path starting with /. Leave empty for none.',
        ),
        maxLength: 2048,
        disabled: !canManageBranding,
      },
    ]
  }, [canManageBranding, fontOptions, t])

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'colours',
        title: t('ecommerce.backend.store.branding.coloursTitle', 'Colours'),
        column: 1,
        fields: [...BRANDING_COLOR_KEYS],
      },
      {
        id: 'style',
        title: t('ecommerce.backend.store.branding.styleTitle', 'Shape and typography'),
        column: 1,
        fields: ['borderRadius', 'fontFamilyBase', 'fontFamilyHeading'],
      },
      {
        id: 'assets',
        title: t('ecommerce.backend.store.branding.assetsTitle', 'Logo and favicon'),
        column: 1,
        fields: ['logoUrl', 'faviconUrl'],
      },
      {
        id: 'preview',
        title: t('ecommerce.backend.store.branding.preview.groupTitle', 'Live preview'),
        column: 2,
        component: ({ values }) => (
          <StoreBrandingPreview values={values} storeName={store.name} currencyCode={store.defaultCurrencyCode} />
        ),
      },
    ],
    [store.defaultCurrencyCode, store.name, t],
  )

  const initialValues = React.useMemo(() => buildStoreBrandingInitialValues(store), [store])

  const handleSubmit = React.useCallback(
    async (values: StoreBrandingFormValues) => {
      const payload = buildStoreBrandingPayload(values, store)
      const call = await apiCall(STORE_BRANDING_API_PATH(store.id), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!call.ok) {
        await raiseCrudError(call.response, t('ecommerce.backend.store.branding.errors.save', 'Failed to save the branding.'))
      }
      flash(t('ecommerce.backend.store.branding.flash.saved', 'Branding saved'), 'success')
      await reload()
    },
    [reload, store, t],
  )

  const resetForm = React.useCallback(() => setFormKey((current) => current + 1), [])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      resetForm()
    },
    [resetForm],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('ecommerce.backend.store.branding.title', 'Branding')}</CardTitle>
        <CardDescription>
          {t(
            'ecommerce.backend.store.branding.description',
            'The colours, corner radius, fonts and logo your storefront uses. Empty values use the defaults shown.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canManageBranding ? null : (
          <Alert status="information">
            <AlertDescription>
              {t(
                'ecommerce.backend.store.branding.readOnly',
                'You can view this branding but not change it. Changing it requires permission to manage store branding.',
              )}
            </AlertDescription>
          </Alert>
        )}
        <div onKeyDown={handleKeyDown}>
          <CrudForm<StoreBrandingFormValues>
            key={`${formKey}:${store.updatedAt ?? 'new'}`}
            schema={storeBrandingFormSchema}
            fields={fields}
            groups={groups}
            initialValues={initialValues}
            optimisticLockUpdatedAt={store.updatedAt}
            submitLabel={t('ecommerce.backend.store.branding.save', 'Save branding')}
            onSubmit={handleSubmit}
            extraActions={
              <Button type="button" variant="outline" onClick={resetForm}>
                {t('ui.forms.actions.cancel', 'Cancel')}
              </Button>
            }
            hideFooterActions={!canManageBranding}
            embedded
          />
        </div>
      </CardContent>
    </Card>
  )
}
