"use client"

import * as React from 'react'
import { Phone, Mail, Clock, Trash2, Building2, Globe, MoreHorizontal, Settings, MapPin } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { CompanyTagsDialog } from './CompanyTagsDialog'
import { invalidateCustomerDictionary, useCustomerDictionary } from './hooks/useCustomerDictionary'
import { renderDictionaryIcon } from '../../../dictionaries/components/dictionaryAppearance'
import type { TagSummary } from './types'
import type { TagsSectionController } from '@open-mercato/ui/backend/detail'
import type { CompanyOverview } from '../formConfig'
import type { CustomerDictionaryMap } from '@open-mercato/core/modules/customers/lib/dictionaries'
import { formatFallbackLabel } from './utils'

type CompanyDetailHeaderProps = {
  data: CompanyOverview
  onTagsChange: (tags: TagSummary[]) => void
  tagsSectionControllerRef: React.RefObject<TagsSectionController | null>
  onSave: () => void
  onDelete: () => Promise<void>
  isDirty: boolean
  isSaving: boolean
  onFocusField?: (fieldName: string) => void
  onDataReload?: () => void
}

function CompanyDictionaryBadge({ value, map }: { value: string; map: CustomerDictionaryMap | undefined }) {
  const entry = map?.[value]
  const color = entry?.color ?? null
  const icon = entry?.icon ?? null
  const label = entry?.label ?? formatFallbackLabel(value)
  const colorStyle: React.CSSProperties | undefined = color
    ? { color, borderColor: color, backgroundColor: `${color}1A` }
    : undefined
  return (
    <Badge variant="outline" className="rounded-[4px] gap-1.5 text-[11px] font-medium" style={colorStyle}>
      {icon ? renderDictionaryIcon(icon, 'size-2.5') : null}
      {label}
    </Badge>
  )
}

export function CompanyDetailHeader({
  data,
  onTagsChange,
  tagsSectionControllerRef,
  onSave,
  onDelete,
  isDirty,
  isSaving,
  onFocusField,
  onDataReload,
}: CompanyDetailHeaderProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const [manageTagsOpen, setManageTagsOpen] = React.useState(false)
  const company = data.company
  const profile = data.profile
  const displayName = company.displayName || t('customers.companies.detail.untitled', 'Untitled')

  const industryLabel = profile?.industry ?? null
  const sizeLabel = profile?.sizeBucket ?? null
  const subtitle = [industryLabel, sizeLabel ? t('customers.companies.detail.header.employees', '{count} employees', { count: sizeLabel }) : null].filter(Boolean).join(' \u00b7 ')

  // Primary address for header
  const primaryAddress = React.useMemo(() => {
    const addresses = (data as Record<string, unknown>).addresses as Array<{ isPrimary?: boolean; city?: string; region?: string; postalCode?: string }> | undefined
    if (!addresses || !Array.isArray(addresses)) return null
    return addresses.find((a) => a.isPrimary) ?? addresses[0] ?? null
  }, [data])

  const locationText = React.useMemo(() => {
    if (!primaryAddress) return null
    return [primaryAddress.city, primaryAddress.region, primaryAddress.postalCode].filter(Boolean).join(', ')
  }, [primaryAddress])

  // Fetch dictionary maps for colored badge rendering
  const companyOrgId = company.organizationId ?? null
  const { data: statusDict } = useCustomerDictionary('statuses', 0, companyOrgId)
  const { data: lifecycleDict } = useCustomerDictionary('lifecycle-stages', 0, companyOrgId)
  const { data: sourceDict } = useCustomerDictionary('sources', 0, companyOrgId)
  const { data: temperatureDict } = useCustomerDictionary('temperature', 0, companyOrgId)
  const { data: renewalQuarterDict } = useCustomerDictionary('renewal-quarters', 0, companyOrgId)

  return (
    <div className="rounded-lg border bg-card">
      {/* Top row: avatar + company info + account manager + actions */}
      <div className="flex items-start gap-5 px-6 pt-6 pb-3">
        {/* Avatar */}
        <div className="flex size-[72px] shrink-0 items-center justify-center rounded-full bg-muted">
          <Building2 className="size-7 text-muted-foreground" />
        </div>

        {/* Company info */}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold text-foreground">{displayName}</h1>
          {subtitle && (
            <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
          )}

          {/* Contact row */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
            {company.primaryPhone && (
              <span className="inline-flex items-center gap-1.5">
                <Phone className="size-3.5" />
                <a href={`tel:${company.primaryPhone}`} className="hover:text-foreground">{company.primaryPhone}</a>
              </span>
            )}
            {company.primaryEmail && (
              <span className="inline-flex items-center gap-1.5">
                <Mail className="size-3.5" />
                <a href={`mailto:${company.primaryEmail}`} className="hover:text-foreground">{company.primaryEmail}</a>
              </span>
            )}
            {profile?.websiteUrl && (
              <a href={profile.websiteUrl.startsWith('http') ? profile.websiteUrl : `https://${profile.websiteUrl}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-foreground">
                <Globe className="size-3.5" />
                {profile.websiteUrl}
              </a>
            )}
            {locationText && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5" />
                {locationText}
              </span>
            )}
          </div>

          {/* Status badges + temperature + renewal quarter + inline tags */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {company.status && (
              <CompanyDictionaryBadge value={company.status} map={statusDict?.map} />
            )}
            {company.lifecycleStage && (
              <CompanyDictionaryBadge value={company.lifecycleStage} map={lifecycleDict?.map} />
            )}
            {company.source && (
              <CompanyDictionaryBadge value={company.source} map={sourceDict?.map} />
            )}
            {company.temperature && (
              <CompanyDictionaryBadge value={company.temperature} map={temperatureDict?.map} />
            )}
            {company.renewalQuarter && (
              <CompanyDictionaryBadge value={company.renewalQuarter} map={renewalQuarterDict?.map} />
            )}
            {data.tags?.filter((tag) => !['status', 'lifecycle_stage', 'source'].includes(tag.id)).map((tag) => {
              const colorStyle: React.CSSProperties | undefined = tag.color
                ? { color: tag.color, borderColor: tag.color, backgroundColor: `${tag.color}1A` }
                : undefined
              return (
                <Badge
                  key={tag.id}
                  variant="outline"
                  className="rounded-[4px] gap-1.5 text-[11px] font-medium"
                  style={colorStyle}
                >
                  {tag.label}
                </Badge>
              )
            })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-auto rounded-[4px] px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setManageTagsOpen(true)}
            >
              <Settings className="mr-1 size-3" />
              {t('customers.companies.detail.actions.manageTags', 'Manage tags')}
            </Button>
          </div>
        </div>

        {/* Right side: actions */}
        <div className="flex shrink-0 flex-col items-end gap-3">
          {/* Action buttons - delete in three-dot menu */}
          <div className="flex items-center gap-2">
            <IconButton variant="outline" size="sm" type="button" aria-label={t('customers.companies.detail.actions.history', 'History')}>
              <Clock className="size-4" />
            </IconButton>
            <Popover>
              <PopoverTrigger asChild>
                <IconButton variant="outline" size="sm" type="button" aria-label={t('customers.companies.detail.actions.more', 'More')}>
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
                  {t('customers.companies.detail.actions.delete', 'Delete')}
                </Button>
              </PopoverContent>
            </Popover>
            <Button
              type="button"
              size="sm"
              onClick={onSave}
              disabled={!isDirty || isSaving}
            >
              {t('customers.companies.detail.actions.save', 'Save')}
            </Button>
          </div>
        </div>
      </div>

      <CompanyTagsDialog
        open={manageTagsOpen}
        onClose={() => setManageTagsOpen(false)}
        entityId={company.id}
        companyOrganizationId={company.organizationId ?? null}
        companyData={{
          status: company.status,
          lifecycleStage: company.lifecycleStage,
          source: company.source,
          temperature: company.temperature,
          renewalQuarter: company.renewalQuarter,
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
