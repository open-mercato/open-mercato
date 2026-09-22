"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { hasFeature } from '@open-mercato/shared/security/features'
import { ScopeFields, type PolicyScope } from '../ScopeFields'
import { ResolutionPreviewPanel } from '../ResolutionPreviewPanel'
import { buildPolicyFieldGroups } from '../formGroups'

type PolicyRecord = {
  id: string
  storeId: string | null
  productId: string | null
  variantId: string | null
  isStockManaged: boolean
  allowBackorder: boolean
  backorderLeadTimeDays: number | null
  preorderReleaseAt: string | null
  lowStockThreshold: number | null
  minOrderQuantity: number | null
  maxOrderQuantity: number | null
  quantityIncrement: number | null
  hideWhenOutOfStock: boolean
  isActive: boolean
  updatedAt: string | null
}

type FormValues = {
  isStockManaged?: boolean
  allowBackorder?: boolean
  backorderLeadTimeDays?: number | string | null
  preorderReleaseAt?: string | null
  lowStockThreshold?: number | string | null
  minOrderQuantity?: number | string | null
  maxOrderQuantity?: number | string | null
  quantityIncrement?: number | string | null
  hideWhenOutOfStock?: boolean
  isActive?: boolean
}

function toNullableInt(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export default function AvailabilityPolicyEditPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const id = params?.id ?? ''
  const { payload } = useBackendChrome()
  const canManage = hasFeature(payload?.grantedFeatures, 'availability.policies.manage')

  const [policy, setPolicy] = React.useState<PolicyRecord | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [scope, setScope] = React.useState<PolicyScope>({ productId: '', variantId: '', storeId: '' })

  React.useEffect(() => {
    if (!id) return
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const call = await apiCall<{ items: PolicyRecord[] }>(`/api/availability/policies?id=${encodeURIComponent(id)}`, undefined, {
          fallback: { items: [] },
        })
        if (cancelled) return
        const record = call.ok ? call.result?.items?.[0] ?? null : null
        if (!record) {
          setError(t('availability.policies.edit.notFound'))
          return
        }
        setPolicy(record)
        setScope({ productId: record.productId ?? '', variantId: record.variantId ?? '', storeId: record.storeId ?? '' })
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t('availability.policies.list.error.loadFailed'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, t])

  const groups = React.useMemo(() => buildPolicyFieldGroups(t), [t])

  if (isLoading) return <LoadingMessage label={t('common.loading')} />
  if (error || !policy) return <ErrorMessage label={error ?? t('availability.policies.edit.notFound')} />

  return (
    <CrudForm<FormValues>
      title={t('availability.policies.edit.title')}
      titleHeadingLevel={1}
      backHref="/backend/availability/policies"
      fields={[]}
      groups={groups}
      readOnly={!canManage}
      submitLabel={t('availability.policies.form.action.save')}
      cancelHref="/backend/availability/policies"
      optimisticLockUpdatedAt={policy.updatedAt ?? null}
      initialValues={{
        isStockManaged: policy.isStockManaged,
        allowBackorder: policy.allowBackorder,
        backorderLeadTimeDays: policy.backorderLeadTimeDays,
        preorderReleaseAt: policy.preorderReleaseAt,
        lowStockThreshold: policy.lowStockThreshold,
        minOrderQuantity: policy.minOrderQuantity,
        maxOrderQuantity: policy.maxOrderQuantity,
        quantityIncrement: policy.quantityIncrement,
        hideWhenOutOfStock: policy.hideWhenOutOfStock,
        isActive: policy.isActive,
      }}
      contentHeader={(
        <div className="space-y-4">
          <ScopeFields value={scope} onChange={setScope} disabled={!canManage} />
          <ResolutionPreviewPanel
            productId={scope.productId}
            variantId={scope.variantId || null}
            storeId={scope.storeId || null}
          />
        </div>
      )}
      deleteVisible={canManage}
      onDelete={async () => {
        await deleteCrud('availability/policies', id)
        flash(t('availability.policies.flash.deleted'), 'success')
        router.push('/backend/availability/policies')
      }}
      onSubmit={async (values) => {
        if (scope.variantId && !scope.productId) {
          throw createCrudFormError(
            t('availability.policies.errors.variantRequiresProduct'),
            { productId: t('availability.policies.errors.variantRequiresProduct') },
          )
        }
        if (values.allowBackorder && toNullableInt(values.backorderLeadTimeDays) == null) {
          throw createCrudFormError(
            t('availability.policies.errors.backorderRequiresLeadTime'),
            { backorderLeadTimeDays: t('availability.policies.errors.backorderRequiresLeadTime') },
          )
        }
        const min = toNullableInt(values.minOrderQuantity)
        const max = toNullableInt(values.maxOrderQuantity)
        if (min != null && max != null && max < min) {
          throw createCrudFormError(
            t('availability.policies.errors.maxBelowMin'),
            { maxOrderQuantity: t('availability.policies.errors.maxBelowMin') },
          )
        }

        const payloadBody = {
          id,
          productId: scope.productId || null,
          variantId: scope.variantId || null,
          storeId: scope.storeId || null,
          isStockManaged: !!values.isStockManaged,
          allowBackorder: !!values.allowBackorder,
          backorderLeadTimeDays: toNullableInt(values.backorderLeadTimeDays),
          preorderReleaseAt: values.preorderReleaseAt || null,
          lowStockThreshold: toNullableInt(values.lowStockThreshold),
          minOrderQuantity: min,
          maxOrderQuantity: max,
          quantityIncrement: toNullableInt(values.quantityIncrement),
          hideWhenOutOfStock: !!values.hideWhenOutOfStock,
          isActive: values.isActive !== false,
        }
        await updateCrud('availability/policies', payloadBody)
        flash(t('availability.policies.flash.updated'), 'success')
        router.push('/backend/availability/policies')
      }}
    />
  )
}
