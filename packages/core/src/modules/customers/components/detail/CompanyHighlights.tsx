"use client"

import * as React from 'react'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { RecordConflictDialog, RecordLockBanner, useRecordLockGuard } from '@open-mercato/ui/backend/record-locking'
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
  organizationId?: string | null
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
  const recordLockConflictMessage = t('record_locks.conflict.title', 'Conflict detected')
  const lockGuard = useRecordLockGuard({
    resourceKind: 'customers.company',
    resourceId: company.id,
    enabled: Boolean(company.id),
  })
  const runLockedMutation = React.useCallback(async (operation: () => Promise<void>) => {
    const result = await lockGuard.runMutation(operation)
    if (result === null) {
      throw new Error(recordLockConflictMessage)
    }
  }, [lockGuard, recordLockConflictMessage])
  const historyFallbackId =
    profile?.id && profile.id !== company.id ? profile.id : undefined

  return (
    <div className="space-y-6">
      <RecordLockBanner
        t={t}
        strategy={lockGuard.lock.strategy}
        resourceEnabled={lockGuard.lock.resourceEnabled}
        isOwner={lockGuard.lock.isOwner}
        isBlocked={lockGuard.lock.isBlocked}
        error={lockGuard.lock.error}
      />
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
              organizationId: company.organizationId ?? undefined,
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
            onSave={async (next) => {
              await runLockedMutation(async () => {
                await onDisplayNameSave(next)
              })
            }}
            hideLabel
            variant="plain"
            activateOnClick
            triggerClassName="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
            containerClassName="max-w-full"
          />
        }
        onDelete={() => {
          void runLockedMutation(async () => {
            await Promise.resolve(onDelete())
          }).catch(() => {})
        }}
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
          onSave={async (next) => {
            await runLockedMutation(async () => {
              await onPrimaryEmailSave(next)
            })
          }}
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
          onSave={async (next) => {
            await runLockedMutation(async () => {
              await onPrimaryPhoneSave(next)
            })
          }}
        />
        <InlineDictionaryEditor
          label={t('customers.companies.detail.highlights.status', 'Status')}
          value={company.status ?? null}
          emptyLabel={t('customers.companies.detail.noValue', 'Not provided')}
          activateOnClick
          onSave={async (next) => {
            await runLockedMutation(async () => {
              await onStatusSave(next)
            })
          }}
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
          onSave={async (next) => {
            await runLockedMutation(async () => {
              await onNextInteractionSave(next)
            })
          }}
          activateOnClick
        />
      </div>
      <RecordConflictDialog
        open={Boolean(lockGuard.conflict)}
        onOpenChange={(open) => {
          if (!open) {
            lockGuard.clearConflict()
          }
        }}
        conflict={lockGuard.conflict}
        pending={lockGuard.pending}
        t={t}
        onResolve={async (resolution) => {
          await lockGuard.resolveConflict(resolution)
        }}
      />
    </div>
  )
}

export default CompanyHighlights
