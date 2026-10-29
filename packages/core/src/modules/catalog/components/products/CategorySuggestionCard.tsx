"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('catalog')

type CategorySuggestion = {
  id: string
  productId: string
  outcome: 'suggested' | 'no_match' | string
  categoryId: string | null
  categoryPathIds: string[]
  confidence: number | null
  levels: Array<{ categoryId: string; probability: number; alternatives: Array<{ categoryId: string; probability: number }> }>
  status: string
  updatedAt: string
  categoryLive?: boolean
}

type SettingsResponse = { available?: boolean; effective?: boolean }
type SuggestResponse = { suggestion?: CategorySuggestion; outcome?: 'error'; code?: string }
type ListResponse = { items?: CategorySuggestion[] }
type AcceptResponse = { suggestion: CategorySuggestion; product: { id: string; categoryIds: string[]; updatedAt: string } }

type CategorySuggestionCardProps = {
  productId: string
  categoryIds: string[]
  initialCategoryIds: string[]
  setValue: (id: string, value: unknown) => void
  resolveCategoryLabel: (id: string) => string
}

function portErrorMessageKey(code: string | undefined): string {
  switch (code) {
    case 'timeout':
      return 'catalog.products.create.organize.aiSuggestion.errors.timeout'
    case 'rate_limited':
      return 'catalog.products.create.organize.aiSuggestion.errors.rateLimited'
    case 'insufficient_credits':
    case 'auth':
      return 'catalog.products.create.organize.aiSuggestion.errors.auth'
    default:
      return 'catalog.products.create.organize.aiSuggestion.errors.generic'
  }
}

export function CategorySuggestionCard({
  productId,
  categoryIds,
  initialCategoryIds,
  setValue,
  resolveCategoryLabel,
}: CategorySuggestionCardProps) {
  const t = useT()
  const { payload, isReady } = useBackendChrome()
  const { runMutation } = useGuardedMutation({ contextId: `catalog.product.category-suggestion.${productId}` })
  const [effective, setEffective] = React.useState<boolean | null>(null)
  const [suggestion, setSuggestion] = React.useState<CategorySuggestion | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [makeMain, setMakeMain] = React.useState(false)

  const canUse = isReady && hasFeature(payload?.grantedFeatures, 'catalog.ai_categorization.use')
  const categoryIdsDirty = JSON.stringify(categoryIds ?? []) !== JSON.stringify(initialCategoryIds ?? [])

  const loadStatus = React.useCallback(async () => {
    try {
      const settings = await readApiResultOrThrow<SettingsResponse>(
        '/api/catalog/ai-categorization/settings',
        undefined,
        { errorMessage: '[internal] failed to load ai categorization settings', fallback: { effective: false } },
      )
      setEffective(settings.effective === true)
    } catch {
      setEffective(false)
    }
  }, [])

  const loadPending = React.useCallback(async () => {
    try {
      const params = new URLSearchParams({ productId, status: 'pending', pageSize: '1' })
      const list = await readApiResultOrThrow<ListResponse>(
        `/api/catalog/category-suggestions?${params.toString()}`,
        undefined,
        { errorMessage: '[internal] failed to load pending category suggestion', fallback: { items: [] } },
      )
      setSuggestion(list.items?.[0] ?? null)
    } catch {
      setSuggestion(null)
    }
  }, [productId])

  React.useEffect(() => {
    void loadStatus()
    void loadPending()
  }, [loadStatus, loadPending])

  const handleSuggest = React.useCallback(async () => {
    setLoading(true)
    try {
      const call = await apiCall<SuggestResponse>(`/api/catalog/products/${productId}/category-suggestion`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      const payload = call.result
      if (!call.ok || !payload) {
        flash(t('catalog.products.create.organize.aiSuggestion.errors.generic', 'AI category suggestion failed. Please try again.'), 'error')
        return
      }
      if (payload.outcome === 'error') {
        flash(t(portErrorMessageKey(payload.code), 'AI category suggestion failed. Please try again.'), 'error')
        return
      }
      setSuggestion(payload.suggestion ?? null)
      if (payload.suggestion?.outcome === 'no_match') {
        flash(t('catalog.products.create.organize.aiSuggestion.noMatch', 'No matching category was found.'), 'success')
      }
    } catch (err) {
      logger.error('catalog.products.create.organize.aiSuggestion.suggest failed', { err })
      flash(t('catalog.products.create.organize.aiSuggestion.errors.generic', 'AI category suggestion failed. Please try again.'), 'error')
    } finally {
      setLoading(false)
    }
  }, [productId, t])

  const handleAccept = React.useCallback(async (categoryId: string, makeMain: boolean) => {
    if (!suggestion) return
    setBusy(true)
    try {
      const result = await runMutation<AcceptResponse>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(suggestion.updatedAt),
          async () => {
            const call = await apiCall<AcceptResponse>(`/api/catalog/category-suggestions/${suggestion.id}/accept`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ categoryId, makeMain }),
            })
            if (!call.ok || !call.result) throw new Error('[internal] accept category suggestion failed')
            return call.result
          },
        ),
        context: { resourceKind: 'catalog.category_suggestion', resourceId: suggestion.id },
      })
      setValue('categoryIds', result.product.categoryIds)
      setValue('updatedAt', result.product.updatedAt)
      setSuggestion(null)
      flash(t('catalog.products.create.organize.aiSuggestion.accepted', 'Category accepted.'), 'success')
    } catch (err) {
      logger.error('catalog.products.create.organize.aiSuggestion.accept failed', { err })
    } finally {
      setBusy(false)
    }
  }, [suggestion, runMutation, setValue, t])

  const handleReject = React.useCallback(async () => {
    if (!suggestion) return
    setBusy(true)
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(suggestion.updatedAt),
          async () => {
            const call = await apiCall(`/api/catalog/category-suggestions/${suggestion.id}/reject`, { method: 'POST' })
            if (!call.ok) throw new Error('[internal] reject category suggestion failed')
            return call.result
          },
        ),
        context: { resourceKind: 'catalog.category_suggestion', resourceId: suggestion.id },
      })
      setSuggestion(null)
      flash(t('catalog.products.create.organize.aiSuggestion.rejected', 'Suggestion rejected.'), 'success')
    } catch (err) {
      logger.error('catalog.products.create.organize.aiSuggestion.reject failed', { err })
    } finally {
      setBusy(false)
    }
  }, [suggestion, runMutation, t])

  if (!isReady || effective === null) return null
  if (!effective || !canUse) return null

  const confidencePercent = suggestion?.confidence != null ? Math.round(suggestion.confidence * 100) : null
  const confidenceTone = confidencePercent !== null && confidencePercent >= 70 ? 'success' : 'warning'
  const hasExistingCategories = Array.isArray(categoryIds) && categoryIds.length > 0
  const parentCategoryId = suggestion && suggestion.categoryPathIds.length > 1
    ? suggestion.categoryPathIds[suggestion.categoryPathIds.length - 2]
    : null

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">
          {t('catalog.products.create.organize.aiSuggestion.title', 'AI category suggestion')}
        </p>
        {!suggestion ? (
          <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => { void handleSuggest() }}>
            {loading ? <Spinner className="h-4 w-4" /> : null}
            {t('catalog.products.create.organize.aiSuggestion.suggestButton', 'Suggest category')}
          </Button>
        ) : null}
      </div>

      {suggestion?.outcome === 'no_match' ? (
        <p className="text-xs text-muted-foreground">
          {t('catalog.products.create.organize.aiSuggestion.noMatch', 'No matching category was found.')}
        </p>
      ) : null}

      {suggestion && suggestion.outcome === 'suggested' ? (
        suggestion.categoryLive === false ? (
          <div className="space-y-2">
            <p className="text-xs text-status-error-text">
              {t('catalog.products.create.organize.aiSuggestion.categoryGone', 'This category no longer exists.')}
            </p>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { void handleReject() }}>
              {t('catalog.products.create.organize.aiSuggestion.reject', 'Reject')}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <span>{suggestion.categoryPathIds.map((id) => resolveCategoryLabel(id)).join(' / ')}</span>
              {confidencePercent !== null ? (
                <span className={`text-xs ${confidenceTone === 'success' ? 'text-status-success-text' : 'text-status-warning-text'}`}>
                  {t('catalog.products.create.organize.aiSuggestion.confidence', '{percent}%', { percent: confidencePercent })}
                </span>
              ) : null}
            </div>
            {suggestion.levels[suggestion.levels.length - 1]?.alternatives?.length ? (
              <p className="text-xs text-muted-foreground">
                {t('catalog.products.create.organize.aiSuggestion.alternatives', 'Alternatives: {labels}', {
                  labels: suggestion.levels[suggestion.levels.length - 1].alternatives
                    .map((alternative) => resolveCategoryLabel(alternative.categoryId))
                    .join(', '),
                })}
              </p>
            ) : null}
            {hasExistingCategories ? (
              <CheckboxField
                label={t('catalog.products.create.organize.aiSuggestion.makeMain', 'Make it the main category')}
                checked={makeMain}
                onCheckedChange={(checked) => setMakeMain(checked === true)}
                id={`category-suggestion-make-main-${suggestion.id}`}
              />
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy || categoryIdsDirty || !suggestion.categoryId}
                onClick={() => { void handleAccept(suggestion.categoryId!, makeMain) }}
              >
                {t('catalog.products.create.organize.aiSuggestion.accept', 'Accept')}
              </Button>
              {parentCategoryId ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || categoryIdsDirty}
                  onClick={() => { void handleAccept(parentCategoryId, makeMain) }}
                >
                  {t('catalog.products.create.organize.aiSuggestion.useParent', 'Use parent instead')}
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { void handleReject() }}>
                {t('catalog.products.create.organize.aiSuggestion.reject', 'Reject')}
              </Button>
            </div>
            {categoryIdsDirty ? (
              <p className="text-xs text-muted-foreground">
                {t('catalog.products.create.organize.aiSuggestion.dirtyHint', 'Save or discard your category changes first.')}
              </p>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  )
}
