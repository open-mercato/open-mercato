"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

type BlockRow = { id: string; key: string; name: string; html: string; updatedAt: string }

/**
 * Reusable HTML blocks, edited in place.
 *
 * A block is SHARED by every message that references it, which is why each save carries the version the row
 * was read at: two people editing the shop's footer is the normal case here, not an edge one.
 */
export default function ContentBlocksPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [rows, setRows] = React.useState<BlockRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [selected, setSelected] = React.useState<BlockRow | null>(null)
  const [draft, setDraft] = React.useState<{ key: string; name: string; html: string }>({ key: '', name: '', html: '' })
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const result = await apiCall<{ items?: BlockRow[] }>('/api/marketing_automation/content-blocks?pageSize=100')
      setRows(result.ok && Array.isArray(result.result?.items) ? result.result.items : [])
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load, scopeVersion])

  const startNew = () => {
    setSelected(null)
    setDraft({ key: '', name: '', html: '' })
  }

  const startEdit = (row: BlockRow) => {
    setSelected(row)
    setDraft({ key: row.key, name: row.name, html: row.html })
  }

  const save = async () => {
    setSaving(true)
    try {
      if (selected) {
        await withScopedApiRequestHeaders(
          buildOptimisticLockHeader(selected.updatedAt),
          () => apiCallOrThrow(`/api/marketing_automation/content-blocks/${selected.id}`, {
            method: 'PUT',
            body: JSON.stringify({ updatedAt: selected.updatedAt, name: draft.name, html: draft.html }),
            headers: { 'content-type': 'application/json' },
          }),
        )
      } else {
        await apiCallOrThrow('/api/marketing_automation/content-blocks', {
          method: 'POST',
          body: JSON.stringify(draft),
          headers: { 'content-type': 'application/json' },
        })
      }
      flash(t('marketing_automation.blocks.saved', 'Saved.'), 'success')
      startNew()
      await load()
    } catch (error) {
      if (!surfaceRecordConflict(error, t)) {
        const body = (error as { body?: { code?: unknown; error?: unknown } } | null)?.body
        const code = typeof body?.code === 'string' ? body.code : null
        flash(code ? t(code, String(body?.error ?? code)) : t('marketing_automation.blocks.saveFailed', 'Could not save the block.'), 'error')
      }
    } finally {
      setSaving(false)
    }
  }

  const remove = async (row: BlockRow) => {
    const confirmed = await confirm({
      text: t('marketing_automation.blocks.confirmDelete', 'Remove this block? Messages that reference it will render nothing in its place.'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await withScopedApiRequestHeaders(
        buildOptimisticLockHeader(row.updatedAt),
        () => apiCallOrThrow(`/api/marketing_automation/content-blocks/${row.id}`, { method: 'DELETE' }),
      )
      if (selected?.id === row.id) startNew()
      await load()
    } catch (error) {
      if (!surfaceRecordConflict(error, t)) {
        flash(t('marketing_automation.blocks.deleteFailed', 'Could not remove the block.'), 'error')
      }
    }
  }

  const columns = React.useMemo<ColumnDef<BlockRow>[]>(() => [
    {
      accessorKey: 'key',
      header: t('marketing_automation.blocks.columns.key', 'Reference'),
      cell: ({ row }) => <span className="font-mono text-xs">{`{{block:${row.original.key}}}`}</span>,
    },
    { accessorKey: 'name', header: t('marketing_automation.blocks.columns.name', 'Name') },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button variant="outline" size="sm" onClick={() => startEdit(row.original)}>
            {t('marketing_automation.blocks.edit', 'Edit')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void remove(row.original)}>
            {t('marketing_automation.action.removeNode', 'Remove')}
          </Button>
        </div>
      ),
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        {ConfirmDialogElement}
        {loadFailed ? (
          <div className="mb-3">
            <ErrorMessage label={t('marketing_automation.blocks.loadFailed', 'Could not load the blocks.')} />
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
          <div>
            <DataTable
              columns={columns}
              data={rows}
              isLoading={loading}
              emptyState={(
                <ListEmptyState
                  title={t('marketing_automation.blocks.emptyTitle', 'No content blocks yet')}
                  description={t('marketing_automation.blocks.emptyBody', 'A block is a piece of HTML you reuse across messages — a footer, a header, a seasonal banner.')}
                />
              )}
            />
          </div>

          <aside className="space-y-3">
            <SectionHeader
              title={selected
                ? t('marketing_automation.blocks.editing', 'Editing {key}').replace('{key}', selected.key)
                : t('marketing_automation.blocks.new', 'New block')}
            />
            <div className="space-y-1">
              <Label htmlFor="block-key">{t('marketing_automation.blocks.columns.key', 'Reference')}</Label>
              <Input
                id="block-key"
                value={draft.key}
                // Immutable once created: messages reference it by name, so a rename would silently empty the
                // block out of every campaign that used it.
                disabled={selected !== null}
                placeholder="footer"
                onChange={(event) => setDraft({ ...draft, key: event.target.value })}
              />
              <div className="text-xs text-muted-foreground">
                {t('marketing_automation.blocks.keyHint', 'Lowercase letters, digits, dashes. Referenced in a message as {{block:key}}.')}
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="block-name">{t('marketing_automation.blocks.columns.name', 'Name')}</Label>
              <Input id="block-name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="block-html">{t('marketing_automation.blocks.html', 'HTML')}</Label>
              <Textarea
                id="block-html"
                rows={10}
                value={draft.html}
                onChange={(event) => setDraft({ ...draft, html: event.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <Button disabled={saving || !draft.key.trim() || !draft.name.trim()} onClick={() => void save()}>
                {saving ? <Spinner /> : t('marketing_automation.action.save', 'Save')}
              </Button>
              {selected ? (
                <Button variant="outline" onClick={startNew}>
                  {t('marketing_automation.blocks.cancelEdit', 'New block')}
                </Button>
              ) : null}
            </div>
          </aside>
        </div>
      </PageBody>
    </Page>
  )
}
