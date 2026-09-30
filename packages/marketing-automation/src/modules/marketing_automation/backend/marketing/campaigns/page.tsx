"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
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
  stepCount: number
  triggerSummary: string
  updatedAt: string
}

type CampaignsResponse = {
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

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
    const result = await apiCall<CampaignsResponse>('/api/marketing_automation/campaigns?pageSize=50')
    const items = result.ok && Array.isArray(result.result?.items) ? result.result.items : []
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
  }, [t])

  React.useEffect(() => { void load() }, [load, scopeVersion])

  const createCampaign = async () => {
    try {
      const response = await apiCallOrThrow<{ id: string }>('/api/marketing_automation/campaigns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: t('marketing_automation.action.create', 'New campaign') }),
      })
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
      const response = await apiCallOrThrow<{ id?: string; warnings?: Array<{ stepId: string; param: string }> }>(
        '/api/marketing_automation/campaigns/import',
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(document) },
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
      cell: ({ row }) => <BooleanIcon value={row.original.isEnabled} />,
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
        <DataTable
          columns={columns}
          data={rows}
          isLoading={loading}
          emptyState={(
            <ListEmptyState
              title={t('marketing_automation.list.empty.title', 'No campaigns yet')}
              description={t('marketing_automation.list.empty.description', 'A campaign reacts to something that happens, decides who it applies to, and then runs a series of steps.')}
            />
          )}
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
