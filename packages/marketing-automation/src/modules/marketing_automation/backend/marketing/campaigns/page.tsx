"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions, type RowActionItem } from '@open-mercato/ui/backend/RowActions'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader, extractOptimisticLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useMarketingMutation } from '../../../components/useMarketingMutation'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { formatDateTime } from '@open-mercato/shared/lib/time'

type TemplateOption = {
  id: string
  labelKey: string
  descriptionKey: string
  requiresKey: string
  stepCount: number
  triggerCount: number
  document: unknown
}

type CampaignRow = {
  id: string
  name: string
  isEnabled: boolean
  /** Set when the deliverability breaker switched it off; null when a person did, or nobody has. */
  breakerTrippedAt?: string | null
  stepCount: number
  triggerSummary: string
  updatedAt: string
}

type CampaignsResponse = {
  page?: unknown
  pageSize?: unknown
  items?: Array<{
    id?: unknown
    name?: unknown
    isEnabled?: unknown
    stepCount?: unknown
    triggers?: Array<{ kind?: unknown; eventId?: unknown; scheduleValue?: unknown; labelKey?: unknown }>
    updatedAt?: unknown
  }>
  total?: number
}

export default function CampaignsListPage() {
  const t = useT()
  const runMutation = useMarketingMutation('campaigns')
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [rows, setRows] = React.useState<CampaignRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)
  /**
   * Paged, because it was not.
   *
   * The list asked for `pageSize=50` and rendered whatever came back with no footer, so the fifty-first
   * campaign was unreachable from the UI entirely — and nothing on the screen suggested there was one. The
   * API has always supported `page` and returned `total`; only the screen did not ask.
   */
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(25)
  const [total, setTotal] = React.useState(0)

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    const result = await apiCall<CampaignsResponse>(`/api/marketing_automation/campaigns?${query.toString()}`)
    /**
     * A non-ok response is not an empty list.
     *
     * `apiCall` resolves rather than throwing on 401/403/500, so an expired session fell through to an empty
     * array and the page said "No campaigns yet" — about an installation that may have been messaging
     * customers all night.
     */
    if (!result.ok || !Array.isArray(result.result?.items)) {
      setRows([])
      setTotal(0)
      setLoadFailed(true)
      return
    }
    const items = result.result.items
    setTotal(typeof result.result?.total === 'number' ? result.result.total : items.length)
    setRows(items.flatMap((item) => {
      if (typeof item.id !== 'string' || typeof item.name !== 'string') return []
      const triggers = Array.isArray(item.triggers) ? item.triggers : []
      return [{
        id: item.id,
        name: item.name,
        isEnabled: item.isEnabled === true,
        stepCount: typeof item.stepCount === 'number' ? item.stepCount : 0,
        /**
         * What starts this campaign, in words.
         *
         * This column used to read `customers.person.created` and `1d` — the engine's own vocabulary, on
         * the first screen anybody opens. The API now resolves a label key per trigger; an unknown one
         * falls back to the raw value, because a campaign saved before a trigger was renamed should still
         * say something rather than nothing.
         */
        triggerSummary: triggers
          .map((trigger) => {
            const raw = trigger.kind === 'schedule'
              ? String(trigger.scheduleValue ?? '')
              : String(trigger.eventId ?? '')
            return typeof trigger.labelKey === 'string' && trigger.labelKey ? t(trigger.labelKey, raw) : raw
          })
          .filter(Boolean)
          .join(', '),
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
      }]
    }))
    } catch {
      // `apiCall` resolves for an HTTP error but REJECTS for a transport or parse failure, and an
      // unhandled rejection here left the list on its skeleton forever with nothing to click.
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
    // `t` is a dependency now that the rows are built with it: without it a language change would leave
    // the trigger column in the previous language until something else refetched the list.
  }, [t, page, pageSize])

  React.useEffect(() => { void load() }, [load, scopeVersion])

  const createCampaign = async () => {
    try {
      // Guarded like every other write on this page: a mutation guard that covers delete and not create is
      // a guard somebody will reasonably believe covers both.
      const response = await runMutation(
        () => apiCallOrThrow<{ id: string }>('/api/marketing_automation/campaigns', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: t('marketing_automation.action.create', 'New campaign') }),
        }),
      )
      const id = response.result?.id
      if (id) router.push(`/backend/marketing/campaigns/${id}`)
    } catch {
      flash(t('marketing_automation.errors.saveFailed', 'Could not save the campaign.'), 'error')
    }
  }

  /**
   * Starting from a template, and from a file.
   *
   * Both go through the same import endpoint, which is what guarantees a template cannot produce a campaign an
   * import could not — and both arrive DISABLED, so the author reads before anybody is messaged.
   */
  const [templates, setTemplates] = React.useState<TemplateOption[] | null>(null)
  const [importing, setImporting] = React.useState(false)
  const fileInput = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await apiCall<{ items?: TemplateOption[] }>('/api/marketing_automation/templates')
        if (cancelled) return
        setTemplates(result.ok && Array.isArray(result.result?.items) ? result.result.items : [])
      } catch {
        // A missing template list is not worth an error on the campaign list: the New campaign button still works.
        if (!cancelled) setTemplates([])
      }
    })()
    return () => { cancelled = true }
  }, [scopeVersion])

  const importDocument = async (document: unknown, successKey: string, fallback: string) => {
    setImporting(true)
    try {
      // Covers both callers: starting from a template and importing a file go through this one function.
      const response = await runMutation(
        () => apiCallOrThrow<{ id?: string; warnings?: Array<{ stepId: string; param: string }> }>(
          '/api/marketing_automation/campaigns/import',
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(document) },
        ),
      )
      const warnings = response.result?.warnings ?? []
      if (warnings.length > 0) {
        /**
         * Said out loud rather than left to be discovered.
         *
         * A step carrying a tag id from another installation points at a row that does not exist here. The
         * campaign is imported anyway and left disabled, because "pick a tag" is a five-second fix and a
         * silently dropped parameter is a step that looks configured and does nothing.
         */
        flash(
          t('marketing_automation.import.warnings', 'Imported, but {count} step settings point at another installation and need picking again.')
            .replace('{count}', String(warnings.length)),
          'warning',
        )
      } else {
        flash(t(successKey, fallback), 'success')
      }
      const id = response.result?.id
      if (id) router.push(`/backend/marketing/campaigns/${id}`)
    } catch {
      flash(t('marketing_automation.import.failed', 'That document could not be imported.'), 'error')
    } finally {
      setImporting(false)
    }
  }

  const importFromFile = async (file: File) => {
    let document: unknown
    try {
      document = JSON.parse(await file.text())
    } catch {
      // Refused before it reaches the server, so a mistyped file says something an author understands.
      flash(t('marketing_automation.import.notJson', 'That file is not a campaign export.'), 'error')
      return
    }
    await importDocument(document, 'marketing_automation.import.done', 'Campaign imported, and left disabled.')
  }

  const deleteCampaign = async (row: CampaignRow) => {
    const confirmed = await confirm({
      text: t('marketing_automation.confirm.delete', 'Delete this campaign? Customers currently waiting in it will stop.'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      // Delete carries the row's version too: the platform's locking covers delete, so removing a
      // campaign somebody else just changed collides instead of winning silently.
      await runMutation(
        () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(row.updatedAt),
          () => apiCallOrThrow(`/api/marketing_automation/campaigns/${row.id}`, { method: 'DELETE' }),
        ),
      )
      await load()
    } catch (deleteError) {
      if (!extractOptimisticLockConflict(deleteError)) {
        flash(t('marketing_automation.errors.saveFailed', 'Could not save the campaign.'), 'error')
      }
    }
  }

  const columns = React.useMemo<ColumnDef<CampaignRow>[]>(() => [
    {
      accessorKey: 'name',
      header: t('marketing_automation.list.columns.name', 'Name'),
    },
    {
      accessorKey: 'isEnabled',
      header: t('marketing_automation.list.columns.enabled', 'Enabled'),
      /**
       * An automatic pause reads differently from a deliberate one.
       *
       * Both used to render the same plain off icon, so the obvious action — switch it back on — was the one the
       * breaker undoes on the next sweep. An operator could fight their own guardrail without being told it was
       * there, because the notification that said so is read once and dismissed.
       */
      cell: ({ row }) => (row.original.breakerTrippedAt && !row.original.isEnabled ? (
        <StatusBadge variant="warning">
          {t('marketing_automation.list.pausedByBreaker', 'Paused automatically')}
        </StatusBadge>
      ) : (
        <BooleanIcon value={row.original.isEnabled} />
      )),
    },
    {
      accessorKey: 'triggerSummary',
      header: t('marketing_automation.list.columns.triggers', 'Triggers'),
      meta: { truncate: false },
    },
    {
      accessorKey: 'stepCount',
      header: t('marketing_automation.list.columns.steps', 'Steps'),
    },
    {
      accessorKey: 'updatedAt',
      header: t('marketing_automation.list.columns.updatedAt', 'Updated'),
      meta: { truncate: false },
      cell: ({ row }) => (row.original.updatedAt ? formatDateTime(row.original.updatedAt) : '—'),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const actions: RowActionItem[] = [
          { id: 'edit', label: t('marketing_automation.action.edit', 'Edit'), onSelect: () => router.push(`/backend/marketing/campaigns/${row.original.id}`) },
          // Results and runs were reachable only from each other and from a customer's profile.
          { id: 'results', label: t('marketing_automation.results.title', 'Results'), onSelect: () => router.push(`/backend/marketing/campaigns/${row.original.id}/results`) },
          { id: 'runs', label: t('marketing_automation.runs.title', 'Runs'), onSelect: () => router.push(`/backend/marketing/campaigns/${row.original.id}/runs`) },
          { id: 'delete', label: t('marketing_automation.action.delete', 'Delete'), destructive: true, onSelect: () => void deleteCampaign(row.original) },
        ]
        return <RowActions items={actions} />
      },
    },
  ], [t, router])

  /**
   * The empty state is ROUTED to the readiness checklist, not merely descriptive.
   *
   * This is the first marketing screen anybody opens, and it used to explain what a campaign IS and stop there
   * — on an installation that may not be able to send at all. The checklist exists to answer exactly that, and
   * nothing in the module linked to it, so the one screen written for this moment was reachable only by
   * guessing it was in the nav.
   */
  const emptyState = (
    <ListEmptyState
      title={t('marketing_automation.list.empty.title', 'No campaigns yet')}
      description={t('marketing_automation.list.empty.description', 'A campaign reacts to something that happens, decides who it applies to, and then runs a series of steps.')}
      createHref="/backend/marketing/setup"
      createLabel={t('marketing_automation.list.empty.action', 'Check what this installation needs')}
    />
  )

  return (
    <Page>
      <PageBody>
        <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
          {/* A template is the difference between an installed module and a used one: an empty canvas asks the
              author what a good campaign looks like, while a welcome sequence asks whether they agree with it. */}
          {(templates ?? []).length > 0 ? (
            <Select
              value=""
              disabled={importing}
              onValueChange={(id) => {
                const template = (templates ?? []).find((entry) => entry.id === id)
                if (template) {
                  void importDocument(
                    template.document,
                    'marketing_automation.template.created',
                    'Campaign created from a template, and left disabled.',
                  )
                }
              }}
            >
              <SelectTrigger className="w-64">
                <SelectValue placeholder={t('marketing_automation.action.fromTemplate', 'Start from a template…')} />
              </SelectTrigger>
              <SelectContent>
                {(templates ?? []).map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {t(template.labelKey, template.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              // Cleared so choosing the same file twice still fires a change.
              event.target.value = ''
              if (file) void importFromFile(file)
            }}
          />
          <Button variant="outline" disabled={importing} onClick={() => fileInput.current?.click()}>
            {t('marketing_automation.action.import', 'Import')}
          </Button>
          <Button onClick={() => void createCampaign()}>
            {t('marketing_automation.action.create', 'New campaign')}
          </Button>
        </div>
        {loadFailed ? (
          <div className="mb-3">
            <ErrorMessage label={t('marketing_automation.errors.loadListFailed', 'Could not load the campaigns.')} />
          </div>
        ) : null}
        {/* Not under the error: an empty table there would still say "No campaigns yet". */}
        {loadFailed ? null : (
          <DataTable
            columns={columns}
            data={rows}
            isLoading={loading}
            pagination={{
              page,
              pageSize,
              total,
              totalPages: Math.max(1, Math.ceil(total / pageSize)),
              onPageChange: setPage,
              pageSizeOptions: [10, 25, 50, 100],
              onPageSizeChange: (next) => { setPageSize(next); setPage(1) },
            }}
            emptyState={emptyState}
          />
        )}
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
