"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { E } from '#generated/entities.ids.generated'
import { LEASES_HREF, SETTINGS_HREF, formatDate, readErrorCode, readErrorMessage } from './leaseModel'
import {
  CompanyPickerField,
  ContactPickerField,
  MonthlyRateField,
  ProposalExpiryField,
  TermSummaryField,
  UnitPickerField,
  readPositiveInt,
} from './leaseCreateFields'
import { leaseToday, useLeaseSettings } from './useLeaseSettings'
import { useCanOpenLink } from '../featureLinks'
import { useLeaseBuildingOptions } from './useLeaseBuildingOptions'

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

type OverlapConflict = { reference?: string; startsOn?: string; endsOn?: string }

export function LeaseCreateForm() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const { settings, loadError: settingsError, retry: retrySettings } = useLeaseSettings()
  const { buildings, loadError: buildingsError, retry: retryBuildings } = useLeaseBuildingOptions()
  const canOpenSettings = useCanOpenLink('settings')
  const [channelRefused, setChannelRefused] = React.useState(false)
  const channelMissing = channelRefused || settings?.billingChannelConfigured === false

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'buildingId', label: t('property_management.leases.form.building', 'Building'), type: 'select', options: buildings ?? [], layout: 'half' },
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
      type: 'custom',
      required: true,
      component: (props) => <MonthlyRateField {...props} />,
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
    { id: 'customFields', title: t('entities.customFields.title', 'Custom fields'), kind: 'customFields' },
  ], [t])

  const initialValues = React.useMemo<Partial<LeaseFormValues>>(() => ({
    buildingId: null,
    startsOn: leaseToday(settings),
    termMonths: 12,
    unitId: null,
    customerCompanyId: null,
    primaryContactPersonId: null,
    monthlyRate: null,
    asProposal: false,
    expiresInDays: settings?.proposalExpiryDays ?? null,
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
    const customFields = collectCustomFieldValues(values)
    if (Object.keys(customFields).length) payload.customFields = customFields
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
      if (code === 'billing_channel_missing') setChannelRefused(true)
      if (code === 'lease_overlap') {
        const conflicts = (error as { conflicts?: OverlapConflict[] }).conflicts ?? []
        const names = conflicts.map((entry) => t('property_management.leases.create.overlapEntry', '{reference} ({start} — {end})', {
          reference: entry.reference ?? '',
          start: formatDate(entry.startsOn, locale),
          end: formatDate(entry.endsOn, locale),
        })).join(', ')
        const message = readErrorMessage(error, t('property_management.errors.leaseOverlap', 'Another lease or open proposal of this unit overlaps the term.'))
        throw createCrudFormError(
          names ? t('property_management.leases.create.overlapWith', '{message} Overlapping: {leases}.', { message, leases: names }) : message,
          { unitId: message },
        )
      }
      throw error
    }
  }

  const loadError = settingsError ?? buildingsError
  if (loadError) {
    const retry = () => {
      if (settingsError) retrySettings()
      if (buildingsError) retryBuildings()
    }
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={loadError}
            action={<Button type="button" variant="outline" onClick={retry}>{t('property_management.common.retry', 'Try again')}</Button>}
          />
        </PageBody>
      </Page>
    )
  }
  if (settings === null || buildings === null) {
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
          entityId={E.property_management.lease}
          submitLabel={t('property_management.leases.create.submit', 'Save lease')}
          contentHeader={channelMissing ? (
            <Alert status="warning">
              <AlertTitle>{t('property_management.leases.create.channelMissingTitle', 'No sales channel for leases yet')}</AlertTitle>
              <AlertDescription>
                {canOpenSettings ? (
                  <>
                    {t('property_management.leases.create.channelMissing', 'Leases are billed through a sales channel. Choose it in the settings first.')}{' '}
                    <Link href={SETTINGS_HREF} className="font-medium underline">{t('property_management.leases.create.openSettings', 'Open settings')}</Link>
                  </>
                ) : t('property_management.leases.create.channelMissingNoAccess', 'Leases are billed through a sales channel. Ask someone who manages the property settings to choose it.')}
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
