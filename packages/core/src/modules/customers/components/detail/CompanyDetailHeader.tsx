"use client"

import * as React from 'react'
import { Phone, Mail, Clock, Trash2, Building2, Globe } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { TagsSection } from './TagsSection'
import type { TagSummary } from './types'
import type { TagsSectionController } from '@open-mercato/ui/backend/detail'
import type { CompanyOverview } from '../formConfig'

type CompanyDetailHeaderProps = {
  data: CompanyOverview
  onTagsChange: (tags: TagSummary[]) => void
  tagsSectionControllerRef: React.RefObject<TagsSectionController | null>
  onSave: () => void
  onDelete: () => Promise<void>
  isDirty: boolean
  isSaving: boolean
  activeTab: string
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].charAt(0).toUpperCase()
  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase()
}


export function CompanyDetailHeader({
  data,
  onTagsChange,
  tagsSectionControllerRef,
  onSave,
  onDelete,
  isDirty,
  isSaving,
  activeTab,
}: CompanyDetailHeaderProps) {
  const t = useT()
  const company = data.company
  const profile = data.profile
  const displayName = company.displayName || t('customers.companies.detail.untitled', 'Untitled')

  const industryLabel = profile?.industry ?? null
  const sizeLabel = profile?.sizeBucket ?? null
  const subtitle = [industryLabel, sizeLabel ? `${sizeLabel} employees` : null].filter(Boolean).join(' · ')

  const showSaveDelete = activeTab === 'dane-firmy'

  return (
    <div className="rounded-lg border bg-card">
      {/* Top row: avatar + company info + account manager + actions */}
      <div className="flex items-start gap-5 px-6 pt-6 pb-3">
        {/* Avatar — building icon matching Figma */}
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
              <a href={`tel:${company.primaryPhone}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                <Phone className="size-3.5" />
                {company.primaryPhone}
              </a>
            )}
            {company.primaryEmail && (
              <a href={`mailto:${company.primaryEmail}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                <Mail className="size-3.5" />
                {company.primaryEmail}
              </a>
            )}
            {profile?.websiteUrl && (
              <a href={profile.websiteUrl.startsWith('http') ? profile.websiteUrl : `https://${profile.websiteUrl}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-foreground">
                <Globe className="size-3.5" />
                {profile.websiteUrl}
              </a>
            )}
          </div>

          {/* Status badges + inline tags */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {company.status && (
              <Badge variant="outline" className="text-xs">
                <span className="mr-1.5 inline-block size-1.5 rounded-full bg-emerald-500" />
                {company.status}
              </Badge>
            )}
            {company.lifecycleStage && (
              <Badge variant="secondary" className="text-xs">
                {company.lifecycleStage}
              </Badge>
            )}
            {company.source && (
              <Badge variant="outline" className="text-xs">
                {company.source}
              </Badge>
            )}
            {data.tags?.filter((tag) => !['status', 'lifecycle_stage', 'source'].includes(tag.id)).map((tag) => (
              <Badge
                key={tag.id}
                variant="outline"
                className="text-xs"
                style={tag.color ? { borderColor: tag.color, color: tag.color } : undefined}
              >
                {tag.label}
              </Badge>
            ))}
            <span className="text-xs text-muted-foreground">·</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {t('customers.companies.detail.actions.manageTags', 'Manage tags')}
            </Button>
          </div>
        </div>

        {/* Right side: Account manager + actions */}
        <div className="flex shrink-0 flex-col items-end gap-3">
          {/* Account manager card */}
          <div className="flex items-center gap-2.5 rounded-lg border px-3 py-2">
            <div className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
              {data.viewer?.name ? getInitials(data.viewer.name) : '?'}
            </div>
            <div className="text-right">
              <p className="text-[11px] text-muted-foreground">
                {t('customers.companies.detail.accountManager', 'Account manager')}
              </p>
              <p className="text-sm font-medium text-foreground">
                {data.viewer?.name || t('customers.companies.detail.notAssigned', 'Not assigned')}
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <IconButton variant="ghost" size="sm" type="button" aria-label={t('customers.companies.detail.actions.history', 'History')}>
              <Clock className="size-4" />
            </IconButton>
            {showSaveDelete && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={onDelete}
                >
                  <Trash2 className="mr-1.5 size-3.5" />
                  {t('customers.companies.detail.actions.delete', 'Delete')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={onSave}
                  disabled={!isDirty || isSaving}
                >
                  {t('customers.companies.detail.actions.save', 'Save')}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Tags (compact) */}
      <div className="px-6 pb-2">
        <TagsSection
          entityId={company.id}
          tags={data.tags}
          onChange={onTagsChange}
          isSubmitting={false}
          controllerRef={tagsSectionControllerRef}
        />
      </div>

    </div>
  )
}
