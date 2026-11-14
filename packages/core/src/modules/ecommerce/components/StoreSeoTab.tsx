'use client'

import * as React from 'react'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError, type CrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { STORES_API_PATH, type StoreAdminRecord } from './storeAdmin'
import {
  buildStoreSeoInitialValues,
  buildStoreSeoPayload,
  remapStoreSeoFieldErrors,
  STORE_SEO_FIELD_LIMITS,
  storeSeoFormSchema,
  type StoreSeoFormValues,
} from './storeSeo'
import { useStoreAccess } from './useStoreAccess'

type StoreSeoTabProps = {
  store: StoreAdminRecord
  reload: () => Promise<void>
}

export function StoreSeoTab({ store, reload }: StoreSeoTabProps) {
  const t = useT()
  const { canManage } = useStoreAccess()
  const [formKey, setFormKey] = React.useState(0)

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'siteName',
        type: 'text',
        label: t('ecommerce.backend.store.seo.siteName', 'Site name'),
        description: t(
          'ecommerce.backend.store.seo.siteNameHint',
          'The name of your store shown in search results and the browser tab.',
        ),
        maxLength: STORE_SEO_FIELD_LIMITS.siteName,
        disabled: !canManage,
      },
      {
        id: 'defaultMetaDescription',
        type: 'textarea',
        label: t('ecommerce.backend.store.seo.defaultMetaDescription', 'Default meta description'),
        description: t(
          'ecommerce.backend.store.seo.defaultMetaDescriptionHint',
          'A short description of your store shown in search results when no product description is available.',
        ),
        maxLength: STORE_SEO_FIELD_LIMITS.defaultMetaDescription,
        disabled: !canManage,
      },
      {
        id: 'googleSiteVerification',
        type: 'text',
        label: t('ecommerce.backend.store.seo.googleSiteVerification', 'Google site verification token'),
        description: t(
          'ecommerce.backend.store.seo.googleSiteVerificationHint',
          'The token provided by Google Search Console to verify site ownership.',
        ),
        maxLength: STORE_SEO_FIELD_LIMITS.googleSiteVerification,
        disabled: !canManage,
      },
      {
        id: 'robotsTxt',
        type: 'textarea',
        label: t('ecommerce.backend.store.seo.robotsTxt', 'robots.txt'),
        description: t(
          'ecommerce.backend.store.seo.robotsTxtHint',
          'Instructions for search engine crawlers on which parts of your store to index.',
        ),
        maxLength: STORE_SEO_FIELD_LIMITS.robotsTxt,
        disabled: !canManage,
      },
    ],
    [canManage, t],
  )

  const initialValues = React.useMemo(() => buildStoreSeoInitialValues(store), [store])

  const handleSubmit = React.useCallback(
    async (values: StoreSeoFormValues) => {
      try {
        await updateCrud(STORES_API_PATH, buildStoreSeoPayload(store.id, values), {
          errorMessage: t('ecommerce.backend.store.seo.errors.save', 'Failed to save the SEO settings.'),
        })
      } catch (error) {
        const failure = error as CrudFormError
        const fieldErrors = remapStoreSeoFieldErrors(failure.fieldErrors)
        if (!fieldErrors) throw error
        throw createCrudFormError(failure.message, fieldErrors, { status: failure.status, details: failure.details })
      }
      flash(t('ecommerce.backend.store.seo.flash.saved', 'SEO settings saved'), 'success')
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
          <CardTitle>{t('ecommerce.backend.store.seo.title', 'Search engine optimization')}</CardTitle>
          <CardDescription>
            {t(
              'ecommerce.backend.store.seo.description',
              'Configure how your store appears in search results and to automated crawlers.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canManage ? null : (
            <Alert status="information">
              <AlertDescription>
                {t(
                  'ecommerce.backend.store.seo.readOnly',
                  'You can view these SEO settings but not change them. Changing them requires permission to manage stores.',
                )}
              </AlertDescription>
            </Alert>
          )}
          <div onKeyDown={handleKeyDown}>
            <CrudForm<StoreSeoFormValues>
              key={`${formKey}:${store.updatedAt ?? 'new'}`}
              schema={storeSeoFormSchema}
              fields={fields}
              initialValues={initialValues}
              optimisticLockUpdatedAt={store.updatedAt}
              submitLabel={t('ecommerce.backend.store.seo.save', 'Save SEO settings')}
              onSubmit={handleSubmit}
              hideFooterActions={!canManage}
              embedded
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
