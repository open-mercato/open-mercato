"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Briefcase, Save } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { dealFormSchema } from '../DealForm'
import { createDictionarySelectLabels } from '../utils'
import { DealSectionCard } from './DealSectionCard'
import { DealDetailsFields } from './DealDetailsFields'
import { DealAssociationsSection } from './DealAssociationsSection'
import { DealCreateSidebar } from './DealCreateSidebar'
import { useDealPipelines } from './useDealPipelines'
import { useDealCustomFields } from './useDealCustomFields'
import { EMPTY_VALUES, type BaseValues } from './dealFormTypes'

const CONTEXT_ID = 'customers.deals.create'
const DEAL_ENTITY_ID = 'customers:customer_deal'
const CUSTOM_FIELDS_MANAGE_HREF = `/backend/entities/system/${encodeURIComponent(DEAL_ENTITY_ID)}`

export type CreateDealFormProps = {
  returnTo: string
  /** Seed values merged over EMPTY_VALUES for the initial form state. Entries set to `undefined` are ignored (the EMPTY_VALUES default wins), so a sparse `Partial<BaseValues>` can never unset a required field. Additive: omitting it preserves current behavior. */
  initialValues?: Partial<BaseValues>
}

export function CreateDealForm({ returnTo, initialValues }: CreateDealFormProps) {
  const t = useT()
  const router = useRouter()
  const tr = React.useCallback(
    (key: string, fallback: string, params?: Record<string, string | number>) =>
      translateWithFallback(t, key, fallback, params),
    [t],
  )

  const [values, setValues] = React.useState<BaseValues>(() => {
    const definedSeedEntries = Object.entries(initialValues ?? {}).filter(([, seedValue]) => seedValue !== undefined)
    return { ...EMPTY_VALUES, ...Object.fromEntries(definedSeedEntries) }
  })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const { pipelines, stages, loadStages } = useDealPipelines()
  const {
    customValues,
    customFieldsLoaded,
    customCount,
    handleCustomChange,
    handleCustomAttributesLoaded,
    validateCustomFields,
    collectNormalizedCustomValues,
  } = useDealCustomFields(tr)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: CONTEXT_ID,
    blockedMessage: tr('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const statusLabels = React.useMemo(
    () => createDictionarySelectLabels('deal-statuses', (key, fallback) => tr(key, fallback ?? key)),
    [tr],
  )

  const patch = React.useCallback((partial: Partial<BaseValues>) => {
    setValues((current) => ({ ...current, ...partial }))
  }, [])

  const handlePipelineChange = React.useCallback(
    (id: string) => {
      patch({ pipelineId: id, pipelineStageId: '' })
      // loadStages resets stages to [] on failure; the rejection is intentionally ignored here.
      loadStages(id).catch(() => {})
    },
    [loadStages, patch],
  )

  const handleCancel = React.useCallback(() => {
    router.push(returnTo)
  }, [returnTo, router])

  const handleSubmit = React.useCallback(async () => {
    if (isSubmitting) return
    if (!customFieldsLoaded) {
      flash(tr('customers.deals.create.sections.custom.loading', 'Loading custom fields...'), 'error')
      return
    }
    const merged = { ...values, ...customValues }
    const parsed = dealFormSchema.safeParse(merged)
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = typeof issue.path[0] === 'string' ? issue.path[0] : undefined
        if (key && !fieldErrors[key]) fieldErrors[key] = tr(issue.message, issue.message)
      }
      setErrors(fieldErrors)
      const firstMessage = Object.values(fieldErrors)[0]
      if (firstMessage) flash(firstMessage, 'error')
      return
    }

    const customFieldErrors = validateCustomFields(merged)
    if (Object.keys(customFieldErrors).length) {
      setErrors(customFieldErrors)
      const firstMessage = Object.values(customFieldErrors)[0]
      if (firstMessage) flash(firstMessage, 'error')
      return
    }

    setErrors({})
    setIsSubmitting(true)
    try {
      const data = parsed.data
      const expectedCloseAt =
        data.expectedCloseAt && data.expectedCloseAt.length
          ? new Date(data.expectedCloseAt).toISOString()
          : undefined
      const payload: Record<string, unknown> = {
        title: data.title,
        status: data.status || undefined,
        pipelineId: data.pipelineId || undefined,
        pipelineStageId: data.pipelineStageId || undefined,
        valueAmount: typeof data.valueAmount === 'number' ? data.valueAmount : undefined,
        valueCurrency: data.valueCurrency || undefined,
        probability: typeof data.probability === 'number' ? data.probability : undefined,
        expectedCloseAt,
        description: data.description && data.description.length ? data.description : undefined,
        personIds: values.personIds.length ? values.personIds : undefined,
        companyIds: values.companyIds.length ? values.companyIds : undefined,
      }
      const custom = collectNormalizedCustomValues(merged)
      if (Object.keys(custom).length) payload.customFields = custom

      await runMutation({
        operation: () =>
          createCrud('customers/deals', payload, {
            errorMessage: tr('customers.deals.create.error', 'Failed to create deal.'),
          }),
        context: { formId: CONTEXT_ID, resourceKind: 'customers.deal', retryLastMutation },
        mutationPayload: payload,
      })
      flash(tr('customers.people.detail.deals.success', 'Deal created.'), 'success')
      router.push(returnTo)
    } catch (err) {
      const message = err instanceof Error ? err.message : tr('customers.deals.create.error', 'Failed to create deal.')
      flash(message, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }, [
    collectNormalizedCustomValues,
    customFieldsLoaded,
    customValues,
    isSubmitting,
    retryLastMutation,
    returnTo,
    router,
    runMutation,
    tr,
    validateCustomFields,
    values,
  ])

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLFormElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  const onFormSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      handleSubmit()
    },
    [handleSubmit],
  )

  const cancelLabel = tr('customers.deals.create.cancel', 'Cancel')
  const submitLabel = tr('customers.deals.create.submit', 'Create deal')
  const submitDisabled = !customFieldsLoaded

  return (
    <form className="mx-auto max-w-screen-2xl" onKeyDown={onKeyDown} onSubmit={onFormSubmit} noValidate>
      <FormHeader
        backHref={returnTo}
        backLabel={tr('customers.deals.create.back', 'Back to deals')}
      />

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="space-y-4">
          <DealSectionCard
            icon={Briefcase}
            title={tr('customers.deals.create.title', 'Create deal')}
            subtitle={tr('customers.deals.create.sections.details.subtitle', 'Core opportunity info')}
            actions={
              <>
                <Button type="button" variant="outline" onClick={handleCancel} disabled={isSubmitting}>
                  {cancelLabel}
                </Button>
                <Button type="button" onClick={handleSubmit} disabled={isSubmitting || submitDisabled}>
                  {isSubmitting ? <Spinner className="size-4" /> : <Save className="size-4" />}
                  {submitLabel}
                </Button>
              </>
            }
          >
            <DealDetailsFields
              values={values}
              errors={errors}
              isSubmitting={isSubmitting}
              patch={patch}
              onPipelineChange={handlePipelineChange}
              pipelines={pipelines}
              stages={stages}
              statusLabels={statusLabels}
              tr={tr}
            />
          </DealSectionCard>

          <DealAssociationsSection
            tr={tr}
            personIds={values.personIds}
            companyIds={values.companyIds}
            onPeopleChange={(next) => patch({ personIds: next })}
            onCompaniesChange={(next) => patch({ companyIds: next })}
            disabled={isSubmitting}
          />
        </div>

        <DealCreateSidebar
          tr={tr}
          customValues={customValues}
          onCustomChange={handleCustomChange}
          errors={errors}
          disabled={isSubmitting}
          customCount={customCount}
          manageHref={CUSTOM_FIELDS_MANAGE_HREF}
          onCustomLoaded={handleCustomAttributesLoaded}
        />
      </div>
    </form>
  )
}

export default CreateDealForm
