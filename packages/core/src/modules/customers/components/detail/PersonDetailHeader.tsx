"use client"

import * as React from 'react'
import Link from 'next/link'
import { Trash2, Pencil } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { SendObjectMessageDialog } from '@open-mercato/ui/backend/messages'
import { useQueryClient } from '@tanstack/react-query'
import { ObjectHistoryButton } from './ObjectHistoryButton'
import { PersonTagsDialog } from './PersonTagsDialog'
import { useCustomerDictionary, invalidateCustomerDictionary } from './hooks/useCustomerDictionary'
import { renderDictionaryIcon } from '../../../dictionaries/components/dictionaryAppearance'
import type { TagSummary } from './types'
import type { TagsSectionController } from '@open-mercato/ui/backend/detail'
import type { PersonOverview } from '../formConfig'
import type { CustomerDictionaryMap } from '@open-mercato/core/modules/customers/lib/dictionaries'
import { formatFallbackLabel } from './utils'

const HEADER_ICON_BUTTON_CLASS = 'size-8 rounded-md'

type PersonDetailHeaderProps = {
  data: PersonOverview
  onTagsChange: (tags: TagSummary[]) => void
  tagsSectionControllerRef: React.RefObject<TagsSectionController | null>
  onSave: () => void
  onDelete: () => Promise<void>
  isDirty: boolean
  isSaving: boolean
  actions?: React.ReactNode
  /** Callback to focus a specific field in the Zone 1 CrudForm by field name. */
  onFocusField?: (fieldName: string) => void
  /**
   * @deprecated Kept for backward compatibility. The "+ Link company" header CTA was removed;
   * company linking now happens exclusively through the Zone 2 Companies tab via
   * `PersonCompaniesSection`. This prop is a no-op and will be removed in a future major release.
   */
  onOpenCompaniesTab?: () => void
  /** Callback to reload person data after tags dialog save. */
  onDataReload?: () => void
}

function HeaderFact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{children}</dd>
    </div>
  )
}

function DictionaryBadge({ value, map }: { value: string; map: CustomerDictionaryMap | undefined }) {
  const entry = map?.[value]
  const icon = entry?.icon ?? null
  const label = entry?.label ?? formatFallbackLabel(value)
  return (
    <Badge variant="secondary" leadingIcon={icon ? renderDictionaryIcon(icon, 'size-3') : undefined}>
      {label}
    </Badge>
  )
}

function TagBadge({ tag }: { tag: TagSummary }) {
  return <Badge variant="outline">{tag.label}</Badge>
}

export function PersonDetailHeader({
  data,
  onTagsChange,
  tagsSectionControllerRef,
  onSave,
  onDelete,
  isDirty,
  isSaving,
  actions,
  onFocusField,
  onOpenCompaniesTab,
  onDataReload,
}: PersonDetailHeaderProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const [manageTagsOpen, setManageTagsOpen] = React.useState(false)
  const person = data.person
  const profile = data.profile
  const displayName = person.displayName || t('customers.people.detail.untitled', 'Untitled')

  const jobTitle = profile?.jobTitle ?? null
  const linkedCompanies = React.useMemo(() => {
    const items = Array.isArray(data.companies) && data.companies.length > 0
      ? data.companies
      : data.company
        ? [{ ...data.company, isPrimary: Boolean(data.isPrimary) }]
        : []
    return items
  }, [data.companies, data.company, data.isPrimary])
  const hiddenCompaniesCount = Math.max(0, linkedCompanies.length - 1)
  const visibleTags = React.useMemo(() => data.tags.slice(0, 6), [data.tags])
  const hiddenTagsCount = Math.max(0, data.tags.length - visibleTags.length)
  const primaryCompany = linkedCompanies.find((entry) => entry.isPrimary) ?? linkedCompanies[0] ?? null
  const companyName = primaryCompany?.displayName ?? null
  const companyId = primaryCompany?.id ?? profile?.companyEntityId ?? null

  const personOrgId = person.organizationId ?? null
  const { data: statusDict } = useCustomerDictionary('statuses', 0, personOrgId)
  const { data: lifecycleDict } = useCustomerDictionary('lifecycle-stages', 0, personOrgId)
  const { data: sourceDict } = useCustomerDictionary('sources', 0, personOrgId)
  const { data: temperatureDict } = useCustomerDictionary('temperature', 0, personOrgId)
  const { data: renewalQuarterDict } = useCustomerDictionary('renewal-quarters', 0, personOrgId)

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 gap-5">
          <Avatar label={displayName} size="lg" variant="monochrome" />
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 truncate text-2xl font-normal leading-tight text-foreground">{displayName}</h1>
              {data.isPrimary ? (
                <Badge variant="info" size={16}>
                  {t('customers.people.detail.header.primary', 'PRIMARY')}
                </Badge>
              ) : null}
            </div>

            <dl className="flex flex-wrap gap-x-10 gap-y-3">
              {jobTitle ? (
                <HeaderFact label={t('customers.people.detail.facts.jobTitle', 'Job title')}>{jobTitle}</HeaderFact>
              ) : null}
              {companyName ? (
                <HeaderFact label={t('customers.people.detail.facts.company', 'Company')}>
                  {companyId ? (
                    <Link href={`/backend/customers/companies-v2/${companyId}`} className="hover:underline">
                      {companyName}
                    </Link>
                  ) : (
                    companyName
                  )}
                  {hiddenCompaniesCount > 0 ? (
                    <span className="text-muted-foreground"> +{hiddenCompaniesCount}</span>
                  ) : null}
                </HeaderFact>
              ) : null}
              {person.primaryPhone ? (
                <HeaderFact label={t('customers.people.detail.facts.phone', 'Phone')}>
                  <a href={`tel:${person.primaryPhone}`} className="hover:underline">{person.primaryPhone}</a>
                </HeaderFact>
              ) : null}
              {person.primaryEmail ? (
                <HeaderFact label={t('customers.people.detail.facts.email', 'Email')}>
                  <a href={`mailto:${person.primaryEmail}`} className="hover:underline">{person.primaryEmail}</a>
                </HeaderFact>
              ) : null}
            </dl>

            <div className="flex flex-wrap items-center gap-2">
              {person.status ? <DictionaryBadge value={person.status} map={statusDict?.map} /> : null}
              {person.lifecycleStage ? <DictionaryBadge value={person.lifecycleStage} map={lifecycleDict?.map} /> : null}
              {person.source ? <DictionaryBadge value={person.source} map={sourceDict?.map} /> : null}
              {person.temperature ? <DictionaryBadge value={person.temperature} map={temperatureDict?.map} /> : null}
              {person.renewalQuarter ? <DictionaryBadge value={person.renewalQuarter} map={renewalQuarterDict?.map} /> : null}
              {visibleTags.map((tag) => (
                <TagBadge key={tag.id ?? tag.label} tag={tag} />
              ))}
              {hiddenTagsCount > 0 ? (
                <Badge variant="outline">
                  +{hiddenTagsCount} {t('customers.people.detail.header.more', 'more')}
                </Badge>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setManageTagsOpen(true)}
              >
                <Pencil className="size-3.5" />
                {t('customers.people.detail.actions.manageTags', 'Edit tags')}
              </Button>
            </div>
          </div>
        </div>

        {/* Right side: actions */}
        <div className="flex w-full shrink-0 items-center justify-start gap-2 sm:w-auto sm:justify-end">
          {actions}
          <SendObjectMessageDialog
            object={{
              entityModule: 'customers',
              entityType: 'person',
              entityId: person.id,
              previewData: {
                title: displayName,
                subtitle: person.primaryEmail ?? companyName ?? undefined,
              },
            }}
            viewHref={`/backend/customers/people-v2/${person.id}`}
            buttonVariant="outline"
            buttonSize="icon"
            buttonClassName={HEADER_ICON_BUTTON_CLASS}
            buttonLabel={t('customers.people.detail.actions.sendMessage', 'Send message')}
          />
          <ObjectHistoryButton
            resourceKind="customers.person"
            resourceId={person.id}
            organizationId={person.organizationId ?? undefined}
          />
          <IconButton
            variant="outline"
            size="sm"
            type="button"
            aria-label={t('customers.people.detail.actions.delete', 'Delete')}
            onClick={() => {
              void onDelete()
            }}
          >
            <Trash2 className="size-4" />
          </IconButton>
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={!isDirty || isSaving}
          >
            {t('customers.people.detail.actions.save', 'Save')}
          </Button>
        </div>
      </div>
      <PersonTagsDialog
        open={manageTagsOpen}
        onClose={() => setManageTagsOpen(false)}
        personId={person.id}
        personOrganizationId={person.organizationId ?? null}
        personData={{
          status: person.status,
          lifecycleStage: person.lifecycleStage,
          source: person.source,
          temperature: person.temperature,
          renewalQuarter: person.renewalQuarter,
          jobTitle: data.profile?.jobTitle ?? null,
          customFields: data.customFields,
          tags: data.tags,
        }}
        onSaved={() => {
          void invalidateCustomerDictionary(queryClient, 'statuses')
          void invalidateCustomerDictionary(queryClient, 'lifecycle-stages')
          void invalidateCustomerDictionary(queryClient, 'sources')
          void invalidateCustomerDictionary(queryClient, 'temperature')
          void invalidateCustomerDictionary(queryClient, 'renewal-quarters')
          onDataReload?.()
        }}
      />
    </div>
  )
}
