"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { ConditionBuilder } from '@open-mercato/core/modules/business_rules/components/ConditionBuilder'
import type { GroupCondition } from '@open-mercato/core/modules/business_rules/lib/expression-evaluator'
import { useUnsavedGuard } from '../../../components/useUnsavedGuard'

const RULES_PATH = '/api/marketing_automation/score-rules'

const PAGE_SIZE = 100

type ScoreRuleRow = {
  id: string
  name: string
  description: string | null
  expression: GroupCondition | null
  points: number
  isEnabled: boolean
  updatedAt: string
}

type Draft = {
  name: string
  description: string
  expression: GroupCondition | null
  points: string
  isEnabled: boolean
}

const EMPTY_DRAFT: Draft = { name: '', description: '', expression: null, points: '10', isEnabled: true }

function draftFrom(row: ScoreRuleRow): Draft {
  return {
    name: row.name,
    description: row.description ?? '',
    expression: row.expression,
    points: String(row.points),
    isEnabled: row.isEnabled,
  }
}

/** A whole, non-zero number, or null — the same rule the server applies, checked before the round trip. */
function parsePoints(value: string): number | null {
  const parsed = Number(value.trim())
  if (!value.trim() || !Number.isInteger(parsed) || parsed === 0) return null
  return parsed
}

function formatPoints(points: number): string {
  return points > 0 ? `+${points}` : String(points)
}

/**
 * Score rules: points for who a customer is.
 *
 * The condition editor is the platform's condition builder, as on the segments screen — a rule's condition IS an
 * audience expression. Saving queues a pass that applies the change to every customer; the customer profile can
 * recalculate one customer immediately.
 */
export default function ScoreRulesPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [rows, setRows] = React.useState<ScoreRuleRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [selected, setSelected] = React.useState<ScoreRuleRow | null>(null)
  const [draft, setDraft] = React.useState<Draft>(EMPTY_DRAFT)
  const [baseline, setBaseline] = React.useState<string>(JSON.stringify(EMPTY_DRAFT))
  const [saving, setSaving] = React.useState(false)
  const [truncated, setTruncated] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const result = await apiCall<{ items?: ScoreRuleRow[]; total?: number }>(`${RULES_PATH}?pageSize=${PAGE_SIZE}&page=1`)
      if (!result.ok || !Array.isArray(result.result?.items)) {
        setLoadFailed(true)
        return
      }
      setRows(result.result.items)
      // Only the first two hundred rules are evaluated, so a longer list is a problem to show, not to page through.
      setTruncated(typeof result.result.total === 'number' && result.result.total > result.result.items.length)
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load, scopeVersion])

  const isDirty = JSON.stringify(draft) !== baseline

  const applyDraft = (next: Draft) => {
    setDraft(next)
    setBaseline(JSON.stringify(next))
  }

  useUnsavedGuard(isDirty, async () => confirm({
    title: t('marketing_automation.scoreRules.discardTitle', 'Discard unsaved changes?'),
    text: t('marketing_automation.scoreRules.discardText', 'This rule has changes that have not been saved. Leaving now loses them.'),
    variant: 'destructive',
  }))

  const leaveDraft = async (): Promise<boolean> => {
    if (!isDirty) return true
    return confirm({
      title: t('marketing_automation.scoreRules.discardTitle', 'Discard unsaved changes?'),
      text: t('marketing_automation.scoreRules.discardText', 'This rule has changes that have not been saved. Leaving now loses them.'),
    })
  }

  const startNew = async () => {
    if (!(await leaveDraft())) return
    setSelected(null)
    applyDraft(EMPTY_DRAFT)
  }

  const startEdit = async (row: ScoreRuleRow) => {
    if (!(await leaveDraft())) return
    setSelected(row)
    applyDraft(draftFrom(row))
  }

  const resetDraft = () => {
    setSelected(null)
    applyDraft(EMPTY_DRAFT)
  }

  const points = parsePoints(draft.points)

  const save = async () => {
    if (points === null) return
    setSaving(true)
    try {
      const payload = {
        name: draft.name,
        expression: draft.expression,
        points,
        isEnabled: draft.isEnabled,
      }
      if (selected) {
        await withScopedApiRequestHeaders(
          buildOptimisticLockHeader(selected.updatedAt),
          () => apiCallOrThrow(`${RULES_PATH}/${selected.id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...payload, description: draft.description.trim() || null, updatedAt: selected.updatedAt }),
          }),
        )
      } else {
        await apiCallOrThrow(RULES_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...payload, description: draft.description.trim() || undefined }),
        })
      }
      flash(t('marketing_automation.scoreRules.saved', 'Rule saved. Scores are being recalculated in the background.'), 'success')
      resetDraft()
      await load()
    } catch (error) {
      if (!surfaceRecordConflict(error, t)) {
        const body = (error as { body?: { code?: unknown } } | null)?.body
        const code = typeof body?.code === 'string' ? body.code : null
        flash(
          code === 'marketing_automation.errors.scoreRuleSelfReference'
            ? t('marketing_automation.errors.scoreRuleSelfReference', 'A score rule cannot use the score or segments in its condition.')
            : t('marketing_automation.scoreRules.saveFailed', 'Could not save the rule.'),
          'error',
        )
      }
    } finally {
      setSaving(false)
    }
  }

  const remove = async (row: ScoreRuleRow) => {
    const confirmed = await confirm({
      text: t('marketing_automation.scoreRules.confirmDelete', 'Remove this rule? Everybody it awarded points to loses them.'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await withScopedApiRequestHeaders(
        buildOptimisticLockHeader(row.updatedAt),
        () => apiCallOrThrow(`${RULES_PATH}/${row.id}`, { method: 'DELETE' }),
      )
      if (selected?.id === row.id) resetDraft()
      await load()
    } catch (error) {
      if (!surfaceRecordConflict(error, t)) {
        flash(t('marketing_automation.scoreRules.deleteFailed', 'Could not remove the rule.'), 'error')
      }
    }
  }

  const columns = React.useMemo<ColumnDef<ScoreRuleRow>[]>(() => [
    { accessorKey: 'name', header: t('marketing_automation.scoreRules.columns.name', 'Name') },
    {
      accessorKey: 'points',
      header: t('marketing_automation.scoreRules.columns.points', 'Points'),
      cell: ({ row }) => <span className="font-mono text-sm">{formatPoints(row.original.points)}</span>,
    },
    {
      accessorKey: 'isEnabled',
      header: t('marketing_automation.scoreRules.columns.status', 'Status'),
      cell: ({ row }) => (
        <Badge variant={row.original.isEnabled ? 'success' : 'neutral'}>
          {row.original.isEnabled
            ? t('marketing_automation.scoreRules.enabled', 'Active')
            : t('marketing_automation.scoreRules.disabled', 'Off')}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button variant="outline" size="sm" onClick={() => { void startEdit(row.original) }}>
            {t('marketing_automation.scoreRules.edit', 'Edit')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void remove(row.original)}>
            {t('marketing_automation.action.removeNode', 'Remove')}
          </Button>
        </div>
      ),
    },
  // Every closure the row buttons call is a dependency, or they keep a stale `isDirty` and skip the unsaved guard.
  ], [t, startEdit, remove])

  return (
    <Page>
      <PageBody>
        {ConfirmDialogElement}
        {loadFailed ? (
          <div className="mb-3">
            <ErrorMessage label={t('marketing_automation.scoreRules.loadFailed', 'Could not load the score rules.')} />
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
                  title={t('marketing_automation.scoreRules.emptyTitle', 'No score rules yet')}
                  description={t(
                    'marketing_automation.scoreRules.emptyBody',
                    'A score rule awards points for who a customer is — where they live, which tags they have, how much they have spent — on top of what campaigns award.',
                  )}
                />
              )}
            />
            {truncated ? (
              <div className="text-xs text-muted-foreground">
                {t('marketing_automation.scoreRules.truncated', 'Only the first {count} rules are listed and evaluated.')
                  .replace('{count}', String(rows.length))}
              </div>
            ) : null}
          </div>

          <aside className="space-y-3">
            <SectionHeader
              title={selected
                ? t('marketing_automation.scoreRules.editing', 'Editing {name}').replace('{name}', selected.name)
                : t('marketing_automation.scoreRules.new', 'New rule')}
            />
            <div className="space-y-1">
              <Label htmlFor="score-rule-name">{t('marketing_automation.scoreRules.columns.name', 'Name')}</Label>
              <Input
                id="score-rule-name"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
              <div className="text-xs text-muted-foreground">
                {t('marketing_automation.scoreRules.nameHint', 'Shown in a customer\'s score history as the reason for the points.')}
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="score-rule-description">{t('marketing_automation.scoreRules.description', 'Description')}</Label>
              <Input
                id="score-rule-description"
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="score-rule-points">{t('marketing_automation.scoreRules.columns.points', 'Points')}</Label>
              <Input
                id="score-rule-points"
                inputMode="numeric"
                value={draft.points}
                onChange={(event) => setDraft({ ...draft, points: event.target.value })}
              />
              <div className="text-xs text-muted-foreground">
                {points === null
                  ? t('marketing_automation.scoreRules.pointsInvalid', 'A whole number other than zero. Negative numbers deduct.')
                  : t('marketing_automation.scoreRules.pointsHint', 'Negative numbers deduct.')}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="score-rule-enabled"
                checked={draft.isEnabled}
                onCheckedChange={(checked) => setDraft({ ...draft, isEnabled: checked })}
              />
              <Label htmlFor="score-rule-enabled">{t('marketing_automation.scoreRules.enabled', 'Active')}</Label>
            </div>
            <div className="space-y-1">
              <div className="text-overline text-muted-foreground">
                {t('marketing_automation.scoreRules.definition', 'Who gets the points')}
              </div>
              <ConditionBuilder
                value={draft.expression}
                onChangeAction={(value) => setDraft({ ...draft, expression: value })}
              />
              <div className="text-xs text-muted-foreground">
                {t(
                  'marketing_automation.scoreRules.definitionHint',
                  'Anything a campaign audience can use except the score itself and segments. With no condition, everybody gets the points.',
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Button disabled={saving || !draft.name.trim() || points === null} onClick={() => void save()}>
                {saving ? <Spinner /> : t('marketing_automation.action.save', 'Save')}
              </Button>
              {selected ? (
                <Button variant="outline" onClick={() => { void startNew() }}>
                  {t('marketing_automation.scoreRules.new', 'New rule')}
                </Button>
              ) : null}
            </div>
          </aside>
        </div>
      </PageBody>
    </Page>
  )
}
