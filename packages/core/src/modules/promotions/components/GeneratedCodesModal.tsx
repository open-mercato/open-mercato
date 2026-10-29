// Generated-codes panel for the code detail page (Release 4 PLAN.md Step 6.6,
// SPEC-055 "Promotional Codes (`/backend/codes`)"): "Code detail (`/backend/codes/[id]`):
// full form + generated codes panel (modal with paginated list of individual codes,
// active status, copy-to-clipboard)". Backed by the already-built, read-only
// `GET /api/promotions/codes/[id]/generated` route (Step 6.4) — this component owns no
// write path.
//
// Uses `DataTable` per `packages/ui/AGENTS.md` ("Use `DataTable` as the default list
// view") rather than hand-rolling table markup, with the search/filter/export chrome
// omitted (`embedded`, no `searchValue`/`filters`/`exporter`) since this is a small
// parent-scoped sub-list inside a modal, not a standalone admin list page.

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Check, Copy } from 'lucide-react'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@open-mercato/ui/primitives/dialog'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('promotions')
const PAGE_SIZE = 10

type GeneratedCodeRow = {
  id: string
  code: string
  active: boolean
}

type GeneratedCodeListResponse = {
  items: GeneratedCodeRow[]
  total: number
  page: number
  pageSize: number
}

function CopyCodeButton({ code }: { code: string }) {
  const t = useT()
  const [copied, setCopied] = React.useState(false)

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      logger.error('[internal] Failed to copy generated code to clipboard', { err })
    }
  }, [code])

  return (
    <IconButton
      type="button"
      variant="ghost"
      size="sm"
      aria-label={t('promotions.codes.detail.generatedPanel.copy', 'Copy code')}
      onClick={handleCopy}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </IconButton>
  )
}

export type GeneratedCodesModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  codeId: string
}

export function GeneratedCodesModal({ open, onOpenChange, codeId }: GeneratedCodesModalProps) {
  const t = useT()
  const [rows, setRows] = React.useState<GeneratedCodeRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setPage(1)
  }, [open])

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
        const fallback: GeneratedCodeListResponse = { items: [], total: 0, page: 1, pageSize: PAGE_SIZE }
        const call = await apiCall<GeneratedCodeListResponse>(
          `/api/promotions/codes/${encodeURIComponent(codeId)}/generated?${params.toString()}`,
          undefined,
          { fallback },
        )
        if (cancelled) return
        if (!call.ok) {
          setRows([])
          setTotal(0)
          setLoadError(t('promotions.codes.detail.generatedPanel.loadError', 'Failed to load generated codes'))
          return
        }
        const payload = call.result ?? fallback
        setRows(Array.isArray(payload.items) ? payload.items : [])
        setTotal(typeof payload.total === 'number' ? payload.total : 0)
      } catch {
        if (!cancelled) {
          setRows([])
          setTotal(0)
          setLoadError(t('promotions.codes.detail.generatedPanel.loadError', 'Failed to load generated codes'))
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [open, codeId, page, t])

  const columns = React.useMemo<ColumnDef<GeneratedCodeRow>[]>(
    () => [
      {
        accessorKey: 'code',
        header: t('promotions.codes.detail.generatedPanel.column.code', 'Code'),
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.code}</span>,
      },
      {
        accessorKey: 'active',
        header: t('promotions.codes.detail.generatedPanel.column.active', 'Status'),
        meta: { maxWidth: '120px' },
        cell: ({ row }) => (
          <StatusBadge variant={row.original.active ? 'success' : 'neutral'}>
            {row.original.active
              ? t('promotions.codes.detail.generatedPanel.active', 'Active')
              : t('promotions.codes.detail.generatedPanel.inactive', 'Inactive')}
          </StatusBadge>
        ),
      },
      {
        id: 'copy',
        header: '',
        meta: { maxWidth: '60px' },
        cell: ({ row }) => <CopyCodeButton code={row.original.code} />,
      },
    ],
    [t],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('promotions.codes.detail.generatedPanel.title', 'Generated codes')}</DialogTitle>
          <DialogDescription>
            {t('promotions.codes.detail.generatedPanel.description', 'Every individual code generated from this pool.')}
          </DialogDescription>
        </DialogHeader>
        <DataTable<GeneratedCodeRow>
          embedded
          columns={columns}
          data={rows}
          isLoading={isLoading}
          error={loadError}
          emptyState={t('promotions.codes.detail.generatedPanel.empty', 'No codes generated yet.')}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
            onPageChange: setPage,
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
