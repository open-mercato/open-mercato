"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Briefcase, Save } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { E } from '#generated/entities.ids.generated'
import { extensionPoints } from '../../../extension-points'
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

function readCreateValues(values: Record<string, unknown>): BaseValues {
  const result = { ...EMPTY_VALUES }
  for (const key of Object.keys(EMPTY_VALUES) as Array<keyof BaseValues>) {
    if (key === 'personIds' || key === 'companyIds') {
      const raw = values[key]
      result[key] = Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : []
    } else {
      const raw = values[key]
      result[key] = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : ''
    }
  }
  return result
}

export function CreateDealForm({ returnTo, initialValues }: CreateDealFormProps) {
  const t = useT()
  const router = useRouter()
  const tr = React.useCallback(
    (key: string, fallback: string, params?: Record<string, string | number>) =>
      translateWithFallback(t, key, fallback, params),
    [t],
  )
  const seedValues = React.useMemo(() => ({
    ...EMPTY_VALUES,
    ...Object.fromEntries(Object.entries(initialValues ?? {}).filter(([, value]) => value !== undefined)),
  }), [initialValues])
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation({ contextId: CONTEXT_ID, blockedMessage: tr('ui.forms.flash.saveBlocked', 'Save blocked by validation') })
  const { pipelines, stages, loadStages } = useDealPipelines()
  const { customFieldsLoaded, customCount, handleCustomAttributesLoaded, collectNormalizedCustomValues } = useDealCustomFields(tr)
  const statusLabels = React.useMemo(
    () => createDictionarySelectLabels('deal-statuses', (key, fallback) => tr(key, fallback ?? key)),
    [tr],
  )
  const handleCancel = React.useCallback(() => router.push(returnTo), [returnTo, router])
  const handleSubmit = React.useCallback(async (values: Record<string, unknown>) => {
    const data = dealFormSchema.parse(values)
    const payload: Record<string, unknown> = {
      title: data.title,
      status: data.status || undefined,
      pipelineId: data.pipelineId || undefined,
      pipelineStageId: data.pipelineStageId || undefined,
      valueAmount: typeof data.valueAmount === 'number' ? data.valueAmount : undefined,
      valueCurrency: data.valueCurrency || undefined,
      probability: typeof data.probability === 'number' ? data.probability : undefined,
      expectedCloseAt: data.expectedCloseAt ? new Date(data.expectedCloseAt).toISOString() : undefined,
      description: data.description || undefined,
      personIds: data.personIds?.length ? data.personIds : undefined,
      companyIds: data.companyIds?.length ? data.companyIds : undefined,
    }
    const custom = collectNormalizedCustomValues(values)
    if (Object.keys(custom).length) payload.customFields = custom
    setIsSubmitting(true)
    try {
      const { result } = await runMutation({
        operation: () => createCrud<{ id?: string; entityId?: string }>('customers/deals', payload, {
          errorMessage: tr('customers.deals.create.error', 'Failed to create deal.'),
        }),
        context: { formId: CONTEXT_ID, resourceKind: 'customers.deal', retryLastMutation },
        mutationPayload: payload,
      })
      flash(tr('customers.people.detail.deals.success', 'Deal created.'), 'success')
      return { resourceId: result?.id ?? result?.entityId }
    } finally {
      setIsSubmitting(false)
    }
  }, [collectNormalizedCustomValues, tr, runMutation, retryLastMutation])
  const handleSubmitSuccess = React.useCallback(() => {
    router.push(returnTo)
  }, [router, returnTo])
  const fields = React.useMemo<CrudField[]>(() => Object.keys(EMPTY_VALUES).map((id) => ({
    id,
    label: tr(`customers.people.detail.deals.fields.${id}`, id),
    type: 'text',
    required: id === 'title',
  })), [tr])
  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'details',
      bare: true,
      column: 1,
      fields: Object.keys(EMPTY_VALUES).filter((id) => id !== 'personIds' && id !== 'companyIds'),
      component: ({ values, setValue, errors, injectedFields }) => {
        const patch = (partial: Partial<BaseValues>) => {
          for (const [key, value] of Object.entries(partial)) setValue(key, value)
        }
        return (
          <DealSectionCard
            icon={Briefcase}
            title={tr('customers.deals.create.title', 'Create deal')}
            subtitle={tr('customers.deals.create.sections.details.subtitle', 'Core opportunity info')}
            actions={<>
              <Button type="button" variant="outline" onClick={handleCancel} disabled={isSubmitting}>{tr('customers.deals.create.cancel', 'Cancel')}</Button>
              <Button type="submit" form={CONTEXT_ID} disabled={isSubmitting || !customFieldsLoaded}>
                {isSubmitting ? <Spinner className="size-4" /> : <Save className="size-4" />}
                {tr('customers.deals.create.submit', 'Create deal')}
              </Button>
            </>}
          >
            <DealDetailsFields values={readCreateValues(values)} errors={errors} isSubmitting={isSubmitting} patch={patch}
              onPipelineChange={(pipelineId) => { patch({ pipelineId, pipelineStageId: '' }); void loadStages(pipelineId).catch(() => {}) }}
              pipelines={pipelines} stages={stages} statusLabels={statusLabels} tr={tr} />
            {injectedFields}
          </DealSectionCard>
        )
      },
    },
    {
      id: 'associations',
      bare: true,
      column: 1,
      fields: ['personIds', 'companyIds'],
      component: ({ values, setValue, injectedFields }) => <>
        <DealAssociationsSection tr={tr} personIds={readCreateValues(values).personIds} companyIds={readCreateValues(values).companyIds}
          onPeopleChange={(next) => setValue('personIds', next)} onCompaniesChange={(next) => setValue('companyIds', next)} disabled={isSubmitting} />
        {injectedFields}
      </>,
    },
    {
      id: 'custom',
      bare: true,
      column: 2,
      component: ({ values, setValue, errors, injectedFields }) => <>
        <DealCreateSidebar tr={tr} customValues={values} onCustomChange={setValue} errors={errors} disabled={isSubmitting}
          customCount={customCount} manageHref={CUSTOM_FIELDS_MANAGE_HREF} onCustomLoaded={handleCustomAttributesLoaded} />
        {injectedFields}
      </>,
    },
  ], [tr, handleCancel, isSubmitting, customFieldsLoaded, loadStages, pipelines, stages, statusLabels, customCount, handleCustomAttributesLoaded])

  return (
    <div className="mx-auto max-w-screen-2xl" onKeyDown={(event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        document.getElementById(CONTEXT_ID)?.closest('form')?.requestSubmit()
      }
    }}>
      <FormHeader backHref={returnTo} backLabel={tr('customers.deals.create.back', 'Back to deals')} />
      <div className="mt-6">
        <CrudForm<Record<string, unknown>> embedded hideFooterActions formId={CONTEXT_ID}
          entityId="customers.deal" resourceKind="customers.deal" entityIds={[E.customers.customer_deal]}
          injectionSpotId={extensionPoints.hosts.dealForm.spotId} fields={fields} groups={groups}
          initialValues={seedValues} schema={dealFormSchema} onSubmit={handleSubmit} onSubmitSuccess={handleSubmitSuccess} />
      </div>
    </div>
  )
}

export default CreateDealForm
