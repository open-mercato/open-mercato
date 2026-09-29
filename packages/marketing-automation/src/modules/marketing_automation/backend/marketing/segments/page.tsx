"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { LineChart } from '@open-mercato/ui/backend/charts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
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
import { useUnsavedGuard } from '../../../components/useUnsavedGuard'
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

type HistoryPoint = { day: string; size: number; qualifier: string }

type Overlap = {
  a?: { id: string; name: string; size: number }
  b?: { id: string; name: string; size: number }
  both?: number
  qualifier?: 'exact' | 'sample'
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
  const [history, setHistory] = React.useState<HistoryPoint[] | null>(null)
  const [overlapWith, setOverlapWith] = React.useState('')
  const [overlap, setOverlap] = React.useState<Overlap | null>(null)
  const [acting, setActing] = React.useState(false)

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

  /**
   * What the editor was last loaded with, so "has this been edited" is answerable.
   *
   * An audience expression is built by clicking through a condition tree — minutes of work with nothing
   * written down anywhere — and picking another segment from the list simply overwrote it. No warning, no way
   * back. The baseline is compared structurally rather than tracking a dirty flag per field, because the
   * expression is a nested object and a flag would have to be set from inside the builder.
   */
  const [baseline, setBaseline] = React.useState<string>(JSON.stringify({ name: '', description: '', expression: null }))
  const isDirty = JSON.stringify(draft) !== baseline

  const applyDraft = (next: { name: string; description: string; expression: GroupCondition | null }) => {
    setDraft(next)
    setBaseline(JSON.stringify(next))
  }

  /**
   * The same protection for leaving the SCREEN, not just for switching segments.
   *
   * `leaveDraft` covers picking another segment; this covers the breadcrumb, a sidebar link and the browser's
   * back button — the routes out that an unfinished audience expression was previously lost through.
   */
  useUnsavedGuard(isDirty, async () => confirm({
    title: t('marketing_automation.segments.discardTitle', 'Discard unsaved changes?'),
    text: t(
      'marketing_automation.segments.discardText',
      'This segment has changes that have not been saved. Leaving now loses them.',
    ),
    variant: 'destructive',
  }))

  /** Asks before throwing away work, and only when there is work to throw away. */
  const leaveDraft = async (): Promise<boolean> => {
    if (!isDirty) return true
    return confirm({
      title: t('marketing_automation.segments.discardTitle', 'Discard unsaved changes?'),
      text: t(
        'marketing_automation.segments.discardText',
        'This segment has changes that have not been saved. Leaving now loses them.',
      ),
    })
  }

  const startNew = async () => {
    if (!(await leaveDraft())) return
    setSelected(null)
    setMembers(null)
    applyDraft({ name: '', description: '', expression: null })
  }

  const startEdit = async (row: SegmentRow) => {
    if (!(await leaveDraft())) return
    setSelected(row)
    setMembers(null)
    applyDraft({ name: row.name, description: row.description ?? '', expression: row.expression })
  }

  /** Used after a save or a delete, where there is nothing left to lose and nothing to ask about. */
  const resetDraft = () => {
    setSelected(null)
    setMembers(null)
    applyDraft({ name: '', description: '', expression: null })
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
      resetDraft()
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
      if (selected?.id === row.id) resetDraft()
      await load()
    } catch (error) {
      if (!surfaceRecordConflict(error, t)) {
        flash(t('marketing_automation.segments.deleteFailed', 'Could not remove the segment.'), 'error')
      }
    }
  }

  const showMembers = async (row: SegmentRow) => {
    // This loads another segment into the editor too, so it asks the same question.
    if (!(await leaveDraft())) return
    setCounting(true)
    setMembers(null)
    setHistory(null)
    setOverlap(null)
    setSelected(row)
    applyDraft({ name: row.name, description: row.description ?? '', expression: row.expression })
    try {
      const [membersResult, historyResult] = await Promise.all([
        apiCall<MembersAnswer>(`${SEGMENTS_PATH}/${row.id}/members`),
        apiCall<{ items?: HistoryPoint[] }>(`${SEGMENTS_PATH}/${row.id}/history`),
      ])
      setMembers(membersResult.ok ? (membersResult.result ?? {}) : {})
      setHistory(historyResult.ok && Array.isArray(historyResult.result?.items) ? historyResult.result.items : [])
    } catch {
      flash(t('marketing_automation.segments.membersFailed', 'Could not resolve the members.'), 'error')
    } finally {
      setCounting(false)
    }
  }

  const compareWith = async (row: SegmentRow, otherId: string) => {
    setOverlap(null)
    try {
      const result = await apiCall<Overlap>(`${SEGMENTS_PATH}/overlap?a=${row.id}&b=${otherId}`)
      setOverlap(result.ok ? (result.result ?? {}) : {})
    } catch {
      flash(t('marketing_automation.segments.overlapFailed', 'Could not compare the segments.'), 'error')
    }
  }

  /**
   * Starts a bulk action and hands the progress job to the shared top bar.
   *
   * Nothing is awaited beyond the 202: the work outlives this page, which is the entire reason it is a queued
   * job rather than a loop in the browser.
   */
  const runAction = async (row: SegmentRow, action: { kind: 'add_points'; points: number }) => {
    const confirmed = await confirm({
      text: t('marketing_automation.segments.confirmAction', 'Apply this to everybody currently in the segment?'),
    })
    if (!confirmed) return
    setActing(true)
    try {
      await apiCallOrThrow(`${SEGMENTS_PATH}/${row.id}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action),
      })
      flash(t('marketing_automation.segments.actionQueued', 'Started. Watch it in the progress bar at the top.'), 'success')
    } catch (error) {
      const body = (error as { body?: { code?: unknown } } | null)?.body
      flash(
        typeof body?.code === 'string' && body.code === 'marketing_automation.errors.progressUnavailable'
          ? t('marketing_automation.errors.progressUnavailable', 'This installation cannot track background work, so bulk actions are unavailable.')
          : t('marketing_automation.segments.actionFailed', 'Could not start the action.'),
        'error',
      )
    } finally {
      setActing(false)
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
          <Button variant="outline" size="sm" onClick={() => { void startEdit(row.original) }}>
            {t('marketing_automation.segments.edit', 'Edit')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void remove(row.original)}>
            {t('marketing_automation.action.removeNode', 'Remove')}
          </Button>
        </div>
      ),
    },
  /**
   * The unsaved-work guard depends on every closure this memo captures, so they all belong in the deps.
   *
   * With `[t, selected]` the row buttons kept `startEdit` and `showMembers` from the render where `selected` last
   * changed — and with them a stale `isDirty`. Build a condition tree without changing the selection, click Edit
   * on another segment, and `leaveDraft()` saw `isDirty === false`: no confirm, and minutes of work gone. Exactly
   * the loss the guard was added to prevent, defeated by a dependency list.
   */
  ], [t, startEdit, showMembers, remove])

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

            {selected && history && history.length > 1 ? (
              <div>
                <SectionHeader title={t('marketing_automation.segments.history', 'Size over time')} />
                {/* Drawn only with more than one point: a single dot is not a trend, and a chart of it
                    suggests one. */}
                <LineChart
                  data={history as unknown as Record<string, string | number | null>[]}
                  index="day"
                  categories={['size']}
                  categoryLabels={{ size: t('marketing_automation.segments.size', 'Members') }}
                  curveType="monotone"
                  emptyMessage={t('marketing_automation.segments.noHistory', 'No sizes recorded yet.')}
                />
              </div>
            ) : selected && history ? (
              <div className="text-xs text-muted-foreground">
                {t('marketing_automation.segments.historyPending', 'Sizes are recorded once a day, so a trend appears from tomorrow.')}
              </div>
            ) : null}

            {selected ? (
              <div className="space-y-2">
                <SectionHeader title={t('marketing_automation.segments.tools', 'Compare and act')} />
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-64 space-y-1">
                    <Label htmlFor="overlap-with">{t('marketing_automation.segments.overlapWith', 'Overlap with')}</Label>
                    <Select
                      value={overlapWith || undefined}
                      onValueChange={(value) => {
                        setOverlapWith(value)
                        void compareWith(selected, value)
                      }}
                    >
                      <SelectTrigger id="overlap-with" className="w-full">
                        <SelectValue placeholder={t('marketing_automation.segments.pickSegment', 'Pick a segment')} />
                      </SelectTrigger>
                      <SelectContent>
                        {rows.filter((row) => row.id !== selected.id).map((row) => (
                          <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button variant="outline" disabled={acting} onClick={() => void runAction(selected, { kind: 'add_points', points: 10 })}>
                    {t('marketing_automation.segments.awardPoints', 'Award 10 points to members')}
                  </Button>
                  <Button variant="outline" asChild>
                    <a href={`${SEGMENTS_PATH}/${selected.id}/export`} download>
                      {t('marketing_automation.segments.export', 'Export CSV')}
                    </a>
                  </Button>
                </div>
                {overlap?.both !== undefined ? (
                  <div className="text-xs text-muted-foreground">
                    {t('marketing_automation.segments.overlapResult', '{both} of {a} are also in {b}{qualifier}')
                      .replace('{both}', String(overlap.both))
                      .replace('{a}', String(overlap.a?.size ?? 0))
                      .replace('{b}', overlap.b?.name ?? '')
                      .replace('{qualifier}', overlap.qualifier === 'exact' ? '' : ` · ${t('marketing_automation.segments.sampleNote', 'sampled')}`)}
                  </div>
                ) : null}
              </div>
            ) : null}

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
                <Button variant="outline" onClick={() => { void startNew() }}>
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
