"use client"

import * as React from 'react'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { VersionHistoryAction } from '@open-mercato/ui/backend/version-history'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  InlineTextEditor,
  InlineDictionaryEditor,
  InlineNextInteractionEditor,
  type InlineFieldProps,
  type NextInteractionPayload,
} from './InlineEditors'

type CompanyHighlightsCompany = {
  id: string
  displayName: string
  primaryEmail?: string | null
  primaryPhone?: string | null
  status?: string | null
  nextInteractionAt?: string | null
  nextInteractionName?: string | null
  nextInteractionRefId?: string | null
  nextInteractionIcon?: string | null
  nextInteractionColor?: string | null
}

type CompanyHighlightsProfile = {
  id?: string
  brandName?: string | null
  legalName?: string | null
  websiteUrl?: string | null
  industry?: string | null
  annualRevenue?: string | null
} | null

type CompanyHighlightsValidators = {
  email: NonNullable<InlineFieldProps['validator']>
  phone: NonNullable<InlineFieldProps['validator']>
  displayName: NonNullable<InlineFieldProps['validator']>
}

export type CompanyHighlightsProps = {
  company: CompanyHighlightsCompany
  profile?: CompanyHighlightsProfile
  validators: CompanyHighlightsValidators
  onDisplayNameSave: (value: string | null) => Promise<void>
  onPrimaryEmailSave: (value: string | null) => Promise<void>
  onPrimaryPhoneSave: (value: string | null) => Promise<void>
  onStatusSave: (value: string | null) => Promise<void>
  onNextInteractionSave: (payload: NextInteractionPayload | null) => Promise<void>
  onDelete: () => void
  isDeleting: boolean
}

export function CompanyHighlights({
  company,
  profile,
  validators,
  onDisplayNameSave,
  onPrimaryEmailSave,
  onPrimaryPhoneSave,
  onStatusSave,
  onNextInteractionSave,
  onDelete,
  isDeleting,
}: CompanyHighlightsProps) {
  const t = useT()
  const historyFallbackId =
    profile?.id && profile.id !== company.id ? profile.id : undefined

  return (
    <div className="space-y-6">
      <FormHeader
        mode="detail"
        backHref="/backend/customers/companies"
        backLabel={t('customers.companies.detail.actions.backToList', 'Back to companies')}
        utilityActions={(
          <VersionHistoryAction
            config={{
              resourceKind: 'customers.company',
              resourceId: company.id,
              resourceIdFallback: historyFallbackId,
            }}
            t={t}
          />
        )}
        title={
          <InlineTextEditor
            label={t('customers.companies.form.displayName.label', 'Display name')}
            value={company.displayName}
            placeholder={t('customers.companies.form.displayName.placeholder', 'Enter company name')}
            emptyLabel={t('customers.companies.detail.noValue', 'Not provided')}
            validator={validators.displayName}
            onSave={onDisplayNameSave}
            hideLabel
            variant="plain"
            activateOnClick
            triggerClassName="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
            containerClassName="max-w-full"
          />
        }
        onDelete={onDelete}
        isDeleting={isDeleting}
        deleteLabel={t('customers.companies.detail.actions.delete', 'Delete company')}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <InlineTextEditor
          label={t('customers.companies.detail.highlights.primaryEmail', 'Primary email')}
          value={company.primaryEmail || ''}
          placeholder={t('customers.companies.form.primaryEmail', 'Add email')}
          emptyLabel={t('customers.companies.detail.noValue', 'Not provided')}
          type="email"
          validator={validators.email}
          recordId={company.id}
          activateOnClick
          onSave={onPrimaryEmailSave}
        />
        <InlineTextEditor
          label={t('customers.companies.detail.highlights.primaryPhone', 'Primary phone')}
          value={company.primaryPhone || ''}
          placeholder={t('customers.companies.form.primaryPhone', 'Add phone')}
          emptyLabel={t('customers.companies.detail.noValue', 'Not provided')}
          type="tel"
          validator={validators.phone}
          recordId={company.id}
          activateOnClick
          onSave={onPrimaryPhoneSave}
        />
        <InlineDictionaryEditor
          label={t('customers.companies.detail.highlights.status', 'Status')}
          value={company.status ?? null}
          emptyLabel={t('customers.companies.detail.noValue', 'Not provided')}
          activateOnClick
          onSave={onStatusSave}
          kind="statuses"
        />
        <InlineNextInteractionEditor
          label={t('customers.companies.detail.highlights.nextInteraction', 'Next interaction')}
          valueAt={company.nextInteractionAt || null}
          valueName={company.nextInteractionName || null}
          valueRefId={company.nextInteractionRefId || null}
          valueIcon={company.nextInteractionIcon || null}
          valueColor={company.nextInteractionColor || null}
          emptyLabel={t('customers.companies.detail.noValue', 'Not provided')}
          onSave={onNextInteractionSave}
          activateOnClick
        />
      </div>
    </div>
  )
}

export default CompanyHighlights
