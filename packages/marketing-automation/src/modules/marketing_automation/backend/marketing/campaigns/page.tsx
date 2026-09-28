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
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { formatDateTime } from '@open-mercato/shared/lib/time'

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
    triggers?: Array<{ kind?: unknown; eventId?: unknown; scheduleValue?: unknown }>
    updatedAt?: unknown
  }>
  total?: number
}

export default function CampaignsListPage() {
  const t = useT()
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
        triggerSummary: triggers
          .map((trigger) => (trigger.kind === 'schedule'
            ? String(trigger.scheduleValue ?? '')
            : String(trigger.eventId ?? '')))
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
  }, [])

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

  const deleteCampaign = async (row: CampaignRow) => {
    const confirmed = await confirm({
      text: t('marketing_automation.confirm.delete', 'Delete this campaign? Customers currently waiting in it will stop.'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      // Delete carries the row's version too: the platform's locking covers delete, so removing a
      // campaign somebody else just changed collides instead of winning silently.
      await withScopedApiRequestHeaders(
        buildOptimisticLockHeader(row.updatedAt),
        () => apiCallOrThrow(`/api/marketing_automation/campaigns/${row.id}`, { method: 'DELETE' }),
      )
      await load()
    } catch (deleteError) {
      if (!surfaceRecordConflict(deleteError, t)) {
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
    },
    {
      accessorKey: 'stepCount',
      header: t('marketing_automation.list.columns.steps', 'Steps'),
    },
    {
      accessorKey: 'updatedAt',
      header: t('marketing_automation.list.columns.updatedAt', 'Updated'),
      cell: ({ row }) => (row.original.updatedAt ? formatDateTime(row.original.updatedAt) : '—'),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const actions: RowActionItem[] = [
          { id: 'edit', label: t('marketing_automation.action.edit', 'Edit'), onSelect: () => router.push(`/backend/marketing/campaigns/${row.original.id}`) },
          { id: 'delete', label: t('marketing_automation.action.delete', 'Delete'), destructive: true, onSelect: () => void deleteCampaign(row.original) },
        ]
        return <RowActions items={actions} />
      },
    },
  ], [t, router])

  return (
    <Page>
      <PageBody>
        <div className="mb-3 flex justify-end">
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
