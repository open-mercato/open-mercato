"use client"

import * as React from 'react'
import Link from 'next/link'
import { Phone, Mail, Building2, Clock, Trash2, MoreHorizontal, Settings, SquarePen, Plus } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { TagsSection } from './TagsSection'
import { ManageTagsDialog } from './ManageTagsDialog'
import { useCustomerDictionary } from './hooks/useCustomerDictionary'
import { renderDictionaryIcon } from '../../../dictionaries/components/dictionaryAppearance'
import type { TagSummary } from './types'
import type { TagsSectionController } from '@open-mercato/ui/backend/detail'
import type { PersonOverview } from '../formConfig'
import type { CustomerDictionaryMap } from '@open-mercato/core/modules/customers/lib/dictionaries'

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
  onOpenCompaniesTab?: () => void
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].charAt(0).toUpperCase()
  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase()
}

/** Renders a badge with an optional colored dot indicator and/or icon from a dictionary map. */
function DictionaryBadge({ value, map, className }: { value: string; map: CustomerDictionaryMap | undefined; className?: string }) {
  const entry = map?.[value]
  const color = entry?.color ?? null
  const icon = entry?.icon ?? null
  const isHot = value.toLowerCase() === 'hot'
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-[4px] gap-1.5 text-[11px] font-medium',
        isHot && 'border-transparent bg-red-50 text-destructive dark:bg-red-950/30',
        className,
      )}
    >
      {icon ? (
        renderDictionaryIcon(icon, 'size-2.5')
      ) : color ? (
        <span className="inline-block size-2 shrink-0 rounded-[3px]" style={{ backgroundColor: color }} />
      ) : null}
      {value}
    </Badge>
  )
}

/** Renders a tag badge with an optional colored dot from TagSummary.color. */
function TagBadge({ tag }: { tag: TagSummary }) {
  return (
    <Badge variant="outline" className="rounded-[4px] gap-1.5 text-[11px] font-medium">
      {tag.color && <span className="inline-block size-2 shrink-0 rounded-[3px]" style={{ backgroundColor: tag.color }} />}
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
}: PersonDetailHeaderProps) {
  const t = useT()
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
  const primaryCompany = linkedCompanies.find((entry) => entry.isPrimary) ?? linkedCompanies[0] ?? null
  const companyName = primaryCompany?.displayName ?? null
  const companyId = primaryCompany?.id ?? profile?.companyEntityId ?? null

  // Fetch dictionary maps for colored badge rendering
  const { data: statusDict } = useCustomerDictionary('statuses')
  const { data: lifecycleDict } = useCustomerDictionary('lifecycle-stages')
  const { data: sourceDict } = useCustomerDictionary('sources')

  return (
    <div className="rounded-lg border bg-card px-6 py-5">
      <div className="flex items-start gap-5">
        {/* Avatar */}
        <div className="flex size-[72px] shrink-0 items-center justify-center rounded-full bg-muted text-xl font-bold text-muted-foreground">
          {getInitials(displayName)}
        </div>

        {/* Person info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-bold text-foreground">{displayName}</h1>
            {data.isPrimary && (
              <span className="shrink-0 rounded-[3px] bg-[#fef8eb] px-1.5 py-0.5 text-[9px] font-bold text-[#f29f12]">
                {t('customers.people.detail.header.primary', 'PRIMARY')}
              </span>
            )}
          </div>

          {/* Subtitle: job title + company link */}
          {(jobTitle || companyName) && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {jobTitle}
              {jobTitle && companyName && ' at '}
              {companyName && companyId && (
                <Link href={`/backend/customers/companies-v2/${companyId}`} className="text-primary hover:underline">
                  {companyName}
                </Link>
              )}
              {companyName && !companyId && companyName}
            </p>
          )}

          {/* Contact row with edit icons */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
            {person.primaryPhone && (
              <span className="inline-flex items-center gap-1.5">
                <Phone className="size-3.5" />
                <a href={`tel:${person.primaryPhone}`} className="hover:text-foreground">{person.primaryPhone}</a>
                <IconButton
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="size-5 text-muted-foreground/50"
                  aria-label={t('customers.people.detail.actions.editPhone', 'Edit phone')}
                  onClick={() => onFocusField?.('primaryPhone')}
                >
                  <SquarePen className="size-3" />
                </IconButton>
              </span>
            )}
            {person.primaryEmail && (
              <span className="inline-flex items-center gap-1.5">
                <Mail className="size-3.5" />
                <a href={`mailto:${person.primaryEmail}`} className="hover:text-foreground">{person.primaryEmail}</a>
                <IconButton
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="size-5 text-muted-foreground/50"
                  aria-label={t('customers.people.detail.actions.editEmail', 'Edit email')}
                  onClick={() => onFocusField?.('primaryEmail')}
                >
                  <SquarePen className="size-3" />
                </IconButton>
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
              {linkedCompanies.map((company) => (
                <Link
                  key={company.id}
                  href={`/backend/customers/companies-v2/${company.id}`}
                  className={cn(
                    'inline-flex items-center gap-[5px] rounded-[4px] border px-2 py-[3px] text-[11px] font-semibold transition-colors hover:bg-blue-100 dark:hover:bg-blue-950/40',
                    company.isPrimary
                      ? 'border-blue-500 bg-blue-50 text-blue-500 dark:border-blue-400 dark:bg-blue-950/30 dark:text-blue-400'
                      : 'border-border bg-background text-foreground',
                  )}
                >
                  <Building2 className="size-[11px]" />
                  {company.displayName}
                  {company.isPrimary ? (
                    <span className="rounded-[2px] bg-blue-500 px-1 py-px text-[8px] font-bold text-white dark:bg-blue-400">
                      {t('customers.people.detail.header.primary', 'PRIMARY')}
                    </span>
                  ) : null}
                </Link>
              ))}
              {onOpenCompaniesTab ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onOpenCompaniesTab}
                  className="h-auto rounded-[4px] border-dashed px-2 py-[3px] text-[11px] font-semibold text-muted-foreground"
                >
                  <Plus className="size-[11px]" />
                  {t('customers.people.detail.header.linkCompany', 'Link company')}
                </Button>
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
            {/* Inline tag pills */}
            {data.tags.map((tag) => (
              <TagBadge key={tag.id ?? tag.label} tag={tag} />
            ))}
            {/* Manage tags — opens popover */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-auto rounded-[4px] px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                >
                  <Settings className="mr-1 size-3" />
                  {t('customers.people.detail.actions.manageTags', 'Manage tags')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="start">
                <TagsSection
                  entityId={person.id}
                  tags={data.tags}
                  onChange={onTagsChange}
                  isSubmitting={false}
                  controllerRef={tagsSectionControllerRef}
                />
                <div className="mt-3 border-t pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs text-muted-foreground"
                    onClick={() => setManageTagsOpen(true)}
                  >
                    {t('customers.tags.manage.openFull', 'Manage tag dictionaries...')}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Right side: actions — Delete hidden in ⋯ menu (annotation 1b) */}
        <div className="flex shrink-0 items-center gap-2">
          <IconButton variant="outline" size="sm" type="button" aria-label={t('customers.people.detail.actions.history', 'History')}>
            <Clock className="size-4" />
          </IconButton>
          <Popover>
            <PopoverTrigger asChild>
              <IconButton variant="outline" size="sm" type="button" aria-label={t('customers.people.detail.actions.more', 'More')}>
                <MoreHorizontal className="size-4" />
              </IconButton>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start text-destructive hover:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="mr-2 size-4" />
                {t('customers.people.detail.actions.delete', 'Delete')}
              </Button>
            </PopoverContent>
          </Popover>
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
      <ManageTagsDialog open={manageTagsOpen} onClose={() => setManageTagsOpen(false)} />
    </div>
  )
}
