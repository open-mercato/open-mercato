"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { CatalogProductType } from '../../data/types'
import { useT } from '@/lib/i18n/context'

type CrudValues = Record<string, unknown>

export type SubproductDraft = {
  id: string
  childProductId: string
  childName?: string | null
  relationType: 'bundle' | 'grouped'
  isRequired?: boolean
  minQuantity?: number | null
  maxQuantity?: number | null
}

type ProductResult = {
  id: string
  title?: string | null
  subtitle?: string | null
  sku?: string | null
  handle?: string | null
}

type Props = {
  values: CrudValues
  setValue: (field: string, value: unknown) => void
  productType: CatalogProductType
}

export function ProductSubproductsPanel({ values, setValue, productType }: Props) {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<ProductResult[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const drafts = Array.isArray(values.subproducts)
    ? (values.subproducts as SubproductDraft[])
    : []

  const allowedRelationTypes = React.useMemo(() => {
    if (productType === 'bundle') return ['bundle']
    if (productType === 'grouped') return ['grouped']
    return ['bundle', 'grouped']
  }, [productType])

  React.useEffect(() => {
    let canceled = false
    if (!query.trim()) {
      setResults([])
      return () => {
        canceled = true
      }
    }
    setLoading(true)
    const handle = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          search: query.trim(),
          pageSize: '10',
        })
        const { ok, result } = await apiCall<{ items?: ProductResult[] }>(
          `/api/catalog/products?${params.toString()}`,
        )
        if (canceled) return
        if (ok && Array.isArray(result?.items)) {
          setResults(result.items.filter((item): item is ProductResult => typeof item?.id === 'string'))
          setError(null)
        } else {
          setResults([])
          setError(t('catalog.products.create.subproducts.loadError', 'Unable to load products'))
        }
      } catch (err) {
        if (canceled) return
        setResults([])
        setError(err instanceof Error ? err.message : t('catalog.products.create.subproducts.loadError', 'Unable to load products'))
      } finally {
        if (!canceled) setLoading(false)
      }
    }, 350)
    return () => {
      canceled = true
      window.clearTimeout(handle)
    }
  }, [query, t])

  const updateDrafts = (next: SubproductDraft[]) => {
    setValue('subproducts', next)
  }

  const addSubproduct = (product: ProductResult) => {
    if (!product.id || drafts.some((draft) => draft.childProductId === product.id)) return
    const resolvedName =
      product.title?.trim()
        ? product.title.trim()
        : product.subtitle?.trim()
            ? product.subtitle.trim()
            : product.sku?.trim()
                ? product.sku.trim()
                : product.handle?.trim()
                    ? product.handle.trim()
                    : product.id
    updateDrafts([
      ...drafts,
      {
        id: createLocalId(),
        childProductId: product.id,
        childName: resolvedName,
        relationType: allowedRelationTypes[0] as SubproductDraft['relationType'],
        isRequired: false,
        minQuantity: null,
        maxQuantity: null,
      },
    ])
  }

  const updateDraft = (id: string, patch: Partial<SubproductDraft>) => {
    updateDrafts(drafts.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)))
  }

  const removeDraft = (id: string) => {
    updateDrafts(drafts.filter((draft) => draft.id !== id))
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium">
          {t('catalog.products.create.subproducts.searchLabel', 'Search products')}
        </label>
        <Input
          placeholder={t('catalog.products.create.subproducts.searchPlaceholder', 'Type to search catalog products')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
      </div>
      {query.trim() && (
        <div className="rounded-lg border bg-card p-3">
          <div className="mb-2 text-sm font-medium">
            {loading
              ? t('catalog.products.create.subproducts.loading', 'Loading…')
              : t('catalog.products.create.subproducts.results', 'Search results')}
          </div>
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {loading
                ? t('catalog.products.create.subproducts.loading', 'Loading…')
                : t('catalog.products.create.subproducts.noResults', 'No products found')}
            </p>
          ) : (
            <div className="space-y-2">
              {results.map((product) => (
                <div
                  key={product.id}
                  className="flex items-center justify-between rounded border px-3 py-2"
                >
                  <div>
                    <div className="text-sm font-medium">
                      {product.title ?? product.subtitle ?? product.sku ?? product.handle ?? product.id}
                    </div>
                    {product.subtitle ? (
                      <div className="text-xs text-muted-foreground">{product.subtitle}</div>
                    ) : null}
                    {product.sku ? (
                      <div className="text-xs text-muted-foreground">SKU: {product.sku}</div>
                    ) : null}
                    {product.handle ? (
                      <div className="text-xs text-muted-foreground">/{product.handle}</div>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => addSubproduct(product)}
                    disabled={drafts.some((draft) => draft.childProductId === product.id)}
                  >
                    {t('catalog.products.create.subproducts.add', 'Add')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="text-sm font-medium">
          {t('catalog.products.create.subproducts.selected', 'Selected subproducts')}
        </div>
        {drafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('catalog.products.create.subproducts.empty', 'No subproducts attached yet.')}
          </p>
        ) : (
          <div className="space-y-3">
            {drafts.map((draft) => (
              <div key={draft.id} className="space-y-2 rounded border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{draft.childName ?? draft.childProductId}</div>
                    <div className="text-xs text-muted-foreground">{draft.childProductId}</div>
                  </div>
                  <Button type="button" variant="ghost" onClick={() => removeDraft(draft.id)}>
                    {t('catalog.products.create.remove', 'Remove')}
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                  <div>
                    <label className="text-xs font-medium uppercase tracking-wide">
                      {t('catalog.products.create.subproducts.relation', 'Relation')}
                    </label>
                    <select
                      className="w-full rounded border px-3 py-2 text-sm"
                      value={draft.relationType}
                      onChange={(event) =>
                        updateDraft(draft.id, {
                          relationType: event.target.value as SubproductDraft['relationType'],
                        })
                      }
                    >
                      {allowedRelationTypes.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium uppercase tracking-wide">
                      {t('catalog.products.create.subproducts.required', 'Required')}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={draft.isRequired ?? false}
                        onChange={(event) => updateDraft(draft.id, { isRequired: event.target.checked })}
                      />
                      <span className="text-sm text-muted-foreground">
                        {t('catalog.products.create.subproducts.requiredLabel', 'Customer must pick this item')}
                      </span>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium uppercase tracking-wide">
                      {t('catalog.products.create.subproducts.minQty', 'Min qty')}
                    </label>
                    <Input
                      type="number"
                      value={draft.minQuantity ?? ''}
                      onChange={(event) =>
                        updateDraft(draft.id, {
                          minQuantity: event.target.value ? Number(event.target.value) : null,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium uppercase tracking-wide">
                      {t('catalog.products.create.subproducts.maxQty', 'Max qty')}
                    </label>
                    <Input
                      type="number"
                      value={draft.maxQuantity ?? ''}
                      onChange={(event) =>
                        updateDraft(draft.id, {
                          maxQuantity: event.target.value ? Number(event.target.value) : null,
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function createLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `sub_${Math.random().toString(36).slice(2, 10)}`
}
