"use client"

import * as React from 'react'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { VersionHistoryAction } from '@open-mercato/ui/backend/version-history'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useQuery } from '@tanstack/react-query'
import { fetchCustomFieldFormFieldsWithDefinitions } from '@open-mercato/ui/backend/utils/customFieldForms'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import {
  InlineTextEditor,
  InlineDictionaryEditor,
  InlineNextInteractionEditor,
  type InlineFieldProps,
  type NextInteractionPayload,
} from './InlineEditors'
import { useCustomerDictionary } from './hooks/useCustomerDictionary'
import { DETAIL_HEADER_FIELDSET } from '../../lib/detailHelpers'

type CompanyHighlightsCompany = {
  id: string
  displayName: string
  primaryEmail?: string | null
  primaryPhone?: string | null
  status?: string | null
  lifecycleStage?: string | null
  source?: string | null
  nextInteractionAt?: string | null
  nextInteractionName?: string | null
  nextInteractionRefId?: string | null
  nextInteractionIcon?: string | null
  nextInteractionColor?: string | null
  organizationId?: string | null
}

type CompanyHighlightsProfile = {
  id?: string
  brandName?: string | null
  legalName?: string | null
  websiteUrl?: string | null
  industry?: string | null
  sizeBucket?: string | null
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
  customFields?: Record<string, unknown>
  customFieldEntityIds?: string[]
  headerFieldset?: string
  validators: CompanyHighlightsValidators
  onDisplayNameSave: (value: string | null) => Promise<void>
  onPrimaryEmailSave: (value: string | null) => Promise<void>
  onPrimaryPhoneSave: (value: string | null) => Promise<void>
  onStatusSave: (value: string | null) => Promise<void>
  onNextInteractionSave: (payload: NextInteractionPayload | null) => Promise<void>
  onDelete: () => void
  isDeleting: boolean
  utilityActions?: React.ReactNode
}

export function CompanyHighlights({
  company,
  profile,
  customFields,
  customFieldEntityIds,
  headerFieldset = DETAIL_HEADER_FIELDSET,
  validators,
  onDisplayNameSave,
  onPrimaryEmailSave,
  onPrimaryPhoneSave,
  onStatusSave,
  onNextInteractionSave,
  onDelete,
  isDeleting,
  utilityActions,
}: CompanyHighlightsProps) {
  const t = useT()
  const historyFallbackId =
    profile?.id && profile.id !== company.id ? profile.id : undefined

  const sourcesQuery = useCustomerDictionary('sources')
  const lifecycleQuery = useCustomerDictionary('lifecycle-stages')
  const statusesQuery = useCustomerDictionary('statuses')

  const scopeVersion = useOrganizationScopeVersion()
  const resolvedScopeVersion = typeof scopeVersion === 'number' ? scopeVersion : Number(scopeVersion) || 0
  const customFieldDefsQuery = useQuery({
    queryKey: ['customFieldForms', resolvedScopeVersion, ...(customFieldEntityIds ?? [])],
    enabled: (customFieldEntityIds?.length ?? 0) > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchCustomFieldFormFieldsWithDefinitions(customFieldEntityIds!),
  })

  const resolveLabel = (map: Record<string, { label: string }> | undefined, value: string | null | undefined): string | null => {
    if (!value) return null
    return map?.[value]?.label ?? value
  }

  const sourceLabel = resolveLabel(sourcesQuery.data?.map, company.source)
  const lifecycleLabel = resolveLabel(lifecycleQuery.data?.map, company.lifecycleStage)
  const statusLabel = resolveLabel(statusesQuery.data?.map, company.status)

  const initials = React.useMemo(() => {
    const words = company.displayName.trim().split(/\s+/).filter(Boolean)
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
    return company.displayName.slice(0, 2).toUpperCase()
  }, [company.displayName])

  const subtitleParts = [profile?.industry, sourceLabel].filter(Boolean)

  // Filter custom field definitions to only those in the header fieldset
  const headerFields = React.useMemo(() => {
    const definitions = customFieldDefsQuery.data?.definitions
    if (!definitions?.length || !customFields) return []
    return definitions
      .filter((def) => {
        if (def.fieldset !== headerFieldset) return false
        const value = customFields[`cf_${def.key}`]
        return value != null && value !== ''
      })
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
  }, [customFieldDefsQuery.data?.definitions, customFields, headerFieldset])

  return (
    <div className="space-y-6">
      <FormHeader
        mode="detail"
        backHref="/backend/customers/companies"
        backLabel={t('customers.companies.detail.actions.backToList', 'Back to companies')}
        title={
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
              {initials}
            </div>
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
          </div>
        }
        subtitle={subtitleParts.length > 0 ? subtitleParts.join(' · ') : undefined}
        utilityActions={(
          <>
            {utilityActions}
            <VersionHistoryAction
              config={{
                resourceKind: 'customers.company',
                resourceId: company.id,
                resourceIdFallback: historyFallbackId,
                organizationId: company.organizationId ?? undefined,
              }}
              t={t}
            />
          </>
        )}
        onDelete={() => {
          onDelete()
        }}
        isDeleting={isDeleting}
        deleteLabel={t('customers.companies.detail.actions.delete', 'Delete company')}
      />

      {/* Company metadata badges */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {company.status && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
            <span className="size-1.5 rounded-full bg-green-500" />
            <span className="text-green-600/70 dark:text-green-400/70">{t('customers.companies.detail.badges.status', 'Status')}:</span>
            {statusLabel ?? company.status}
          </span>
        )}
        {company.lifecycleStage && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            <span className="text-amber-600/70 dark:text-amber-400/70">{t('customers.companies.detail.badges.lifecycle', 'Lifecycle')}:</span>
            {lifecycleLabel ?? company.lifecycleStage}
          </span>
        )}
        {profile?.sizeBucket && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
            <span className="text-purple-600/70 dark:text-purple-400/70">{t('customers.companies.detail.badges.size', 'Size')}:</span>
            {profile.sizeBucket}
          </span>
        )}
      </div>

      {/* Header metadata strip — shows custom fields from the detail_header fieldset */}
      {headerFields.length > 0 && customFields && (
        <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-sm text-muted-foreground">
          {headerFields.map((def) => (
            <span key={def.key} className="inline-flex items-center gap-1.5">
              <span className="font-medium text-foreground/70">{def.label ?? def.key}:</span>
              {String(customFields[`cf_${def.key}`])}
            </span>
          ))}
        </div>
      )}

      {/* Highlights */}
      <div className="rounded-lg border">
        <div className="border-b px-4 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('customers.companies.detail.highlights.title', 'Highlights')}
          </span>
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-4">
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
    </div>
  )
}

export default CompanyHighlights
