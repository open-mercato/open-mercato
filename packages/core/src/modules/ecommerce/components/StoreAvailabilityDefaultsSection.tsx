'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError, raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AVAILABILITY_POLICIES_API_PATH, AVAILABILITY_POLICIES_API_URL, type StoreAdminRecord } from './storeAdmin'
import {
  availabilityDefaultsFormSchema,
  buildAvailabilityCreatePayload,
  buildAvailabilityInitialValues,
  buildAvailabilityUpdatePayload,
  isStoreDefaultPolicy,
  type AvailabilityDefaultsFormValues,
  type PolicyListResponse,
  type StoreDefaultPolicy,
} from './storeGeneral'
import { useStoreAccess } from './useStoreAccess'

const POLICY_PAGE_SIZE = 100

type Translate = (key: string, fallback?: string) => string

export async function fetchStoreDefaultPolicy(storeId: string, translate: Translate): Promise<StoreDefaultPolicy | null> {
  for (let page = 1; ; page += 1) {
    const params = new URLSearchParams({
      storeId,
      page: String(page),
      pageSize: String(POLICY_PAGE_SIZE),
      sortField: 'createdAt',
      sortDir: 'asc',
    })
    const call = await apiCall<PolicyListResponse>(`${AVAILABILITY_POLICIES_API_URL}?${params.toString()}`, {
      cache: 'no-store',
    })
    if (!call.ok) {
      await raiseCrudError(
        call.response,
        translate('ecommerce.backend.store.availability.errors.load', 'Failed to load the availability defaults.'),
      )
    }
    const match = (call.result?.items ?? []).find((item) => isStoreDefaultPolicy(item, storeId))
    if (match) return match
    if (page >= (call.result?.totalPages ?? 1)) return null
  }
}

type StoreAvailabilityDefaultsSectionProps = {
  store: StoreAdminRecord
}

export function StoreAvailabilityDefaultsSection({ store }: StoreAvailabilityDefaultsSectionProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const { canManage, canViewAvailability, canManageAvailability } = useStoreAccess()
  const queryKey = React.useMemo(() => ['ecommerce', 'stores', 'availability-default', store.id], [store.id])
  const [formKey, setFormKey] = React.useState(0)

  const policyQuery = useQuery({
    queryKey,
    enabled: canViewAvailability,
    queryFn: async () => ({ policy: await fetchStoreDefaultPolicy(store.id, t) }),
  })

  const editable = canManage && canManageAvailability
  const policy = policyQuery.data?.policy ?? null

  const readOnlyReason = React.useMemo(() => {
    if (!canViewAvailability) {
      return t(
        'ecommerce.backend.store.availability.readOnly.noView',
        'You do not have access to availability policies, so the store defaults cannot be shown.',
      )
    }
    if (!canManage) {
      return t(
        'ecommerce.backend.store.availability.readOnly.noStoreManage',
        'You can view these defaults but not change them. Changing them requires permission to manage stores.',
      )
    }
    if (!canManageAvailability) {
      return t(
        'ecommerce.backend.store.availability.readOnly.noAvailabilityManage',
        'You can view these defaults but not change them. Saving them requires permission to manage availability policies.',
      )
    }
    return null
  }, [canManage, canManageAvailability, canViewAvailability, t])

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'hideWhenOutOfStock',
        type: 'checkbox',
        label: t('ecommerce.backend.store.availability.hideWhenOutOfStock', 'Hide out-of-stock products'),
        description: t(
          'ecommerce.backend.store.availability.hideWhenOutOfStockHint',
          'Products with no stock left are not shown in this store.',
        ),
        disabled: !editable,
      },
      {
        id: 'allowBackorder',
        type: 'checkbox',
        label: t('ecommerce.backend.store.availability.allowBackorder', 'Allow backorders'),
        description: t(
          'ecommerce.backend.store.availability.allowBackorderHint',
          'Shoppers can order products that are out of stock.',
        ),
        disabled: !editable,
      },
      {
        id: 'backorderLeadTimeDays',
        type: 'number',
        label: t('ecommerce.backend.store.availability.leadTime', 'Backorder lead time (days)'),
        description: t(
          'ecommerce.backend.store.availability.leadTimeHint',
          'How many days a backordered product takes to ship. Required while backorders are allowed.',
        ),
        visibleWhen: { field: 'allowBackorder', equals: true },
        disabled: !editable,
        layout: 'half',
      },
    ],
    [editable, t],
  )

  const initialValues = React.useMemo(() => buildAvailabilityInitialValues(policy), [policy])

  const refresh = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey })
    setFormKey((current) => current + 1)
  }, [queryClient, queryKey])

  const handleSubmit = React.useCallback(
    async (values: AvailabilityDefaultsFormValues) => {
      const errorMessage = t('ecommerce.backend.store.availability.errors.save', 'Failed to save the availability defaults.')
      if (policy) {
        await updateCrud(AVAILABILITY_POLICIES_API_PATH, buildAvailabilityUpdatePayload(policy.id, values), { errorMessage })
      } else {
        const payload = buildAvailabilityCreatePayload(store, values)
        if (!payload) throw createCrudFormError(errorMessage)
        await createCrud(AVAILABILITY_POLICIES_API_PATH, payload, { errorMessage })
      }
      flash(t('ecommerce.backend.store.availability.flash.saved', 'Availability defaults saved'), 'success')
      await refresh()
    },
    [policy, refresh, store, t],
  )

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    setFormKey((current) => current + 1)
  }, [])

  const renderBody = () => {
    if (!canViewAvailability) return null
    if (policyQuery.isLoading) {
      return <LoadingMessage label={t('ecommerce.backend.store.availability.loading', 'Loading availability defaults...')} />
    }
    if (policyQuery.isError) {
      return (
        <ErrorMessage
          label={t('ecommerce.backend.store.availability.errors.load', 'Failed to load the availability defaults.')}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => void policyQuery.refetch()}>
              {t('common.retry', 'Retry')}
            </Button>
          }
        />
      )
    }
    return (
      <div onKeyDown={handleKeyDown}>
        <CrudForm<AvailabilityDefaultsFormValues>
          key={`${formKey}:${policy?.updatedAt ?? 'new'}`}
          schema={availabilityDefaultsFormSchema}
          fields={fields}
          initialValues={initialValues}
          optimisticLockUpdatedAt={policy?.updatedAt ?? null}
          submitLabel={t('ecommerce.backend.store.availability.save', 'Save availability defaults')}
          onSubmit={handleSubmit}
          hideFooterActions={!editable}
          embedded
        />
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('ecommerce.backend.store.availability.title', 'Availability defaults')}</CardTitle>
        <CardDescription>
          {t(
            'ecommerce.backend.store.availability.description',
            'Default stock rules for every product in this store. A policy set on a product or variant overrides these defaults, so those policies only need to describe exceptions.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {readOnlyReason ? (
          <Alert status="information">
            <AlertDescription>{readOnlyReason}</AlertDescription>
          </Alert>
        ) : null}
        {renderBody()}
      </CardContent>
    </Card>
  )
}
