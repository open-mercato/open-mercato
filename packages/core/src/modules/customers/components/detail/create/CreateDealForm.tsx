"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Save } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useCurrentUserId } from '@open-mercato/ui/backend/utils/useCurrentUserId'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Label } from '@open-mercato/ui/primitives/label'
import { E } from '#generated/entities.ids.generated'
import { extensionPoints } from '../../../extension-points'
import { dealFormSchema } from '../DealForm'
import { DictionarySelectField } from '../../formConfig'
import { createDictionarySelectLabels } from '../utils'
import { DealDetailsFields } from './DealDetailsFields'
import { selectableDealStages } from './DealStagePath'
import { DealAssociationsSection } from './DealAssociationsSection'
import { DealMoreDetails } from './DealMoreDetails'
import { DealFormField } from './DealFormField'
import { DealSectionCard } from './DealSectionCard'
import { DealCustomAttributes, type DealCustomAttributesLoadState } from './DealCustomAttributes'
import { SuffixInput } from './SuffixInput'
import { sanitizeProbability } from './dealNumericInput'
import { useDealPipelines, type PipelineOption, type PipelineStageOption } from './useDealPipelines'
import { useDealCustomFields } from './useDealCustomFields'
import { EMPTY_VALUES, type BaseValues } from './dealFormTypes'

const CONTEXT_ID = 'customers.deals.create'
const DEAL_ENTITY_ID = 'customers:customer_deal'
const CUSTOM_FIELDS_MANAGE_HREF = `/backend/entities/system/${encodeURIComponent(DEAL_ENTITY_ID)}`
const ASSOCIATION_FIELDS: ReadonlyArray<keyof BaseValues> = ['personIds', 'companyIds']
const NO_STAGES: PipelineStageOption[] = []
// Fields that live under "More details"; an error on one of them (or on a custom field)
// opens the disclosure so the message is never hidden behind a collapsed section.
const MORE_DETAILS_FIELDS: ReadonlyArray<keyof BaseValues> = ['status', 'probability', 'description']
const DETAILS_FIELDS = (Object.keys(EMPTY_VALUES) as Array<keyof BaseValues>).filter(
  (id) => !ASSOCIATION_FIELDS.includes(id) && !MORE_DETAILS_FIELDS.includes(id),
)

// Extensions written for the earlier form target the `custom` group, now the More details section.
const INJECTION_GROUP_ALIASES: Readonly<Record<string, string>> = { custom: 'more' }

function isMoreDetailsField(key: string): boolean {
  return MORE_DETAILS_FIELDS.includes(key as keyof BaseValues) || key.startsWith('cf_')
}

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

type PipelineDefaultsProps = {
  pipelineId: string
  pipelineStageId: string
  pipelines: PipelineOption[]
  stages: PipelineStageOption[]
  stagesPipelineId: string | null
  loadStages: (pipelineId: string) => Promise<void> | void
  setValue: (id: string, value: unknown) => void
}

/**
 * A new deal starts on the default pipeline and its first stage, so the stage picker is
 * there from the first paint instead of an empty select the user has to discover (#5109).
 * A pipeline the caller seeded through initialValues wins. Stages follow the form value,
 * not the select, because an injected field widget can change the pipeline through
 * `sideEffects`. The previous pipeline's stage is cleared as soon as the pipeline changes,
 * unless the same change also set a stage, and once the new stages load a stage that is not
 * on them is replaced by the first one the picker offers.
 */
function PipelineDefaults({ pipelineId, pipelineStageId, pipelines, stages, stagesPipelineId, loadStages, setValue }: PipelineDefaultsProps) {
  const pipelineDefaulted = React.useRef(false)
  const previousSelection = React.useRef({ pipelineId, pipelineStageId })
  React.useEffect(() => {
    if (pipelineDefaulted.current || !pipelines.length) return
    pipelineDefaulted.current = true
    if (pipelineId) return
    const preferred = pipelines.find((entry) => entry.isDefault) ?? pipelines[0]
    if (!preferred) return
    setValue('pipelineId', preferred.id)
    setValue('pipelineStageId', '')
  }, [pipelineId, pipelines, setValue])
  React.useEffect(() => {
    const previous = previousSelection.current
    previousSelection.current = { pipelineId, pipelineStageId }
    if (!previous.pipelineId || previous.pipelineId === pipelineId) return
    if (pipelineStageId && pipelineStageId === previous.pipelineStageId) setValue('pipelineStageId', '')
  }, [pipelineId, pipelineStageId, setValue])
  React.useEffect(() => {
    // loadStages resets stages to [] on failure; the rejection is intentionally ignored here.
    Promise.resolve(loadStages(pipelineId)).catch(() => {})
  }, [loadStages, pipelineId])
  React.useEffect(() => {
    if (!pipelineId || stagesPipelineId !== pipelineId) return
    if (stages.some((stage) => stage.id === pipelineStageId)) return
    const nextStageId = selectableDealStages(stages)[0]?.id ?? ''
    if (nextStageId !== pipelineStageId) setValue('pipelineStageId', nextStageId)
  }, [pipelineId, pipelineStageId, setValue, stages, stagesPipelineId])
  return null
}

/**
 * Fields contributed by extensions (`crud-form:customers.deal:fields`) get a card of their
 * own after the section they target; CrudForm always hands over a grid wrapper, so the card
 * hides itself while that wrapper is empty.
 */
function InjectedFieldsCard({ children }: { children?: React.ReactNode }) {
  if (!children) return null
  return <DealSectionCard className="has-[>div:empty]:hidden">{children}</DealSectionCard>
}

function RevealOnErrors({ errors, onReveal }: { errors: Record<string, string>; onReveal: () => void }) {
  const hasHiddenError = Object.keys(errors).some(isMoreDetailsField)
  React.useEffect(() => {
    if (hasHiddenError) onReveal()
  }, [hasHiddenError, onReveal])
  return null
}

export function CreateDealForm({ returnTo, initialValues }: CreateDealFormProps) {
  const t = useT()
  const router = useRouter()
  const tr = React.useCallback(
    (key: string, fallback: string, params?: Record<string, string | number>) =>
      translateWithFallback(t, key, fallback, params),
    [t],
  )
  // Default the owner to the current user, matching the pipeline quick-create dialog so a
  // deal created here does not start unowned (an unowned deal notifies nobody when it closes).
  // useCurrentUserId resolves asynchronously; CrudForm merges the late seed without touching
  // an explicit seed or a field the user has already edited.
  const currentUserId = useCurrentUserId()
  // Seeds the picker for the self-assigned id, which may not be on the assignable roster
  // (an admin who is not a staff team member, or any user when the `staff` module is off).
  const ownerInitialOption = React.useMemo(
    () => (currentUserId
      ? { id: currentUserId, name: tr('customers.filters.currentUser', 'Current user') }
      : null),
    [currentUserId, tr],
  )
  const seedValues = React.useMemo(() => {
    const seeded: BaseValues = {
      ...EMPTY_VALUES,
      ...Object.fromEntries(Object.entries(initialValues ?? {}).filter(([, value]) => value !== undefined)),
    }
    return seeded.ownerUserId || !currentUserId ? seeded : { ...seeded, ownerUserId: currentUserId }
  }, [initialValues, currentUserId])
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  // Optional fields start collapsed like the quick-create forms in other CRMs; a seeded value
  // keeps them visible so the caller's prefill is never hidden.
  const [moreExpanded, setMoreExpanded] = React.useState(() =>
    Object.entries(initialValues ?? {}).some(([key, seedValue]) => isMoreDetailsField(key) && Boolean(seedValue)),
  )
  const revealMoreDetails = React.useCallback(() => setMoreExpanded(true), [])
  const { runMutation, retryLastMutation } = useGuardedMutation({ contextId: CONTEXT_ID, blockedMessage: tr('ui.forms.flash.saveBlocked', 'Save blocked by validation') })
  const { pipelines, stages, stagesPipelineId, stagesLoading, stagesFailed, retryStages, loadStages } = useDealPipelines()
  const { customFieldsLoaded, handleCustomAttributesLoaded, collectNormalizedCustomValues } = useDealCustomFields(tr)
  // A required custom field must be visible from the start, not discovered on submit.
  const onCustomAttributesLoaded = React.useCallback(
    (state: DealCustomAttributesLoadState) => {
      handleCustomAttributesLoaded(state)
      if (state.fields.some((field) => field.required)) setMoreExpanded(true)
    },
    [handleCustomAttributesLoaded],
  )
  const statusLabels = React.useMemo(
    () => createDictionarySelectLabels('deal-statuses', (key, fallback) => tr(key, fallback ?? key)),
    [tr],
  )
  const pipelineName = React.useCallback(
    (pipelineId: string) => pipelines.find((entry) => entry.id === pipelineId)?.name ?? null,
    [pipelines],
  )
  const handleSubmit = React.useCallback(async (values: Record<string, unknown>) => {
    if (stagesFailed) {
      throw createCrudFormError(tr('customers.deals.create.stagesLoadFailed', 'Could not load the stages of this pipeline.'))
    }
    if (stagesLoading) {
      throw createCrudFormError(tr('customers.deals.create.stagesLoading', 'Stages are still loading. Try again in a moment.'))
    }
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
      // `null`, not omitted — matching DealForm, so both create surfaces send the same
      // shape. `dealCreateSchema.ownerUserId` is `.optional().nullable()` and
      // createDealCommand maps null to null.
      ownerUserId: data.ownerUserId && data.ownerUserId.length ? data.ownerUserId : null,
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
  }, [collectNormalizedCustomValues, stagesFailed, stagesLoading, tr, runMutation, retryLastMutation])
  const handleSubmitSuccess = React.useCallback(() => {
    router.push(returnTo)
  }, [router, returnTo])
  const fields = React.useMemo<CrudField[]>(() => Object.keys(EMPTY_VALUES).map((id) => ({
    id,
    label: tr(`customers.people.detail.deals.fields.${id}`, id),
    type: 'text',
    required: id === 'title',
  })), [tr])
  // Section cards like CrudForm's groups on the other CRM create pages, read top to bottom:
  // what the deal is, where it sits in the pipeline, the numbers, who it is with, then
  // everything optional behind one disclosure (#5109).
  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'details',
      bare: true,
      column: 1,
      fields: [...DETAILS_FIELDS],
      component: ({ values, setValue, errors, injectedFields }) => {
        const current = readCreateValues(values)
        const patch = (partial: Partial<BaseValues>) => {
          for (const [key, value] of Object.entries(partial)) setValue(key, value)
        }
        const currentStages = stagesPipelineId === current.pipelineId ? stages : NO_STAGES
        return (
          <>
            <PipelineDefaults
              pipelineId={current.pipelineId}
              pipelineStageId={current.pipelineStageId}
              pipelines={pipelines}
              stages={currentStages}
              stagesPipelineId={stagesPipelineId}
              loadStages={loadStages}
              setValue={setValue}
            />
            <DealDetailsFields
              values={current}
              errors={errors}
              isSubmitting={isSubmitting}
              patch={patch}
              onPipelineChange={(pipelineId) => patch({ pipelineId, pipelineStageId: '' })}
              pipelines={pipelines}
              stages={currentStages}
              stagesFailed={stagesFailed}
              onRetryStages={retryStages}
              pipelineName={pipelineName(current.pipelineId)}
              ownerInitialOption={ownerInitialOption}
              tr={tr}
            />
            <InjectedFieldsCard>{injectedFields}</InjectedFieldsCard>
          </>
        )
      },
    },
    {
      id: 'associations',
      bare: true,
      column: 1,
      fields: [...ASSOCIATION_FIELDS],
      component: ({ values, setValue, injectedFields }) => {
        const current = readCreateValues(values)
        return (
          <>
            <DealAssociationsSection
              tr={tr}
              personIds={current.personIds}
              companyIds={current.companyIds}
              onPeopleChange={(next) => setValue('personIds', next)}
              onCompaniesChange={(next) => setValue('companyIds', next)}
              disabled={isSubmitting}
            />
            <InjectedFieldsCard>{injectedFields}</InjectedFieldsCard>
          </>
        )
      },
    },
    {
      id: 'more',
      bare: true,
      column: 1,
      fields: [...MORE_DETAILS_FIELDS],
      component: ({ values, setValue, errors, injectedFields }) => {
        const current = readCreateValues(values)
        return (
          <>
          <DealMoreDetails
            title={tr('customers.deals.create.sections.more.title', 'More details')}
            expanded={moreExpanded}
            onExpandedChange={setMoreExpanded}
          >
            <RevealOnErrors errors={errors} onReveal={revealMoreDetails} />
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <DealFormField fieldId="status" label={tr('customers.people.detail.deals.fields.status', 'Status')}>
                <DictionarySelectField
                  kind="deal-statuses"
                  value={current.status || undefined}
                  onChange={(next) => setValue('status', next ?? '')}
                  labels={statusLabels}
                  selectClassName="w-full"
                  showActiveAppearance={false}
                />
              </DealFormField>
              <DealFormField
                fieldId="probability"
                label={tr('customers.deals.create.fields.probability', 'Probability')}
                error={errors.probability}
              >
                <SuffixInput
                  suffix="%"
                  inputMode="numeric"
                  value={current.probability}
                  onChange={(event) => setValue('probability', sanitizeProbability(event.target.value))}
                  placeholder="0"
                  aria-invalid={errors.probability ? true : undefined}
                  disabled={isSubmitting}
                />
              </DealFormField>
            </div>
            <DealFormField fieldId="description" label={tr('customers.people.detail.deals.fields.description', 'Description')}>
              <Textarea
                value={current.description}
                onChange={(event) => setValue('description', event.target.value)}
                disabled={isSubmitting}
                rows={3}
              />
            </DealFormField>
            <div className="space-y-4 border-t border-border pt-5">
              <Label>{tr('customers.deals.create.sections.custom.title', 'Custom attributes')}</Label>
              <DealCustomAttributes
                values={values}
                onChange={setValue}
                errors={errors}
                disabled={isSubmitting}
                manageHref={CUSTOM_FIELDS_MANAGE_HREF}
                labels={{
                  manage: tr('customers.deals.create.sections.custom.manage', 'Manage fields'),
                  empty: tr('customers.deals.create.sections.custom.empty', 'No custom fields defined for deals yet.'),
                  loading: tr('customers.deals.create.sections.custom.loading', 'Loading custom fields…'),
                }}
                onLoaded={onCustomAttributesLoaded}
              />
            </div>
          </DealMoreDetails>
          <InjectedFieldsCard>{injectedFields}</InjectedFieldsCard>
          </>
        )
      },
    },
  ], [
    stagesFailed,
    retryStages,
    isSubmitting,
    loadStages,
    moreExpanded,
    onCustomAttributesLoaded,
    ownerInitialOption,
    pipelineName,
    pipelines,
    revealMoreDetails,
    stages,
    stagesPipelineId,
    statusLabels,
    tr,
  ])

  const cancelLabel = tr('customers.deals.create.cancel', 'Cancel')
  const submitLabel = tr('customers.deals.create.submit', 'Create deal')

  return (
    <div className="mx-auto max-w-screen-2xl" onKeyDown={(event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (!isSubmitting && customFieldsLoaded) document.getElementById(CONTEXT_ID)?.closest('form')?.requestSubmit()
      }
    }}>
      {/* One action surface per page: the bar pins under the app topbar (`--topbar-height`
          is what AppShell publishes, `z-sticky` what its topbar uses), so Cancel and
          Create deal never scroll away and nothing repeats at the bottom
          (.ai/specs/2026-08-01-pinned-form-action-bar.md). */}
      <div className="sticky top-[var(--topbar-height,0px)] z-sticky -mx-4 -mt-4 border-b border-border bg-background px-4 py-3 lg:-mx-6 lg:-mt-6 lg:px-6">
        {/* The app breadcrumb already ends in "Create deal", so the bar repeats no title; the
            page still owns an h1 for assistive tech and the readiness checks. */}
        <h1 className="sr-only">{tr('customers.deals.create.title', 'Create deal')}</h1>
        <FormHeader
          mode="edit"
          backHref={returnTo}
          backLabel={tr('customers.deals.create.back', 'Back to deals')}
          actions={{
            cancelHref: returnTo,
            cancelLabel,
            submit: { formId: CONTEXT_ID, pending: isSubmitting, label: submitLabel, icon: Save, disabled: !customFieldsLoaded || stagesLoading || stagesFailed },
          }}
        />
      </div>
      <div className="mt-6 max-w-5xl">
        <CrudForm<Record<string, unknown>> embedded hideFooterActions formId={CONTEXT_ID}
          entityId="customers.deal" resourceKind="customers.deal" entityIds={[E.customers.customer_deal]}
          injectionSpotId={extensionPoints.hosts.dealForm.spotId} fields={fields} groups={groups}
          injectionGroupAliases={INJECTION_GROUP_ALIASES} initialValues={seedValues} schema={dealFormSchema}
          onSubmit={handleSubmit} onSubmitSuccess={handleSubmitSuccess} />
      </div>
    </div>
  )
}

export default CreateDealForm
