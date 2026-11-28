'use client'

import * as React from 'react'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { ConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useQueryClient } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField, type CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { dealStatusVocabularySchema, dealStatusReclassificationErrorSchema, type DealStatusReclassificationImpact } from '../data/dealStatusVocabulary'
import { formatDealStatusAliases, parseDealStatusAliases } from '../lib/dealStatusVocabularyInput'
import type { DealStatusVocabulary } from '../lib/dealStatus'
import { useDealStatusVocabulary } from './hooks/useDealStatusVocabulary'

const FORM_ID = 'customers-deals-settings:status-vocabulary'
const VOCABULARY_GROUPS = ['won', 'lost', 'closed'] as const
const INTERRUPTED_CHANGE = Symbol('deal-status-vocabulary-interrupted')

type VocabularyFormValues = {
  won: string
  lost: string
  closed: string
  updatedAt: string | null
}

export function DealStatusVocabularySettings(): React.ReactElement {
  const t = useT()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const currentScope = React.useRef(scopeVersion)
  currentScope.current = scopeVersion
  const [impact, setImpact] = React.useState<DealStatusReclassificationImpact | null>(null)
  const confirmedDialogClose = React.useRef(false)
  const decideImpact = React.useRef<((confirmed: boolean) => void) | null>(null)
  const finishConfirmation = React.useCallback((confirmed = false) => {
    decideImpact.current?.(confirmed)
    decideImpact.current = null
    setImpact(null)
  }, [])
  const { vocabulary, source, updatedAt, isLoading, isError, refetch } = useDealStatusVocabulary()
  React.useEffect(() => { finishConfirmation() }, [scopeVersion, updatedAt, finishConfirmation])
  React.useEffect(() => () => { decideImpact.current?.(false) }, [])
  const [isResetting, setIsResetting] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: FORM_ID, blockedMessage: t('ui.forms.flash.saveBlocked') })

  const initialValues = React.useMemo<VocabularyFormValues>(() => ({
    won: formatDealStatusAliases(vocabulary.won),
    lost: formatDealStatusAliases(vocabulary.lost),
    closed: formatDealStatusAliases(vocabulary.closed),
    updatedAt,
  }), [vocabulary, updatedAt])

  const fields = React.useMemo<CrudField[]>(() => VOCABULARY_GROUPS.map((group) => ({
    id: group,
    type: 'custom',
    label: t(`customers.settings.dealStatusVocabulary.${group}`),
    required: true,
    component: ({ id, value, setValue, autoFocus, disabled }: CrudCustomFieldRenderProps) => (
      <Input
        id={`${FORM_ID}:${id}`}
        name={id}
        aria-label={t(`customers.settings.dealStatusVocabulary.${group}`)}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => { finishConfirmation(); setValue(event.target.value) }}
        autoFocus={autoFocus}
        disabled={disabled}
      />
    ),
  })), [t, finishConfirmation])

  const persist = React.useCallback(async (nextVocabulary: DealStatusVocabulary | null, expectedUpdatedAt: string | null) => {
    const interrupt = () => {
      throw Object.assign(createCrudFormError(t('customers.settings.dealStatusVocabulary.saveInterrupted')), { [INTERRUPTED_CHANGE]: true })
    }
    let reclassificationConfirmation: { fingerprint: string } | undefined
    while (currentScope.current === scopeVersion) {
      try {
        await withScopedApiRequestHeaders(buildOptimisticLockHeader(expectedUpdatedAt), () => readApiResultOrThrow('/api/customers/settings/deal-status-vocabulary', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ vocabulary: nextVocabulary, ...(reclassificationConfirmation ? { reclassificationConfirmation } : {}) }),
        }, { errorMessage: t('customers.settings.dealStatusVocabulary.errorSave') }))
      } catch (error) {
        if (currentScope.current !== scopeVersion) return interrupt()
        const required = dealStatusReclassificationErrorSchema.safeParse(error)
        if (!required.success) throw error
        const confirmed = await new Promise<boolean>((resolve) => {
          decideImpact.current = resolve
          setImpact(required.data.impact)
        })
        if (!confirmed || currentScope.current !== scopeVersion) return interrupt()
        reclassificationConfirmation = { fingerprint: required.data.impact.fingerprint }
        continue
      }
      if (currentScope.current !== scopeVersion) return interrupt()
      await queryClient.invalidateQueries({ queryKey: ['customers'] })
      if (currentScope.current !== scopeVersion) return interrupt()
      flash(t('customers.settings.dealStatusVocabulary.saved'), 'success')
      return
    }
    interrupt()
  }, [queryClient, scopeVersion, t])

  const handleSubmit = React.useCallback(async (values: VocabularyFormValues) => {
    const parsed = dealStatusVocabularySchema.safeParse({
      won: parseDealStatusAliases(values.won),
      lost: parseDealStatusAliases(values.lost),
      closed: parseDealStatusAliases(values.closed),
    })
    if (!parsed.success) {
      const message = t('customers.settings.dealStatusVocabulary.validationError')
      const fieldErrors = Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), message]))
      throw createCrudFormError(message, fieldErrors)
    }
    setIsSaving(true)
    try {
      await persist(parsed.data, values.updatedAt)
    } finally {
      setIsSaving(false)
    }
  }, [persist, t])

  const handleReset = React.useCallback(async () => {
    setIsResetting(true)
    try {
      await runMutation({
        operation: () => persist(null, updatedAt),
        mutationPayload: { vocabulary: null },
        context: { formId: FORM_ID, resourceKind: 'customers.deal_status_vocabulary', retryLastMutation },
      })
    } catch (error) {
      if (typeof error === 'object' && error !== null && INTERRUPTED_CHANGE in error) return
      if (!surfaceRecordConflict(error, t)) {
        flash(t('customers.settings.dealStatusVocabulary.errorSave'), 'error')
      }
    } finally {
      setIsResetting(false)
    }
  }, [persist, retryLastMutation, runMutation, t, updatedAt])

  return (
    <section className="flex max-w-xl flex-col gap-4 rounded-lg border border-border bg-card p-6">
      <SectionHeader title={t('customers.settings.dealStatusVocabulary.title')} />
      <p className="text-sm text-muted-foreground">{t('customers.settings.dealStatusVocabulary.help')}</p>
      <p className="text-sm text-muted-foreground">{t('customers.settings.dealStatusVocabulary.tenantScope')}</p>
      <ConfirmDialog
        open={impact !== null}
        title={t('customers.settings.dealStatusVocabulary.confirmTitle')}
        text={t('customers.settings.dealStatusVocabulary.confirmImpact', { count: impact?.affectedDeals ?? 0 })}
        confirmText={t('customers.settings.dealStatusVocabulary.confirmApply')}
        onConfirm={() => { confirmedDialogClose.current = true; finishConfirmation(true) }}
        onOpenChange={(open) => {
          if (open) return
          if (confirmedDialogClose.current) confirmedDialogClose.current = false
          else finishConfirmation()
        }}
      />
      {isLoading ? <LoadingMessage label={t('customers.settings.dealStatusVocabulary.loading')} /> : isError ? (
        <ErrorMessage
          label={t('customers.settings.dealStatusVocabulary.errorLoad')}
          action={<Button type="button" variant="outline" onClick={() => void refetch()}>{t('customers.settings.dealStatusVocabulary.retry')}</Button>}
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t(`customers.settings.dealStatusVocabulary.source.${source}`)}</p>
          <CrudForm<VocabularyFormValues>
            formId={FORM_ID}
            embedded
            fields={fields}
            initialValues={initialValues}
            onSubmit={handleSubmit}
            isLoading={isResetting}
            submitLabel={t('customers.settings.dealStatusVocabulary.save')}
            extraActions={(
              <Button type="button" variant="outline" disabled={isSaving || isResetting || source !== 'tenant'} onClick={() => void handleReset()}>
                {t('customers.settings.dealStatusVocabulary.reset')}
              </Button>
            )}
          />
        </>
      )}
    </section>
  )
}
