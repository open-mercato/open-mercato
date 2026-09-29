"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { ScopeFields, type PolicyScope } from '../ScopeFields'
import { ResolutionPreviewPanel, type PolicyTrace } from '../ResolutionPreviewPanel'
import { buildPolicyFieldGroups } from '../formGroups'
import { toIsoDateTimeOrNull } from '../policyPayload'
import {
  ResolvedStockManagedContext,
  resolveStockManagedValue,
  withResolvedStockManagedField,
} from '../StockManagedField'

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

export default function AvailabilityPolicyCreatePage() {
  const t = useT()
  const router = useRouter()
  const { organizationId, tenantId } = useOrganizationScopeDetail()
  const [scope, setScope] = React.useState<PolicyScope>({ productId: '', variantId: '', storeId: '' })

  const [resolvedStockManaged, setResolvedStockManaged] = React.useState<boolean | null>(null)

  const groups = React.useMemo(() => withResolvedStockManagedField(buildPolicyFieldGroups(t)), [t])
  const stockManagedContext = React.useMemo(
    () => ({ resolved: resolvedStockManaged, label: t('availability.policies.form.field.isStockManaged') }),
    [resolvedStockManaged, t],
  )
  const handleTraceChange = React.useCallback((trace: PolicyTrace | null) => {
    const value = trace?.isStockManaged?.value
    setResolvedStockManaged(typeof value === 'boolean' ? value : null)
  }, [])

  return (
    <ResolvedStockManagedContext.Provider value={stockManagedContext}>
      <CrudForm<FormValues>
        title={t('availability.policies.create.title')}
        titleHeadingLevel={1}
        backHref="/backend/availability/policies"
        fields={[]}
        groups={groups}
        initialValues={{ isActive: true }}
        submitLabel={t('availability.policies.form.action.create')}
        cancelHref="/backend/availability/policies"
        contentHeader={(
          <div className="space-y-4">
            <ScopeFields value={scope} onChange={setScope} />
            <ResolutionPreviewPanel
              productId={scope.productId}
              variantId={scope.variantId || null}
              storeId={scope.storeId || null}
              onTraceChange={handleTraceChange}
            />
          </div>
        )}
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

          const isStockManaged = resolveStockManagedValue(values.isStockManaged, resolvedStockManaged)
          const payload = {
            organizationId,
            tenantId,
            productId: scope.productId || null,
            variantId: scope.variantId || null,
            storeId: scope.storeId || null,
            ...(isStockManaged === undefined ? {} : { isStockManaged }),
            allowBackorder: !!values.allowBackorder,
            backorderLeadTimeDays: toNullableInt(values.backorderLeadTimeDays),
            preorderReleaseAt: toIsoDateTimeOrNull(values.preorderReleaseAt),
            lowStockThreshold: toNullableInt(values.lowStockThreshold),
            minOrderQuantity: min,
            maxOrderQuantity: max,
            quantityIncrement: toNullableInt(values.quantityIncrement),
            hideWhenOutOfStock: !!values.hideWhenOutOfStock,
            isActive: values.isActive !== false,
          }
          await createCrud('availability/policies', payload)
          flash(t('availability.policies.flash.created'), 'success')
          router.push('/backend/availability/policies')
        }}
      />
    </ResolvedStockManagedContext.Provider>
  )
}
