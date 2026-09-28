"use client"
import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type AvailabilityState = 'in_stock' | 'low_stock' | 'out_of_stock' | 'backorder' | 'preorder' | 'not_tracked'

type AvailabilityItemResult = {
  state: AvailabilityState
  availableQuantity: number | null
  canFulfil: boolean
  leadTimeDays: number | null
  releaseAt: string | null
  isAuthoritative: boolean
  policySourceId: string | null
}

type FieldTrace = { value: unknown; policySourceId: string | null }
type PolicyTrace = Record<string, FieldTrace>

type CheckResponse = {
  availability?: AvailabilityItemResult | null
  policyTrace?: PolicyTrace | null
  error?: string
}

const STATE_VARIANTS: Record<AvailabilityState, StatusBadgeVariant> = {
  in_stock: 'success',
  low_stock: 'warning',
  out_of_stock: 'error',
  backorder: 'info',
  preorder: 'info',
  not_tracked: 'neutral',
}

const TRACE_FIELDS = [
  'isStockManaged',
  'allowBackorder',
  'backorderLeadTimeDays',
  'preorderReleaseAt',
  'lowStockThreshold',
  'minOrderQuantity',
  'maxOrderQuantity',
  'quantityIncrement',
  'hideWhenOutOfStock',
  'isActive',
]

function formatTraceValue(value: unknown, t: (key: string) => string): string {
  if (value === null || value === undefined) return t('availability.policies.form.preview.notSet')
  if (typeof value === 'boolean') return value ? t('common.yes') : t('common.no')
  return String(value)
}

export default function AvailabilityCheckPage() {
  const t = useT()
  const [productId, setProductId] = React.useState('')
  const [variantId, setVariantId] = React.useState('')
  const [storeId, setStoreId] = React.useState('')
  const [quantity, setQuantity] = React.useState('1')
  const [isRunning, setIsRunning] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<CheckResponse | null>(null)

  const runCheck = React.useCallback(async () => {
    if (!productId.trim()) {
      setError(t('availability.check.errors.productRequired'))
      return
    }
    setIsRunning(true)
    setError(null)
    setResult(null)
    try {
      const call = await apiCall<CheckResponse>(
        '/api/availability/check',
        {
          method: 'POST',
          body: JSON.stringify({
            productId: productId.trim(),
            variantId: variantId.trim() || null,
            storeId: storeId.trim() || null,
            quantity: Number(quantity) > 0 ? Number(quantity) : 1,
          }),
        },
        { fallback: null },
      )
      if (!call.ok) {
        const errorPayload = call.result as { error?: string } | undefined
        setError(typeof errorPayload?.error === 'string' ? errorPayload.error : t('availability.check.errors.failed'))
        return
      }
      setResult(call.result ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('availability.check.errors.failed'))
    } finally {
      setIsRunning(false)
    }
  }, [productId, variantId, storeId, quantity, t])

  const availability = result?.availability ?? null
  const policyTrace = result?.policyTrace ?? null

  return (
    <Page>
      <PageBody>
        <div
          className="space-y-6"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void runCheck()
            }
          }}
        >
          <h1 className="text-xl font-semibold">{t('availability.check.title')}</h1>
          <div className="grid grid-cols-1 gap-4 rounded-md border p-4 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="availability-check-product-id">{t('availability.policies.form.field.productId')}</Label>
              <Input
                id="availability-check-product-id"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="availability-check-variant-id">{t('availability.policies.form.field.variantId')}</Label>
              <Input id="availability-check-variant-id" value={variantId} onChange={(e) => setVariantId(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="availability-check-store-id">{t('availability.policies.form.field.storeId')}</Label>
              <Input id="availability-check-store-id" value={storeId} onChange={(e) => setStoreId(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="availability-check-quantity">{t('availability.check.field.quantity')}</Label>
              <Input
                id="availability-check-quantity"
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
          </div>
          <Button onClick={() => void runCheck()} disabled={isRunning}>
            {isRunning ? t('availability.check.action.running') : t('availability.check.action.run')}
          </Button>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" data-testid="availability-check-error">
              {error}
            </div>
          )}

          {availability && (
            <div className="space-y-4 rounded-md border p-4" data-testid="availability-check-result">
              <div className="flex items-center gap-3">
                <StatusBadge variant={STATE_VARIANTS[availability.state]}>{t(`availability.states.${availability.state}`)}</StatusBadge>
                {!availability.isAuthoritative && (
                  <span className="text-xs text-muted-foreground">{t('availability.check.advisoryNote')}</span>
                )}
              </div>
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">{t('availability.check.result.availableQuantity')}</dt>
                  <dd className="text-sm">{availability.availableQuantity ?? t('availability.policies.form.preview.notSet')}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('availability.check.result.canFulfil')}</dt>
                  <dd className="text-sm">{availability.canFulfil ? t('common.yes') : t('common.no')}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('availability.check.result.policySourceId')}</dt>
                  <dd className="text-sm">{availability.policySourceId ?? t('availability.policies.form.preview.moduleDefault')}</dd>
                </div>
                {availability.leadTimeDays != null && (
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('availability.policies.form.field.backorderLeadTimeDays')}</dt>
                    <dd className="text-sm">{availability.leadTimeDays}</dd>
                  </div>
                )}
                {availability.releaseAt && (
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('availability.policies.form.field.preorderReleaseAt')}</dt>
                    <dd className="text-sm">{availability.releaseAt}</dd>
                  </div>
                )}
              </dl>
              {availability.state === 'not_tracked' && (
                <p className="text-xs text-muted-foreground">{t('availability.check.notTrackedExplanation')}</p>
              )}
            </div>
          )}

          {policyTrace && (
            <div className="rounded-md border bg-muted p-4" data-testid="availability-check-policy-trace">
              <div className="mb-2 text-sm font-medium">{t('availability.policies.form.preview.title')}</div>
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {TRACE_FIELDS.map((key) => {
                  const field = policyTrace[key]
                  const source = field?.policySourceId ?? t('availability.policies.form.preview.moduleDefault')
                  return (
                    <div key={key}>
                      <dt className="text-xs text-muted-foreground">{t(`availability.policies.form.field.${key}`)}</dt>
                      <dd className="text-xs">
                        {formatTraceValue(field?.value, t)} <span className="text-muted-foreground">({source})</span>
                      </dd>
                    </div>
                  )
                })}
              </dl>
            </div>
          )}
        </div>
      </PageBody>
    </Page>
  )
}
