"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudCustomField, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type LeadFormValues = {
  displayName: string
  pipelineId?: string
  stageId?: string
  source?: string
  sourceChannel?: string
  primaryEmail?: string
  primaryPhone?: string
  vatId?: string
  qualificationNotes?: string
  personFirstName?: string
  personLastName?: string
  personJobTitle?: string
  companyName?: string
  companyIndustry?: string
  dealTitle?: string
  dealValueAmount?: string
  dealValueCurrency?: string
}

type Pipeline = { id: string; name: string; isDefault: boolean }
type Stage = { id: string; pipelineId: string; name: string; position: number; kind: string }

function compactRecord(record: Record<string, unknown>): Record<string, unknown> | null {
  const entries = Object.entries(record).filter(([, value]) => {
    if (typeof value === 'string') return value.trim().length > 0
    return value !== undefined && value !== null
  })
  return entries.length ? Object.fromEntries(entries) : null
}

export default function CreateLeadPage() {
  const t = useT()
  const router = useRouter()
  const [pipelines, setPipelines] = React.useState<Pipeline[]>([])
  const [stages, setStages] = React.useState<Stage[]>([])
  const [pipelineId, setPipelineId] = React.useState<string>('')
  const [stageId, setStageId] = React.useState<string>('')
  const [configLoaded, setConfigLoaded] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    Promise.all([
      apiCall<{ items?: Pipeline[] }>('/api/customers/lead-pipelines'),
      apiCall<{ items?: Stage[] }>('/api/customers/lead-pipeline-stages'),
    ])
      .then(([pipelineCall, stageCall]) => {
        if (cancelled) return
        const nextPipelines = Array.isArray(pipelineCall.result?.items) ? pipelineCall.result.items : []
        const nextStages = Array.isArray(stageCall.result?.items) ? stageCall.result.items : []
        setPipelines(nextPipelines)
        setStages(nextStages)
        const defaultPipeline = nextPipelines.find((pipeline) => pipeline.isDefault) ?? nextPipelines[0]
        if (defaultPipeline) {
          setPipelineId(defaultPipeline.id)
          const firstStage = nextStages
            .filter((stage) => stage.pipelineId === defaultPipeline.id && stage.kind === 'open')
            .sort((left, right) => left.position - right.position)[0]
          if (firstStage) setStageId(firstStage.id)
        }
        setConfigLoaded(true)
      })
      .catch(() => {
        if (!cancelled) {
          setConfigLoaded(true)
          flash(t('customers.leads.configError', 'Failed to load lead configuration.'), 'error')
        }
      })
    return () => {
      cancelled = true
    }
  }, [t])

  const fields = React.useMemo<CrudField[]>(() => {
    const pipelineField: CrudCustomField = {
      id: 'pipelineId',
      label: t('customers.leads.form.pipeline', 'Pipeline'),
      type: 'custom',
      component: ({ value, setValue, setFormValue }) => (
        <Select
          value={typeof value === 'string' ? value : pipelineId}
          onValueChange={(next) => {
            setValue(next)
            setPipelineId(next)
            const firstStage = stages
              .filter((stage) => stage.pipelineId === next && stage.kind === 'open')
              .sort((left, right) => left.position - right.position)[0]
            setStageId(firstStage?.id ?? '')
            setFormValue?.('stageId', firstStage?.id ?? '')
          }}
        >
          <SelectTrigger aria-label={t('customers.leads.form.pipeline', 'Pipeline')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pipelines.map((pipeline) => (
              <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    }
    const stageField: CrudCustomField = {
      id: 'stageId',
      label: t('customers.leads.form.stage', 'Stage'),
      type: 'custom',
      component: ({ value, setValue, values }) => {
        const selectedPipelineId = typeof values?.pipelineId === 'string' ? values.pipelineId : pipelineId
        const options = stages
          .filter((stage) => stage.pipelineId === selectedPipelineId && stage.kind === 'open')
          .sort((left, right) => left.position - right.position)
        return (
          <Select
            value={typeof value === 'string' ? value : stageId}
            onValueChange={(next) => setValue(next)}
          >
            <SelectTrigger aria-label={t('customers.leads.form.stage', 'Stage')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((stage) => (
                <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      },
    }
    return [
      {
        id: 'displayName',
        label: t('customers.leads.form.displayName', 'Display name'),
        type: 'text',
        required: true,
      },
      pipelineField,
      stageField,
      {
        id: 'source',
        label: t('customers.leads.form.source', 'Source'),
        type: 'text',
      },
    {
      id: 'sourceChannel',
      label: t('customers.leads.form.sourceChannel', 'Source channel'),
      type: 'text',
    },
    {
      id: 'primaryEmail',
      label: t('customers.leads.form.primaryEmail', 'Email'),
      type: 'text',
    },
    {
      id: 'primaryPhone',
      label: t('customers.leads.form.primaryPhone', 'Phone'),
      type: 'text',
    },
    {
      id: 'vatId',
      label: t('customers.leads.form.vatId', 'VAT ID'),
      type: 'text',
    },
    {
      id: 'qualificationNotes',
      label: t('customers.leads.form.qualificationNotes', 'Qualification notes'),
      type: 'textarea',
    },
    {
      id: 'personFirstName',
      label: t('customers.leads.form.personFirstName', 'Contact first name'),
      type: 'text',
    },
    {
      id: 'personLastName',
      label: t('customers.leads.form.personLastName', 'Contact last name'),
      type: 'text',
    },
    {
      id: 'personJobTitle',
      label: t('customers.leads.form.personJobTitle', 'Contact job title'),
      type: 'text',
    },
    {
      id: 'companyName',
      label: t('customers.leads.form.companyName', 'Company name'),
      type: 'text',
    },
    {
      id: 'companyIndustry',
      label: t('customers.leads.form.companyIndustry', 'Company industry'),
      type: 'text',
    },
    {
      id: 'dealTitle',
      label: t('customers.leads.form.dealTitle', 'Potential deal title'),
      type: 'text',
    },
    {
      id: 'dealValueAmount',
      label: t('customers.leads.form.dealValueAmount', 'Potential deal value'),
      type: 'text',
    },
    {
      id: 'dealValueCurrency',
      label: t('customers.leads.form.dealValueCurrency', 'Deal currency'),
      type: 'text',
      defaultValue: 'SAR',
    },
    ]
  }, [pipelines, stages, pipelineId, stageId, t])

  if (!configLoaded) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('customers.leads.loading', 'Loading leads…')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<LeadFormValues>
          title={t('customers.leads.create.title', 'New lead')}
          titleHeadingLevel={1}
          backHref="/backend/customers/leads"
          fields={fields}
          initialValues={{
            displayName: '',
            pipelineId: pipelineId || undefined,
            stageId: stageId || undefined,
          }}
          submitLabel={t('customers.leads.form.submit', 'Create lead')}
          cancelHref="/backend/customers/leads"
          onSubmit={async (values) => {
            const personData = compactRecord({
              firstName: values.personFirstName,
              lastName: values.personLastName,
              jobTitle: values.personJobTitle,
            })
            const companyData = compactRecord({
              displayName: values.companyName,
              industry: values.companyIndustry,
            })
            const dealData = compactRecord({
              title: values.dealTitle,
              valueAmount: values.dealValueAmount,
              valueCurrency: values.dealValueCurrency,
            })
            const { result } = await createCrud<{ id?: string }>('customers/leads', {
              displayName: values.displayName,
              pipelineId: values.pipelineId ?? (pipelineId || undefined),
              stageId: values.stageId ?? (stageId || undefined),
              source: values.source,
              sourceChannel: values.sourceChannel,
              primaryEmail: values.primaryEmail,
              primaryPhone: values.primaryPhone,
              vatId: values.vatId,
              qualificationNotes: values.qualificationNotes,
              personData,
              companyData,
              dealData,
            })
            flash(t('customers.leads.create.success', 'Lead created.'), 'success')
            const leadId = typeof result?.id === 'string' ? result.id : null
            router.push(leadId ? `/backend/customers/leads/${leadId}` : '/backend/customers/leads')
          }}
        />
      </PageBody>
    </Page>
  )
}
