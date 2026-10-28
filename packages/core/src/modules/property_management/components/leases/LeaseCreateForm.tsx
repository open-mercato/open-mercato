"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LEASES_HREF, SETTINGS_HREF, readErrorCode, readErrorMessage } from './leaseModel'
import {
  CompanyPickerField,
  ContactPickerField,
  ProposalExpiryField,
  TermSummaryField,
  UnitPickerField,
  readPositiveInt,
} from './leaseCreateFields'

type LeaseFormValues = {
  buildingId: string | null
  startsOn: string
  termMonths: number
  unitId: string | null
  customerCompanyId: string | null
  primaryContactPersonId: string | null
  monthlyRate: number | null
  asProposal: boolean
  expiresInDays: number | null
  message: string
} & Record<string, unknown>

type SettingsPayload = { billingChannelId?: string | null; proposalExpiryDays?: number }
type OverlapConflict = { reference?: string; startsOn?: string; endsOn?: string }

function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function LeaseCreateForm() {
  const t = useT()
  const router = useRouter()
  const [settings, setSettings] = React.useState<SettingsPayload | null>(null)
  const [buildings, setBuildings] = React.useState<Array<{ value: string; label: string }>>([])
  const [channelMissing, setChannelMissing] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    void Promise.all([
      apiCall<SettingsPayload>('/api/property_management/settings', undefined, { fallback: {} }),
      apiCall<{ items?: Array<{ id: string; name: string }> }>('/api/property_management/buildings?pageSize=100&sortField=name&sortDir=asc', undefined, { fallback: {} }),
    ]).then(([settingsCall, buildingsCall]) => {
      if (cancelled) return
      const loaded = settingsCall.ok && settingsCall.result ? settingsCall.result : {}
      setSettings(loaded)
      setChannelMissing(settingsCall.ok && !loaded.billingChannelId)
      const items = buildingsCall.ok && Array.isArray(buildingsCall.result?.items) ? buildingsCall.result.items : []
      setBuildings(items.map((item) => ({ value: item.id, label: item.name })))
    })
    return () => {
      cancelled = true
    }
  }, [])

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'buildingId', label: t('property_management.leases.form.building', 'Building'), type: 'select', options: buildings, layout: 'half' },
    { id: 'startsOn', label: t('property_management.leases.form.startsOn', 'Lease start'), type: 'date', required: true, layout: 'half' },
    { id: 'termMonths', label: t('property_management.leases.form.termMonths', 'Term, months'), type: 'number', required: true, layout: 'half' },
    { id: 'termSummary', label: t('property_management.leases.form.ends', 'Lease end'), type: 'custom', layout: 'half', component: (props) => <TermSummaryField {...props} /> },
    {
      id: 'unitId',
      label: t('property_management.leases.form.unit', 'Unit'),
      type: 'custom',
      required: true,
      description: t('property_management.leases.form.unitHint', 'Only leasable units free for the whole term are listed — not leased and not held by another open proposal.'),
      component: (props) => <UnitPickerField {...props} />,
    },
    {
      id: 'customerCompanyId',
      label: t('property_management.leases.form.tenant', 'Tenant'),
      type: 'custom',
      required: true,
      description: t('property_management.leases.form.tenantHint', 'Picked from CRM companies — a lease is always held by a company record.'),
      component: (props) => <CompanyPickerField {...props} />,
    },
    { id: 'primaryContactPersonId', label: t('property_management.leases.form.contact', 'Primary contact'), type: 'custom', component: (props) => <ContactPickerField {...props} /> },
    {
      id: 'monthlyRate',
      label: t('property_management.leases.form.monthlyRate', 'Monthly rate'),
      type: 'number',
      required: true,
      description: t('property_management.leases.form.monthlyRateHint', 'In the currency of the unit’s product price.'),
    },
    {
      id: 'asProposal',
      label: t('property_management.leases.form.asProposal', 'Send as a proposal'),
      type: 'checkbox',
      description: t('property_management.leases.form.asProposalHint', 'Creates a sales quote the customer approves or declines in their portal. The unit is reserved until they answer or the proposal expires.'),
    },
    {
      id: 'expiresInDays',
      label: t('property_management.leases.form.expiresInDays', 'Proposal expires after (days)'),
      type: 'custom',
      visibleWhen: { field: 'asProposal', equals: true },
      component: (props) => <ProposalExpiryField {...props} />,
    },
    {
      id: 'message',
      label: t('property_management.leases.form.message', 'Message to the customer (optional)'),
      type: 'textarea',
      maxLength: 4000,
      visibleWhen: { field: 'asProposal', equals: true },
    },
  ], [buildings, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'term', title: t('property_management.leases.form.groupTerm', 'Unit and term'), fields: ['buildingId', 'startsOn', 'termMonths', 'termSummary', 'unitId'] },
    { id: 'tenant', title: t('property_management.leases.form.groupTenant', 'Tenant and rate'), fields: ['customerCompanyId', 'primaryContactPersonId', 'monthlyRate'] },
    { id: 'proposal', title: t('property_management.leases.form.groupProposal', 'Proposal'), fields: ['asProposal', 'expiresInDays', 'message'] },
  ], [t])

  const initialValues = React.useMemo<Partial<LeaseFormValues>>(() => ({
    buildingId: null,
    startsOn: todayIso(),
    termMonths: 12,
    unitId: null,
    customerCompanyId: null,
    primaryContactPersonId: null,
    monthlyRate: null,
    asProposal: false,
    expiresInDays: settings?.proposalExpiryDays ?? 14,
    message: '',
  }), [settings])

  const submit = async (values: LeaseFormValues) => {
    const fieldErrors: Record<string, string> = {}
    if (!values.unitId) fieldErrors.unitId = t('property_management.leases.form.unitRequired', 'Choose a unit.')
    if (!values.customerCompanyId) fieldErrors.customerCompanyId = t('property_management.leases.form.tenantRequired', 'Choose the tenant company.')
    if (Object.keys(fieldErrors).length) {
      throw createCrudFormError(t('property_management.leases.form.invalid', 'Fix the highlighted fields.'), fieldErrors)
    }
    const asProposal = values.asProposal === true
    const payload: Record<string, unknown> = {
      unitId: values.unitId,
      customerCompanyId: values.customerCompanyId,
      primaryContactPersonId: values.primaryContactPersonId ?? null,
      startsOn: values.startsOn,
      termMonths: readPositiveInt(values.termMonths),
      monthlyRate: Number(values.monthlyRate),
      asProposal,
    }
    if (asProposal) {
      payload.expiresInDays = readPositiveInt(values.expiresInDays) ?? undefined
      if (values.message?.trim()) payload.message = values.message.trim()
    }
    try {
      const call = await createCrud<{ id?: string }>('property_management/leases', payload, {
        errorMessage: t('property_management.leases.create.error', 'Could not create the lease.'),
      })
      flash(
        asProposal
          ? t('property_management.leases.create.proposalSent', 'Proposal recorded. The quote is being created and sent.')
          : t('property_management.leases.create.success', 'Lease created. It turns active once its recurring sales order exists.'),
        'success',
      )
      router.push(call.result?.id ? `${LEASES_HREF}/${call.result.id}` : LEASES_HREF)
    } catch (error) {
      const code = readErrorCode(error)
      if (code === 'billing_channel_missing') setChannelMissing(true)
      if (code === 'lease_overlap') {
        const conflicts = (error as { conflicts?: OverlapConflict[] }).conflicts ?? []
        const names = conflicts.map((entry) => `${entry.reference ?? ''} (${entry.startsOn ?? ''} — ${entry.endsOn ?? ''})`).join(', ')
        throw createCrudFormError(`${readErrorMessage(error, '')} ${names}`.trim(), { unitId: readErrorMessage(error, '') })
      }
      throw error
    }
  }

  if (settings === null) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('property_management.common.loading', 'Loading…')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<LeaseFormValues>
          title={t('property_management.leases.create.title', 'New lease')}
          titleHeadingLevel={1}
          backHref={LEASES_HREF}
          cancelHref={LEASES_HREF}
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          submitLabel={t('property_management.leases.create.submit', 'Save lease')}
          contentHeader={channelMissing ? (
            <Alert status="warning">
              <AlertTitle>{t('property_management.leases.create.channelMissingTitle', 'No sales channel for leases yet')}</AlertTitle>
              <AlertDescription>
                {t('property_management.leases.create.channelMissing', 'Leases are billed through a sales channel. Choose it in the settings first.')}{' '}
                <Link href={SETTINGS_HREF} className="font-medium underline">{t('property_management.leases.create.openSettings', 'Open settings')}</Link>
              </AlertDescription>
            </Alert>
          ) : undefined}
          onSubmit={submit}
        />
      </PageBody>
    </Page>
  )
}

export default LeaseCreateForm
