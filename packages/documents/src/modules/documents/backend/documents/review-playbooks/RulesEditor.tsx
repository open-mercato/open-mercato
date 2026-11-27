"use client"

import * as React from 'react'
import { Info, OctagonAlert, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { createCrud, deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  emptyRuleDraft,
  normalizeReviewRules,
  REVIEW_RULES_API,
  REVIEW_RULES_PAGE_SIZE,
  REVIEW_SEVERITIES,
  REVIEW_SEVERITY_BADGE,
  ruleDraftErrors,
  ruleDraftFromRow,
  ruleDraftPayload,
  type ReviewRuleDraft,
  type ReviewRuleRow,
  type ReviewSeverity,
} from './reviewPlaybookModel'

const RESOURCE_KIND = 'documents.review_rule'
const MAX_RULE_PAGES = 5
const NEW_RULE_KEY = 'new'
const COLUMN_COUNT = 7

const SEVERITY_ICONS: Record<ReviewSeverity, typeof Info> = {
  blocking: OctagonAlert,
  warning: TriangleAlert,
  info: Info,
}

function readPageCount(value: unknown): number {
  if (!value || typeof value !== 'object') return 1
  const totalPages = (value as { totalPages?: unknown }).totalPages
  return typeof totalPages === 'number' && totalPages > 0 ? totalPages : 1
}

async function loadAllRules(playbookId: string): Promise<{ ok: boolean; rules: ReviewRuleRow[] }> {
  const rules: ReviewRuleRow[] = []
  for (let page = 1; page <= MAX_RULE_PAGES; page += 1) {
    const params = new URLSearchParams({ playbookId, page: String(page), pageSize: String(REVIEW_RULES_PAGE_SIZE) })
    const call = await apiCall<unknown>(`${REVIEW_RULES_API}?${params.toString()}`, undefined, { fallback: { items: [] } })
    if (!call.ok) return { ok: false, rules: [] }
    rules.push(...normalizeReviewRules(call.result))
    if (page >= readPageCount(call.result)) break
  }
  return { ok: true, rules: normalizeReviewRules({ items: rules }) }
}

function SeverityBadge({ severity }: { severity: ReviewSeverity }) {
  const t = useT()
  const Icon = SEVERITY_ICONS[severity]
  return (
    <StatusBadge variant={REVIEW_SEVERITY_BADGE[severity]}>
      <Icon className="size-3.5" aria-hidden="true" />
      {t(`documents.reviewPlaybooks.severity.${severity}`)}
    </StatusBadge>
  )
}

function RuleEditorForm({
  draft,
  saving,
  onChange,
  onSave,
  onCancel,
}: {
  draft: ReviewRuleDraft
  saving: boolean
  onChange: (draft: ReviewRuleDraft) => void
  onSave: () => void
  onCancel: () => void
}) {
  const t = useT()
  const [attempted, setAttempted] = React.useState(false)
  const errors = attempted ? ruleDraftErrors(draft) : {}
  const translateError = (message?: string) => (message ? t(message) : undefined)
  const submit = () => {
    setAttempted(true)
    if (Object.keys(ruleDraftErrors(draft)).length > 0) return
    onSave()
  }
  const update = <TKey extends keyof ReviewRuleDraft>(key: TKey, value: ReviewRuleDraft[TKey]) => onChange({ ...draft, [key]: value })
  return (
    <div
      className="space-y-4 rounded-md border border-border bg-muted/40 p-4"
      data-testid="documents-review-rule-editor"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault()
          submit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
    >
      <div className="grid gap-4 md:grid-cols-4">
        <FormField label={t('documents.reviewPlaybooks.rules.fields.code')} required error={translateError(errors.code)}>
          <Input value={draft.code} maxLength={64} onChange={(event) => update('code', event.target.value)} className="font-mono" autoFocus />
        </FormField>
        <FormField label={t('documents.reviewPlaybooks.rules.fields.title')} required error={translateError(errors.title)} className="md:col-span-2">
          <Input value={draft.title} maxLength={200} onChange={(event) => update('title', event.target.value)} />
        </FormField>
        <FormField label={t('documents.reviewPlaybooks.rules.fields.topic')} error={translateError(errors.topic)}>
          <Input value={draft.topic} maxLength={120} onChange={(event) => update('topic', event.target.value)} />
        </FormField>
        <FormField label={t('documents.reviewPlaybooks.rules.fields.severity')} required>
          <Select value={draft.severity} onValueChange={(value) => update('severity', value as ReviewSeverity)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REVIEW_SEVERITIES.map((severity) => (
                <SelectItem key={severity} value={severity}>{t(`documents.reviewPlaybooks.severity.${severity}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label={t('documents.reviewPlaybooks.rules.fields.sortOrder')} error={translateError(errors.sortOrder)}>
          <Input value={draft.sortOrder} inputMode="numeric" onChange={(event) => update('sortOrder', event.target.value)} />
        </FormField>
        <div className="flex items-end md:col-span-2">
          <CheckboxField
            label={t('documents.reviewPlaybooks.rules.fields.isActive')}
            checked={draft.isActive}
            onCheckedChange={(checked) => update('isActive', checked === true)}
          />
        </div>
      </div>
      <FormField label={t('documents.reviewPlaybooks.rules.fields.position')} required error={translateError(errors.position)} description={t('documents.reviewPlaybooks.rules.fields.positionHelp')}>
        <Textarea value={draft.position} rows={3} maxLength={4000} onChange={(event) => update('position', event.target.value)} />
      </FormField>
      <FormField label={t('documents.reviewPlaybooks.rules.fields.preferredWording')} error={translateError(errors.preferredWording)} description={t('documents.reviewPlaybooks.rules.fields.preferredWordingHelp')}>
        <Textarea value={draft.preferredWording} rows={3} maxLength={4000} onChange={(event) => update('preferredWording', event.target.value)} />
      </FormField>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>{t('documents.actions.cancel')}</Button>
        <Button type="button" onClick={submit} disabled={saving} data-testid="documents-review-rule-save">
          {t('documents.reviewPlaybooks.rules.actions.save')}
        </Button>
      </div>
    </div>
  )
}

export function RulesEditor({ playbookId, onChanged }: { playbookId: string; onChanged: () => void }) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const mutationContextId = `documents-review-rules:${playbookId}`
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId, blockedMessage: t('ui.forms.flash.saveBlocked') })
  const [rules, setRules] = React.useState<ReviewRuleRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [editingKey, setEditingKey] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<ReviewRuleDraft | null>(null)
  const [saving, setSaving] = React.useState(false)
  const reload = React.useCallback(() => setReloadToken((value) => value + 1), [])

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    void loadAllRules(playbookId)
      .then((result) => {
        if (cancelled) return
        if (!result.ok) {
          setLoadError(true)
          return
        }
        setRules(result.rules)
      })
      .catch(() => { if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [playbookId, reloadToken])

  const closeEditor = React.useCallback(() => {
    setEditingKey(null)
    setDraft(null)
  }, [])

  const startCreate = React.useCallback(() => {
    const nextSortOrder = rules.reduce((max, rule) => Math.max(max, rule.sortOrder), 0) + 10
    setEditingKey(NEW_RULE_KEY)
    setDraft(emptyRuleDraft(nextSortOrder))
  }, [rules])

  const startEdit = React.useCallback((rule: ReviewRuleRow) => {
    setEditingKey(rule.id)
    setDraft(ruleDraftFromRow(rule))
  }, [])

  const saveDraft = React.useCallback(async () => {
    if (!draft || !editingKey) return
    const editing = editingKey === NEW_RULE_KEY ? null : rules.find((rule) => rule.id === editingKey) ?? null
    const payload = ruleDraftPayload(draft)
    setSaving(true)
    try {
      await runMutation({
        operation: () => editing
          ? withScopedApiRequestHeaders(buildOptimisticLockHeader(editing.updatedAt), () =>
            updateCrud('documents/review-rules', { id: editing.id, ...payload }, {
              errorMessage: t('documents.reviewPlaybooks.rules.saveError'),
            }),
          )
          : createCrud('documents/review-rules', { playbookId, ...payload }, {
            errorMessage: t('documents.reviewPlaybooks.rules.saveError'),
          }),
        context: { formId: mutationContextId, resourceKind: RESOURCE_KIND, resourceId: editing?.id ?? playbookId, retryLastMutation },
        mutationPayload: { playbookId, ...payload },
      })
      flash(t(editing ? 'documents.reviewPlaybooks.rules.updated' : 'documents.reviewPlaybooks.rules.created'), 'success')
      closeEditor()
      reload()
      onChanged()
    } catch (error) {
      if (surfaceRecordConflict(error, t, { onRefresh: () => { closeEditor(); reload() } })) return
      flash(error instanceof Error ? error.message : t('documents.reviewPlaybooks.rules.saveError'), 'error')
    } finally {
      setSaving(false)
    }
  }, [closeEditor, draft, editingKey, mutationContextId, onChanged, playbookId, reload, retryLastMutation, rules, runMutation, t])

  const deleteRule = React.useCallback(async (rule: ReviewRuleRow) => {
    const confirmed = await confirm({
      title: t('documents.reviewPlaybooks.rules.delete.title', { code: rule.code }),
      description: t('documents.reviewPlaybooks.rules.delete.description'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(buildOptimisticLockHeader(rule.updatedAt), () =>
          deleteCrud('documents/review-rules', rule.id, { errorMessage: t('documents.reviewPlaybooks.rules.deleteError') }),
        ),
        context: { formId: mutationContextId, resourceKind: RESOURCE_KIND, resourceId: rule.id, retryLastMutation },
        mutationPayload: { id: rule.id },
      })
      flash(t('documents.reviewPlaybooks.rules.deleted'), 'success')
      reload()
      onChanged()
    } catch (error) {
      if (surfaceRecordConflict(error, t, { onRefresh: reload })) return
      flash(error instanceof Error ? error.message : t('documents.reviewPlaybooks.rules.deleteError'), 'error')
    }
  }, [confirm, mutationContextId, onChanged, reload, retryLastMutation, runMutation, t])

  const editorRow = draft ? (
    <TableRow>
      <TableCell colSpan={COLUMN_COUNT}>
        <RuleEditorForm
          draft={draft}
          saving={saving}
          onChange={setDraft}
          onSave={() => void saveDraft()}
          onCancel={closeEditor}
        />
      </TableCell>
    </TableRow>
  ) : null

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-6" data-testid="documents-review-rules">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('documents.reviewPlaybooks.rules.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('documents.reviewPlaybooks.rules.description')}</p>
        </div>
        <Button type="button" onClick={startCreate} disabled={editingKey !== null} data-testid="documents-review-rule-add">
          <Plus className="size-4" aria-hidden="true" />
          {t('documents.reviewPlaybooks.rules.actions.add')}
        </Button>
      </div>
      {loading && rules.length === 0 ? <LoadingMessage label={t('documents.reviewPlaybooks.rules.loading')} /> : null}
      {loadError ? (
        <ErrorMessage
          label={t('documents.reviewPlaybooks.rules.loadError')}
          action={<Button type="button" size="sm" variant="outline" onClick={reload}>{t('documents.actions.retry')}</Button>}
        />
      ) : null}
      {!loadError ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('documents.reviewPlaybooks.rules.fields.code')}</TableHead>
                <TableHead>{t('documents.reviewPlaybooks.rules.fields.title')}</TableHead>
                <TableHead>{t('documents.reviewPlaybooks.rules.fields.topic')}</TableHead>
                <TableHead>{t('documents.reviewPlaybooks.rules.fields.severity')}</TableHead>
                <TableHead>{t('documents.reviewPlaybooks.rules.fields.sortOrder')}</TableHead>
                <TableHead>{t('documents.reviewPlaybooks.columns.status')}</TableHead>
                <TableHead><span className="sr-only">{t('documents.reviewPlaybooks.rules.actionsColumn')}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {editingKey === NEW_RULE_KEY ? editorRow : null}
              {rules.length === 0 && editingKey !== NEW_RULE_KEY && !loading ? (
                <TableRow>
                  <TableCell colSpan={COLUMN_COUNT} className="text-sm text-muted-foreground">
                    {t('documents.reviewPlaybooks.rules.empty')}
                  </TableCell>
                </TableRow>
              ) : null}
              {rules.map((rule) => (editingKey === rule.id ? (
                <React.Fragment key={rule.id}>{editorRow}</React.Fragment>
              ) : (
                <TableRow key={rule.id} data-testid={`documents-review-rule-${rule.code}`}>
                  <TableCell className="font-mono text-sm">{rule.code}</TableCell>
                  <TableCell className="font-medium">{rule.title}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{rule.topic ?? ''}</TableCell>
                  <TableCell><SeverityBadge severity={rule.severity} /></TableCell>
                  <TableCell className="text-sm">{rule.sortOrder}</TableCell>
                  <TableCell>
                    <StatusBadge variant={rule.isActive ? 'success' : 'neutral'} dot>
                      {t(rule.isActive ? 'documents.reviewPlaybooks.status.active' : 'documents.reviewPlaybooks.status.inactive')}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <IconButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t('documents.reviewPlaybooks.rules.actions.edit', { code: rule.code })}
                        disabled={editingKey !== null}
                        onClick={() => startEdit(rule)}
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t('documents.reviewPlaybooks.rules.actions.delete', { code: rule.code })}
                        disabled={editingKey !== null}
                        onClick={() => void deleteRule(rule)}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </IconButton>
                    </div>
                  </TableCell>
                </TableRow>
              )))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      {ConfirmDialogElement}
    </section>
  )
}

export default RulesEditor
