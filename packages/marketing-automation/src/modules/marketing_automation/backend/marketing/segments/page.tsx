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
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { ConditionBuilder } from '@open-mercato/core/modules/business_rules/components/ConditionBuilder'
import type { GroupCondition } from '@open-mercato/core/modules/business_rules/lib/expression-evaluator'

const SEGMENTS_PATH = '/api/marketing_automation/segments'

type SegmentRow = {
  id: string
  slug: string
  name: string
  description: string | null
  expression: GroupCondition | null
  updatedAt: string
}

type MembersAnswer = {
  items?: Array<{ id: string; displayName: string | null; email: string | null }>
  qualifier?: 'exact' | 'sample'
  checked?: number
  candidates?: number | null
}

/**
 * Saved segments: define once, target from any campaign.
 *
 * The editor is the platform's own condition builder, unchanged — a segment is the same expression a campaign
 * audience is, and a second condition editor would be a second thing to keep in step.
 */
export default function SegmentsPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [rows, setRows] = React.useState<SegmentRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [selected, setSelected] = React.useState<SegmentRow | null>(null)
  const [draft, setDraft] = React.useState<{ name: string; description: string; expression: GroupCondition | null }>({
    name: '',
    description: '',
    expression: null,
  })
  const [saving, setSaving] = React.useState(false)
  const [members, setMembers] = React.useState<MembersAnswer | null>(null)
  const [counting, setCounting] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const result = await apiCall<{ items?: SegmentRow[] }>(`${SEGMENTS_PATH}?pageSize=100`)
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
    setMembers(null)
    setDraft({ name: '', description: '', expression: null })
  }

  const startEdit = (row: SegmentRow) => {
    setSelected(row)
    setMembers(null)
    setDraft({ name: row.name, description: row.description ?? '', expression: row.expression })
  }

  const save = async () => {
    setSaving(true)
    try {
      const payload = {
        name: draft.name,
        description: draft.description.trim() || undefined,
        expression: draft.expression,
      }
      if (selected) {
        await withScopedApiRequestHeaders(
          buildOptimisticLockHeader(selected.updatedAt),
          () => apiCallOrThrow(`${SEGMENTS_PATH}/${selected.id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...payload, description: draft.description.trim() || null, updatedAt: selected.updatedAt }),
          }),
        )
      } else {
        await apiCallOrThrow(SEGMENTS_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }
      flash(t('marketing_automation.segments.saved', 'Segment saved.'), 'success')
      startNew()
      await load()
    } catch (error) {
      if (!surfaceRecordConflict(error, t)) {
        const body = (error as { body?: { code?: unknown } } | null)?.body
        const code = typeof body?.code === 'string' ? body.code : null
        flash(
          code === 'marketing_automation.errors.segmentSelfReference'
            ? t('marketing_automation.errors.segmentSelfReference', 'A segment cannot be defined in terms of other segments.')
            : t('marketing_automation.segments.saveFailed', 'Could not save the segment.'),
          'error',
        )
      }
    } finally {
      setSaving(false)
    }
  }

  const remove = async (row: SegmentRow) => {
    const confirmed = await confirm({
      text: t('marketing_automation.segments.confirmDelete', 'Remove this segment? Campaigns that target it will match nobody.'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await withScopedApiRequestHeaders(
        buildOptimisticLockHeader(row.updatedAt),
        () => apiCallOrThrow(`${SEGMENTS_PATH}/${row.id}`, { method: 'DELETE' }),
      )
      if (selected?.id === row.id) startNew()
      await load()
    } catch (error) {
      if (!surfaceRecordConflict(error, t)) {
        flash(t('marketing_automation.segments.deleteFailed', 'Could not remove the segment.'), 'error')
      }
    }
  }

  const showMembers = async (row: SegmentRow) => {
    setCounting(true)
    setMembers(null)
    try {
      const result = await apiCall<MembersAnswer>(`${SEGMENTS_PATH}/${row.id}/members`)
      setMembers(result.ok ? (result.result ?? {}) : {})
    } catch {
      flash(t('marketing_automation.segments.membersFailed', 'Could not resolve the members.'), 'error')
    } finally {
      setCounting(false)
    }
  }

  const columns = React.useMemo<ColumnDef<SegmentRow>[]>(() => [
    { accessorKey: 'name', header: t('marketing_automation.segments.columns.name', 'Name') },
    {
      accessorKey: 'slug',
      header: t('marketing_automation.segments.columns.reference', 'Reference'),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.slug}</span>,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button variant="outline" size="sm" onClick={() => void showMembers(row.original)}>
            {t('marketing_automation.segments.members', 'Members')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => startEdit(row.original)}>
            {t('marketing_automation.segments.edit', 'Edit')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void remove(row.original)}>
            {t('marketing_automation.action.removeNode', 'Remove')}
          </Button>
        </div>
      ),
    },
  ], [t, selected])

  return (
    <Page>
      <PageBody>
        {ConfirmDialogElement}
        {loadFailed ? (
          <div className="mb-3">
            <ErrorMessage label={t('marketing_automation.segments.loadFailed', 'Could not load the segments.')} />
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1fr_28rem]">
          <div className="space-y-4">
            <DataTable
              columns={columns}
              data={rows}
              isLoading={loading}
              emptyState={(
                <ListEmptyState
                  title={t('marketing_automation.segments.emptyTitle', 'No segments yet')}
                  description={t('marketing_automation.segments.emptyBody', 'A segment is an audience you name once and target from any campaign — with "segments contains <reference>".')}
                />
              )}
            />

            {counting ? <Spinner /> : null}
            {members ? (
              <div className="space-y-1">
                <SectionHeader
                  title={t('marketing_automation.segments.membersTitle', 'Members')}
                  count={(members.items ?? []).length}
                />
                <div className="text-xs text-muted-foreground">
                  {members.qualifier === 'exact'
                    ? t('marketing_automation.segments.membersExact', 'Every candidate was checked.')
                    : t('marketing_automation.segments.membersSample', 'A sample: {checked} candidates were checked, and the rest is decided per customer.')
                        .replace('{checked}', String(members.checked ?? 0))}
                </div>
                {(members.items ?? []).length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    {t('marketing_automation.segments.noMembers', 'Nobody matches this segment.')}
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {(members.items ?? []).map((member) => (
                      <li key={member.id} className="flex items-baseline justify-between gap-2 border-b border-border py-1 text-sm">
                        <a className="truncate underline" href={`/backend/marketing/customers/${member.id}`}>
                          {member.displayName ?? member.email ?? member.id}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>

          <aside className="space-y-3">
            <SectionHeader
              title={selected
                ? t('marketing_automation.segments.editing', 'Editing {name}').replace('{name}', selected.name)
                : t('marketing_automation.segments.new', 'New segment')}
            />
            <div className="space-y-1">
              <Label htmlFor="segment-name">{t('marketing_automation.segments.columns.name', 'Name')}</Label>
              <Input
                id="segment-name"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
              {selected ? (
                <div className="text-xs text-muted-foreground">
                  {t('marketing_automation.segments.referenceHint', 'Referenced in an audience as {slug}. It does not change when the name does.')
                    .replace('{slug}', selected.slug)}
                </div>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="segment-description">{t('marketing_automation.segments.description', 'Description')}</Label>
              <Input
                id="segment-description"
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <div className="text-overline text-muted-foreground">
                {t('marketing_automation.segments.definition', 'Who is in it')}
              </div>
              {/* The platform's own condition builder: a segment IS an audience expression. */}
              <ConditionBuilder
                value={draft.expression}
                onChangeAction={(value) => setDraft({ ...draft, expression: value })}
              />
            </div>
            <div className="flex gap-2">
              <Button disabled={saving || !draft.name.trim()} onClick={() => void save()}>
                {saving ? <Spinner /> : t('marketing_automation.action.save', 'Save')}
              </Button>
              {selected ? (
                <Button variant="outline" onClick={startNew}>
                  {t('marketing_automation.segments.new', 'New segment')}
                </Button>
              ) : null}
            </div>
          </aside>
        </div>
      </PageBody>
    </Page>
  )
}
