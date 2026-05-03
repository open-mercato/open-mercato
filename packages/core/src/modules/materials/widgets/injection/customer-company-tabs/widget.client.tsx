'use client'

import * as React from 'react'
import Link from 'next/link'
import { Star } from 'lucide-react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { hasFeature } from '@open-mercato/shared/security/features'

type CustomerCompanyInjectionContext = {
  data?: {
    id?: string
    company?: { id?: string }
  }
  context?: {
    userFeatures?: string[]
    isSuperAdmin?: boolean
  }
}

type SupplierLinkRow = {
  id: string
  material_id: string
  supplier_company_id: string
  preferred: boolean
  is_active: boolean
}

type MaterialRow = {
  id: string
  code: string
  name: string
  kind: string
  lifecycle_state: string
}

/**
 * Phase 1 Step 14 — "Supplied materials" tab content for the customer company detail page.
 *
 * Renders inside the `page:customers.company.tabs` spot. Lists materials this company
 * supplies (via MaterialSupplierLink rows where supplier_company_id = this company).
 * Empty state when no links exist.
 *
 * Visibility gated by `materials.widgets.supplied-materials` feature with wildcard support.
 */
export default function SuppliedMaterialsWidget(props: CustomerCompanyInjectionContext) {
  const t = useT()
  const companyId = props.data?.id ?? props.data?.company?.id
  const userFeatures = props.context?.userFeatures ?? []
  const isSuperAdmin = props.context?.isSuperAdmin ?? false

  const visible = isSuperAdmin || hasFeature(userFeatures, 'materials.widgets.supplied-materials')

  const [links, setLinks] = React.useState<SupplierLinkRow[]>([])
  const [materials, setMaterials] = React.useState<Record<string, MaterialRow>>({})
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!visible || !companyId) {
      setLoading(false)
      return
    }
    let cancelled = false
    async function load() {
      try {
        setLoading(true)
        const linksCall = await apiCall<{ items: SupplierLinkRow[] }>(
          `/api/material-suppliers?supplierCompanyId=${encodeURIComponent(companyId!)}&pageSize=100`,
          undefined,
          { fallback: { items: [] } },
        )
        if (cancelled) return
        const rows = linksCall.ok && linksCall.result ? linksCall.result.items ?? [] : []
        setLinks(rows)
        if (rows.length === 0) {
          setMaterials({})
          return
        }
        // Bulk-load materials for the linked rows via the multi-id filter.
        const ids = Array.from(new Set(rows.map((r) => r.material_id)))
        const matCall = await apiCall<{ items: MaterialRow[] }>(
          `/api/materials?ids=${ids.map(encodeURIComponent).join(',')}&pageSize=100`,
        )
        if (cancelled) return
        if (matCall.ok && matCall.result?.items) {
          const map: Record<string, MaterialRow> = {}
          for (const m of matCall.result.items) map[m.id] = m
          setMaterials(map)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [companyId, visible])

  if (!visible) return null
  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Spinner size="sm" />
        {t('materials.widgets.suppliedMaterials.loading', 'Loading supplied materials…')}
      </div>
    )
  }
  if (links.length === 0) {
    return (
      <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
        {t(
          'materials.widgets.suppliedMaterials.empty',
          'This company is not yet linked to any material as a supplier. Add the link from the Material detail page → Suppliers tab.',
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <h3 className="text-base font-semibold">
          {t('materials.widgets.suppliedMaterials.title', 'Supplied materials')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t(
            'materials.widgets.suppliedMaterials.description',
            'Materials this company supplies. Star marks the preferred supplier per material.',
          )}
        </p>
      </div>
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 w-8" />
              <th className="px-3 py-2">{t('materials.widgets.suppliedMaterials.column.code', 'Code')}</th>
              <th className="px-3 py-2">{t('materials.widgets.suppliedMaterials.column.name', 'Name')}</th>
              <th className="px-3 py-2">{t('materials.widgets.suppliedMaterials.column.kind', 'Kind')}</th>
              <th className="px-3 py-2 text-right" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {links.map((link) => {
              const material = materials[link.material_id]
              if (!material) return null
              return (
                <tr key={link.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2">
                    {link.preferred ? (
                      <Star className="h-4 w-4 fill-current text-yellow-500" aria-label={t('materials.widgets.suppliedMaterials.preferred', 'Preferred')} />
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{material.code}</td>
                  <td className="px-3 py-2 font-medium">{material.name}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline">{t(`materials.kind.${material.kind}`, material.kind)}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/backend/materials/${material.id}`}>
                        {t('materials.widgets.suppliedMaterials.open', 'Open')}
                      </Link>
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
