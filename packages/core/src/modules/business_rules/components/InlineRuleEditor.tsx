"use client"

import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch, withScopedApiHeaders } from '@open-mercato/ui/backend/utils/api'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { readJsonSafe } from '@open-mercato/ui/backend/utils/serverErrors'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ConditionBuilder } from './ConditionBuilder'
import { ActionBuilder } from './ActionBuilder'
import {
  businessRuleFormSchema,
  createFieldDefinitions,
  createFormGroups,
  defaultFormValues,
  type BusinessRuleFormValues,
} from './formConfig'
import { parseRuleToFormValues } from './utils/formHelpers'

/**
 * Identity of a rule the editor just persisted, handed back to the embedding
 * module so it can select/refresh without re-reading the API itself.
 */
export type InlineRuleEditorSavedRule = {
  id: string
  ruleId: string
  ruleName: string
}

export type InlineRuleEditorProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Existing rule UUID to edit. Omit (or pass null) to create a new rule. */
  recordId?: string | null
  /** Pre-fills `entityType` on create so a host can scope newly authored rules. */
  defaultEntityType?: string
  /** Pre-fills `ruleType` on create. */
  defaultRuleType?: BusinessRuleFormValues['ruleType']
  onSaved?: (rule: InlineRuleEditorSavedRule) => void
  /**
   * Dependency-visibility slot ("used by: N workflows, M promotions"). Rendered
   * beside the form. business_rules owns the editor and the slot; each consuming
   * module owns its own usage lookup and passes the rendered panel in — that is
   * what keeps this component free of any consumer-module import.
   */
  usagePanel?: React.ReactNode
}

type RuleRecord = Record<string, unknown> & { updatedAt?: string | null; updated_at?: string | null }

function toRulePayload(values: BusinessRuleFormValues): Record<string, unknown> {
  return {
    ruleId: values.ruleId,
    ruleName: values.ruleName,
    description: values.description || null,
    ruleType: values.ruleType,
    ruleCategory: values.ruleCategory || null,
    entityType: values.entityType,
    eventType: values.eventType || null,
    conditionExpression: values.conditionExpression,
    successActions: values.successActions || null,
    failureActions: values.failureActions || null,
    enabled: values.enabled,
    priority: values.priority,
    version: values.version,
    effectiveFrom: values.effectiveFrom || null,
    effectiveTo: values.effectiveTo || null,
  }
}

/**
 * InlineRuleEditor — create or edit a single business rule inside a dialog,
 * owned by `business_rules` and embeddable by any module (spec
 * 2026-07-26-workflows-ux-redesign.md team decision #5, issue #4236).
 *
 * It is the same CrudForm the standalone rule pages render, so validation,
 * condition/action builders and optimistic locking behave identically; the
 * difference is that it never navigates — it reports the saved rule through
 * `onSaved` and lets the host refresh its own pickers.
 */
export function InlineRuleEditor({
  open,
  onOpenChange,
  recordId,
  defaultEntityType,
  defaultRuleType,
  onSaved,
  usagePanel,
}: InlineRuleEditorProps) {
  const t = useT()
  const isEdit = Boolean(recordId)
  const [rule, setRule] = React.useState<RuleRecord | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    if (!recordId) {
      setRule(null)
      setLoadError(null)
      setIsLoading(false)
      return
    }
    let cancelled = false
    setIsLoading(true)
    setLoadError(null)
    const load = async () => {
      try {
        const response = await apiFetch(`/api/business_rules/rules/${recordId}`)
        if (!response.ok) {
          if (!cancelled) setLoadError(t('business_rules.errors.fetchFailed'))
          return
        }
        const body = (await readJsonSafe<RuleRecord>(response)) ?? null
        if (!cancelled) setRule(body)
      } catch {
        if (!cancelled) setLoadError(t('business_rules.errors.fetchFailed'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [open, recordId, t])

  const initialValues = React.useMemo<Partial<BusinessRuleFormValues>>(() => {
    if (isEdit) {
      return rule ? parseRuleToFormValues(rule) : {}
    }
    return {
      ...defaultFormValues,
      ...(defaultEntityType ? { entityType: defaultEntityType } : {}),
      ...(defaultRuleType ? { ruleType: defaultRuleType } : {}),
    }
  }, [defaultEntityType, defaultRuleType, isEdit, rule])

  const fields = React.useMemo(() => createFieldDefinitions(t), [t])
  const groups = React.useMemo(() => createFormGroups(t, ConditionBuilder, ActionBuilder), [t])

  const lockedUpdatedAt = (rule?.updatedAt ?? rule?.updated_at ?? null) as string | null

  const handleSubmit = React.useCallback(async (values: BusinessRuleFormValues) => {
    const payload = toRulePayload(values)
    const request = () => (isEdit
      ? apiFetch('/api/business_rules/rules', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, id: recordId }),
        })
      : apiFetch('/api/business_rules/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }))

    const lockHeaders = isEdit ? buildOptimisticLockHeader(lockedUpdatedAt) : {}
    const response = Object.keys(lockHeaders).length
      ? await withScopedApiHeaders(lockHeaders, request)
      : await request()

    if (!response.ok) {
      const body = (await readJsonSafe<Record<string, unknown>>(response)) ?? {}
      const message =
        (typeof body.error === 'string' && body.error) ||
        (typeof body.message === 'string' && body.message) ||
        t(isEdit ? 'business_rules.errors.updateFailed' : 'business_rules.errors.createFailed')
      throw new CrudHttpError(response.status, { ...body, error: message })
    }

    const body = (await readJsonSafe<{ id?: string }>(response)) ?? {}
    const savedId = (isEdit ? recordId : body.id) ?? ''
    onSaved?.({ id: savedId, ruleId: values.ruleId, ruleName: values.ruleName })
    onOpenChange(false)
  }, [isEdit, lockedUpdatedAt, onOpenChange, onSaved, recordId, t])

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col !p-0 [&_.grid]:!grid-cols-1">
        <DialogHeader className="flex-shrink-0 p-6 pb-4 border-b border-border/70">
          <DialogTitle>
            {t(isEdit ? 'business_rules.rules.inline.editTitle' : 'business_rules.rules.inline.createTitle')}
          </DialogTitle>
          <DialogDescription>
            {t(isEdit ? 'business_rules.rules.inline.editDescription' : 'business_rules.rules.inline.createDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 gap-4 overflow-hidden px-6 pb-6">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                <Spinner className="h-6 w-6" />
                <span className="text-sm">{t('business_rules.rules.edit.loading')}</span>
              </div>
            ) : loadError ? (
              <p className="py-12 text-center text-sm text-status-error-text">{loadError}</p>
            ) : (
              <CrudForm
                key={recordId ?? 'create'}
                schema={businessRuleFormSchema}
                fields={fields}
                groups={groups}
                initialValues={initialValues}
                optimisticLockUpdatedAt={lockedUpdatedAt}
                onSubmit={handleSubmit}
                embedded
                submitLabel={t(isEdit ? 'business_rules.rules.form.update' : 'business_rules.rules.form.create')}
                extraActions={
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                    {t('business_rules.rules.form.cancel')}
                  </Button>
                }
              />
            )}
          </div>
          {usagePanel ? (
            <div className="hidden w-64 shrink-0 self-start overflow-y-auto lg:block">{usagePanel}</div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
