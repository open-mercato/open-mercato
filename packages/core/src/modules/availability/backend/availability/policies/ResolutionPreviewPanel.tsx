"use client"
import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { reportTelemetryError } from '@open-mercato/shared/lib/telemetry/runtime'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'

type FieldTrace = { value: unknown; policySourceId: string | null }
export type PolicyTrace = Record<string, FieldTrace>

type ResponsePayload = { policyTrace?: PolicyTrace; error?: string }

const TRACE_FIELDS: Array<{ key: string; labelKey: string }> = [
  { key: 'isStockManaged', labelKey: 'availability.policies.form.field.isStockManaged' },
  { key: 'allowBackorder', labelKey: 'availability.policies.form.field.allowBackorder' },
  { key: 'backorderLeadTimeDays', labelKey: 'availability.policies.form.field.backorderLeadTimeDays' },
  { key: 'preorderReleaseAt', labelKey: 'availability.policies.form.field.preorderReleaseAt' },
  { key: 'lowStockThreshold', labelKey: 'availability.policies.form.field.lowStockThreshold' },
  { key: 'minOrderQuantity', labelKey: 'availability.policies.form.field.minOrderQuantity' },
  { key: 'maxOrderQuantity', labelKey: 'availability.policies.form.field.maxOrderQuantity' },
  { key: 'quantityIncrement', labelKey: 'availability.policies.form.field.quantityIncrement' },
  { key: 'hideWhenOutOfStock', labelKey: 'availability.policies.form.field.hideWhenOutOfStock' },
  { key: 'isActive', labelKey: 'availability.policies.form.field.isActive' },
]

function formatValue(value: unknown, t: (key: string) => string): string {
  if (value === null || value === undefined) return t('availability.policies.form.preview.notSet')
  if (typeof value === 'boolean') return value ? t('availability.common.yes') : t('availability.common.no')
  return String(value)
}

/**
 * Live "resolution-chain preview" — US-A2. Shows the currently PERSISTED
 * resolution for the (product, variant, store) target the admin is editing,
 * refetched (debounced) whenever the target changes. Does not simulate the
 * in-progress, unsaved field edits — see PLAN.md § Key design decisions.
 */
export function ResolutionPreviewPanel({
  productId,
  variantId,
  storeId,
  onTraceChange,
}: {
  productId: string
  variantId: string | null
  storeId: string | null
  onTraceChange?: (trace: PolicyTrace | null) => void
}) {
  const t = useT()
  const [trace, setTrace] = React.useState<PolicyTrace | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const onTraceChangeRef = React.useRef(onTraceChange)
  onTraceChangeRef.current = onTraceChange

  React.useEffect(() => {
    onTraceChangeRef.current?.(trace)
  }, [trace])

  React.useEffect(() => {
    setTrace(null)
    setError(null)
    setIsLoading(Boolean(productId))
    if (!productId) return
    let cancelled = false
    const handle = setTimeout(() => {
      const params = new URLSearchParams({ productId })
      if (variantId) params.set('variantId', variantId)
      if (storeId) params.set('storeId', storeId)
      apiCall<ResponsePayload>(`/api/availability/policies/resolve-preview?${params.toString()}`, undefined, { fallback: null })
        .then((call) => {
          if (cancelled) return
          if (!call.ok) {
            setError(typeof call.result?.error === 'string' && call.result.error.trim()
              ? call.result.error
              : t('availability.policies.form.preview.failed'))
            return
          }
          setTrace(call.result?.policyTrace ?? null)
        })
        .catch((error: unknown) => {
          if (cancelled) return
          reportTelemetryError(error, { module: 'availability', code: 'availability.preview_request_failed' })
          setError(t('availability.policies.form.preview.failed'))
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false)
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [productId, variantId, storeId, t])

  if (!productId) {
    return (
      <div className="rounded-md border bg-muted p-4 text-sm text-muted-foreground" data-testid="availability-resolution-preview">
        {t('availability.policies.form.preview.enterProduct')}
      </div>
    )
  }

  return (
    <div className="rounded-md border bg-muted p-4 text-sm" data-testid="availability-resolution-preview">
      <div className="mb-2 font-medium">{t('availability.policies.form.preview.title')}</div>
      {isLoading ? (
        <LoadingMessage label={t('availability.common.loading')} />
      ) : error ? (
        <ErrorMessage label={error} />
      ) : (
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {TRACE_FIELDS.map(({ key, labelKey }) => {
            const field = trace?.[key]
            const source = field?.policySourceId ?? t('availability.policies.form.preview.moduleDefault')
            return (
              <div key={key}>
                <dt className="text-xs text-muted-foreground">{t(labelKey)}</dt>
                <dd className="text-xs">
                  {formatValue(field?.value, t)}{' '}
                  <span className="text-muted-foreground">({source})</span>
                </dd>
              </div>
            )
          })}
        </dl>
      )}
    </div>
  )
}
