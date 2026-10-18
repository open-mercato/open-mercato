'use client'

import * as React from 'react'
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
import { dealStatusVocabularySchema } from '../data/dealStatusVocabulary'
import type { DealStatusVocabulary } from '../lib/dealStatus'
import { useDealStatusVocabulary } from './hooks/useDealStatusVocabulary'

const FORM_ID = 'customers-deals-settings:status-vocabulary'
const VOCABULARY_GROUPS = ['won', 'lost', 'closed'] as const

type VocabularyFormValues = {
  won: string
  lost: string
  closed: string
  updatedAt: string | null
}

export function DealStatusVocabularySettings(): React.ReactElement {
  const t = useT()
  const queryClient = useQueryClient()
  const { vocabulary, source, updatedAt, isLoading, isError, refetch } = useDealStatusVocabulary()
  const [isResetting, setIsResetting] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: FORM_ID, blockedMessage: t('ui.forms.flash.saveBlocked') })

  const initialValues = React.useMemo<VocabularyFormValues>(() => ({
    won: vocabulary.won.join(', '),
    lost: vocabulary.lost.join(', '),
    closed: vocabulary.closed.join(', '),
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
        onChange={(event) => setValue(event.target.value)}
        autoFocus={autoFocus}
        disabled={disabled}
      />
    ),
  })), [t])

  const persist = React.useCallback(async (nextVocabulary: DealStatusVocabulary | null) => {
    await readApiResultOrThrow('/api/customers/settings/deal-status-vocabulary', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vocabulary: nextVocabulary }),
    }, { errorMessage: t('customers.settings.dealStatusVocabulary.errorSave') })
    await queryClient.invalidateQueries({ queryKey: ['customers'] })
    flash(t('customers.settings.dealStatusVocabulary.saved'), 'success')
  }, [queryClient, t])

  const handleSubmit = React.useCallback(async (values: VocabularyFormValues) => {
    const parsed = dealStatusVocabularySchema.safeParse({
      won: values.won.split(',').map((value) => value.trim()),
      lost: values.lost.split(',').map((value) => value.trim()),
      closed: values.closed.split(',').map((value) => value.trim()),
    })
    if (!parsed.success) {
      throw createCrudFormError(t('customers.settings.dealStatusVocabulary.validationError'))
    }
    setIsSaving(true)
    try {
      await persist(parsed.data)
    } finally {
      setIsSaving(false)
    }
  }, [persist, t])

  const handleReset = React.useCallback(async () => {
    setIsResetting(true)
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(buildOptimisticLockHeader(updatedAt), () => persist(null)),
        mutationPayload: { vocabulary: null },
        context: { formId: FORM_ID, resourceKind: 'customers.deal_status_vocabulary', retryLastMutation },
      })
    } catch (error) {
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
