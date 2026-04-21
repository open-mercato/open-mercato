"use client"

import * as React from 'react'
import Link from 'next/link'
import { Phone, Mail, Building2, Trash2, Pencil } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { useQueryClient } from '@tanstack/react-query'
import { PersonTagsDialog } from './PersonTagsDialog'
import { useCustomerDictionary, invalidateCustomerDictionary } from './hooks/useCustomerDictionary'
import { renderDictionaryIcon } from '../../../dictionaries/components/dictionaryAppearance'
import type { TagSummary } from './types'
import type { TagsSectionController } from '@open-mercato/ui/backend/detail'
import type { PersonOverview } from '../formConfig'
import type { CustomerDictionaryMap } from '@open-mercato/core/modules/customers/lib/dictionaries'
import { getInitials, formatFallbackLabel } from './utils'

type PersonDetailHeaderProps = {
  data: PersonOverview
  onTagsChange: (tags: TagSummary[]) => void
  tagsSectionControllerRef: React.RefObject<TagsSectionController | null>
  onSave: () => void
  onDelete: () => Promise<void>
  isDirty: boolean
  isSaving: boolean
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

function DictionaryBadge({ value, map, categoryIcon, className }: { value: string; map: CustomerDictionaryMap | undefined; categoryIcon?: React.ReactNode; className?: string }) {
  const entry = map?.[value]
  const color = entry?.color ?? null
  const icon = entry?.icon ?? null
  const label = entry?.label ?? formatFallbackLabel(value)
  const colorStyle: React.CSSProperties | undefined = color
    ? { color, borderColor: color, backgroundColor: `${color}1A` }
    : undefined
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-sm gap-1.5 text-xs font-medium',
        className,
      )}
      style={colorStyle}
    >
      {icon ? renderDictionaryIcon(icon, 'size-2.5') : categoryIcon ?? null}
      {label}
    </Badge>
  )
}

/** Renders a tag badge with color-based text/border/background from TagSummary.color. */
function TagBadge({ tag }: { tag: TagSummary }) {
  const colorStyle: React.CSSProperties | undefined = tag.color
    ? { color: tag.color, borderColor: tag.color, backgroundColor: `${tag.color}1A` }
    : undefined
  return (
    <Badge variant="outline" className="rounded-sm gap-1.5 text-xs font-medium" style={colorStyle}>
      {tag.label}
    </Badge>
  )
}

export function PersonDetailHeader({
  data,
  onTagsChange,
  tagsSectionControllerRef,
  onSave,
  onDelete,
  isDirty,
  isSaving,
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
  const visibleCompanies = React.useMemo(() => linkedCompanies.slice(0, 3), [linkedCompanies])
  const hiddenCompaniesCount = Math.max(0, linkedCompanies.length - visibleCompanies.length)
  const visibleTags = React.useMemo(() => data.tags.slice(0, 6), [data.tags])
  const hiddenTagsCount = Math.max(0, data.tags.length - visibleTags.length)
  const primaryCompany = linkedCompanies.find((entry) => entry.isPrimary) ?? linkedCompanies[0] ?? null
  const companyName = primaryCompany?.displayName ?? null
  const companyId = primaryCompany?.id ?? profile?.companyEntityId ?? null

  // Fetch dictionary maps for colored badge rendering (scoped to person's organization)
  const personOrgId = person.organizationId ?? null
  const { data: statusDict } = useCustomerDictionary('statuses', 0, personOrgId)
  const { data: lifecycleDict } = useCustomerDictionary('lifecycle-stages', 0, personOrgId)
  const { data: sourceDict } = useCustomerDictionary('sources', 0, personOrgId)
  const { data: temperatureDict } = useCustomerDictionary('temperature', 0, personOrgId)
  const { data: renewalQuarterDict } = useCustomerDictionary('renewal-quarters', 0, personOrgId)

  return (
    <div className="rounded-lg border bg-card px-6 py-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
        {/* Avatar */}
        <div className="flex size-18 shrink-0 items-center justify-center rounded-full bg-muted text-xl font-bold text-muted-foreground">
          {getInitials(displayName)}
        </div>

        {/* Person info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-bold text-foreground">{displayName}</h1>
            {data.isPrimary && (
              <span className="shrink-0 rounded-sm bg-status-warning-bg px-1.5 py-0.5 text-overline font-bold text-status-warning-text">
                {t('customers.people.detail.header.primary', 'PRIMARY')}
              </span>
            )}
          </div>

          {/* Subtitle: job title + company link */}
          {(jobTitle || companyName) && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {jobTitle}
              {jobTitle && companyName && ` ${t('customers.people.detail.header.at', 'at')} `}
              {companyName && companyId && (
                <Link href={`/backend/customers/companies-v2/${companyId}`} className="text-primary hover:underline">
                  {companyName}
                </Link>
              )}
              {companyName && !companyId && companyName}
            </p>
          )}

          {/* Contact row */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
            {person.primaryPhone && (
              <span className="inline-flex items-center gap-1.5">
                <Phone className="size-3.5" />
                <a href={`tel:${person.primaryPhone}`} className="hover:text-foreground">{person.primaryPhone}</a>
              </span>
            )}
            {person.primaryEmail && (
              <span className="inline-flex items-center gap-1.5">
                <Mail className="size-3.5" />
                <a href={`mailto:${person.primaryEmail}`} className="hover:text-foreground">{person.primaryEmail}</a>
              </span>
            )}
          </div>

          {/* Company chips (annotation 1a) */}
          {linkedCompanies.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                <Building2 className="mr-1 inline size-3.5" />
                {t('customers.people.detail.header.companies', 'Companies')} ({linkedCompanies.length}):
              </span>
              {visibleCompanies.map((company) => (
                <Link
                  key={company.id}
                  href={`/backend/customers/companies-v2/${company.id}`}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-xs font-semibold transition-colors hover:bg-status-info-bg',
                    company.isPrimary
                      ? 'border-status-info-border bg-status-info-bg text-status-info-text'
                      : 'border-border bg-background text-foreground',
                  )}
                >
                  <Building2 className="size-3" />
                  {company.displayName}
                  {company.isPrimary ? (
                    <span className="rounded-sm bg-status-info-icon px-1 py-px text-overline font-bold text-white">
                      {t('customers.people.detail.header.primary', 'PRIMARY')}
                    </span>
                  ) : null}
                </Link>
              ))}
              {hiddenCompaniesCount > 0 ? (
                <Badge variant="outline" className="rounded-sm text-xs font-semibold">
                  +{hiddenCompaniesCount} {t('customers.people.detail.header.more', 'more')}
                </Badge>
              ) : null}
            </div>
          )}

          {/* Status badges + inline tags + manage tags */}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {person.status && (
              <DictionaryBadge value={person.status} map={statusDict?.map} />
            )}
            {person.lifecycleStage && (
              <DictionaryBadge value={person.lifecycleStage} map={lifecycleDict?.map} />
            )}
            {person.source && (
              <DictionaryBadge value={person.source} map={sourceDict?.map} />
            )}
            {person.temperature && (
              <DictionaryBadge value={person.temperature} map={temperatureDict?.map} />
            )}
            {person.renewalQuarter && (
              <DictionaryBadge value={person.renewalQuarter} map={renewalQuarterDict?.map} />
            )}
            {/* Inline tag pills */}
            {visibleTags.map((tag) => (
              <TagBadge key={tag.id ?? tag.label} tag={tag} />
            ))}
            {hiddenTagsCount > 0 ? (
              <Badge variant="outline" className="rounded-sm gap-1.5 text-xs font-medium">
                +{hiddenTagsCount} {t('customers.people.detail.header.more', 'more')}
              </Badge>
            ) : null}
            {/* Manage tags — opens dialog directly */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-auto rounded-sm px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setManageTagsOpen(true)}
            >
              <Pencil className="mr-1 size-3" />
              {t('customers.people.detail.actions.manageTags', 'Edit tags')}
            </Button>
          </div>
        </div>

        {/* Right side: actions */}
        <div className="flex w-full shrink-0 items-center justify-start gap-2 sm:w-auto sm:justify-end">
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
          // Invalidate dictionary caches so header badges pick up fresh colors
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
