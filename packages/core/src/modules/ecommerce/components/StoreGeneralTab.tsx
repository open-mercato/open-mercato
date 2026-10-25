'use client'

import * as React from 'react'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { STORE_STATUS_LABELS } from './StoreStatusBadge'
import { StoreAvailabilityDefaultsSection } from './StoreAvailabilityDefaultsSection'
import { STORES_API_PATH, type StoreAdminRecord, type StoreStatus } from './storeAdmin'
import {
  buildStoreGeneralInitialValues,
  buildStoreGeneralPayload,
  storeGeneralFormSchema,
  type StoreGeneralFormValues,
} from './storeGeneral'
import { useStoreAccess } from './useStoreAccess'

type StoreGeneralTabProps = {
  store: StoreAdminRecord
  reload: () => Promise<void>
}

function selectableStatuses(current: StoreStatus): StoreStatus[] {
  return current === 'archived' ? ['archived'] : ['draft', 'active']
}

export function StoreGeneralTab({ store, reload }: StoreGeneralTabProps) {
  const t = useT()
  const { canManage } = useStoreAccess()
  const [formKey, setFormKey] = React.useState(0)

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'name',
        type: 'text',
        label: t('ecommerce.backend.stores.form.name', 'Name'),
        required: true,
        maxLength: 200,
        disabled: !canManage,
      },
      {
        id: 'code',
        type: 'text',
        label: t('ecommerce.backend.stores.form.code', 'Code'),
        description: t(
          'ecommerce.backend.stores.form.codeHint',
          'Internal identifier, unique in the workspace. Lowercase letters, digits, dashes and underscores.',
        ),
        required: true,
        maxLength: 80,
        layout: 'half',
        disabled: !canManage,
      },
      {
        id: 'slug',
        type: 'text',
        label: t('ecommerce.backend.stores.form.slug', 'Slug'),
        description: t(
          'ecommerce.backend.stores.form.slugHint',
          'Short name used in store addresses, unique in the workspace. Lowercase letters, digits and dashes.',
        ),
        required: true,
        maxLength: 120,
        layout: 'half',
        disabled: !canManage,
      },
      {
        id: 'status',
        type: 'select',
        label: t('ecommerce.backend.store.general.status', 'Status'),
        description:
          store.status === 'archived'
            ? t('ecommerce.backend.store.general.statusArchivedHint', 'An archived store cannot be unarchived.')
            : t(
                'ecommerce.backend.store.general.statusHint',
                'A draft store does not serve its storefront. Archive a store from the store list.',
              ),
        options: selectableStatuses(store.status).map((value) => ({
          value,
          label: t(STORE_STATUS_LABELS[value].key, STORE_STATUS_LABELS[value].fallback),
        })),
        required: true,
        layout: 'half',
        disabled: !canManage || store.status === 'archived',
      },
      {
        id: 'defaultCurrencyCode',
        type: 'text',
        label: t('ecommerce.backend.stores.form.currency', 'Currency'),
        description: t('ecommerce.backend.stores.form.currencyHint', 'Three-letter ISO code, for example EUR.'),
        placeholder: 'EUR',
        required: true,
        maxLength: 3,
        layout: 'half',
        disabled: !canManage,
      },
      {
        id: 'defaultLocale',
        type: 'text',
        label: t('ecommerce.backend.stores.form.defaultLocale', 'Default language'),
        description: t('ecommerce.backend.stores.form.defaultLocaleHint', 'A language code such as en or pl-PL.'),
        required: true,
        layout: 'half',
        disabled: !canManage,
      },
      {
        id: 'supportedLocales',
        type: 'tags',
        label: t('ecommerce.backend.stores.form.supportedLocales', 'Supported languages'),
        description: t(
          'ecommerce.backend.stores.form.supportedLocalesHint',
          'Languages the store can be shown in. Must include the default language.',
        ),
        required: true,
        disabled: !canManage,
      },
    ],
    [canManage, store.status, t],
  )

  const initialValues = React.useMemo(() => buildStoreGeneralInitialValues(store), [store])

  const handleSubmit = React.useCallback(
    async (values: StoreGeneralFormValues) => {
      await updateCrud(STORES_API_PATH, buildStoreGeneralPayload(store.id, values), {
        errorMessage: t('ecommerce.backend.store.general.errors.save', 'Failed to save the store.'),
      })
      flash(t('ecommerce.backend.store.general.flash.saved', 'Store saved'), 'success')
      await reload()
    },
    [reload, store.id, t],
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
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('ecommerce.backend.store.general.title', 'Identity and localization')}</CardTitle>
          <CardDescription>
            {t(
              'ecommerce.backend.store.general.description',
              'The store name, its identifiers, the languages it is shown in and its currency.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canManage ? null : (
            <Alert status="information">
              <AlertDescription>
                {t(
                  'ecommerce.backend.store.general.readOnly',
                  'You can view this store but not change it. Changing it requires permission to manage stores.',
                )}
              </AlertDescription>
            </Alert>
          )}
          <div onKeyDown={handleKeyDown}>
            <CrudForm<StoreGeneralFormValues>
              key={`${formKey}:${store.updatedAt ?? 'new'}`}
              schema={storeGeneralFormSchema}
              fields={fields}
              initialValues={initialValues}
              optimisticLockUpdatedAt={store.updatedAt}
              submitLabel={t('ecommerce.backend.store.general.save', 'Save changes')}
              onSubmit={handleSubmit}
              hideFooterActions={!canManage}
              embedded
            />
          </div>
        </CardContent>
      </Card>
      <StoreAvailabilityDefaultsSection store={store} />
    </div>
  )
}
