"use client"

import * as React from 'react'
import { Building2, Globe, Mail, MapPin, Phone } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Avatar } from '../../primitives/avatar'
import { KeyValueList, RecordCardShell, TagRow, statusToTagVariant } from './RecordCardShell'
import type { CompanyRecordPayload } from './types'

export interface CompanyCardProps extends CompanyRecordPayload {}

function normalizeWebsite(value: string): { href: string; label: string } {
  const trimmed = value.trim()
  if (/^https?:\/\//i.test(trimmed)) {
    return { href: trimmed, label: trimmed.replace(/^https?:\/\//i, '') }
  }
  return { href: `https://${trimmed}`, label: trimmed }
}

export function CompanyCard(props: CompanyCardProps) {
  const t = useT()
  const status = props.status
    ? { label: props.status, variant: statusToTagVariant(props.status) }
    : null

  const websiteEntry = props.website ? normalizeWebsite(props.website) : null
  const location = [props.city, props.country].filter(Boolean).join(', ')

  const items = [
    props.industry ? { label: t('ai_assistant.chat.records.fields.industry', 'Industry'), value: props.industry } : null,
    websiteEntry
      ? {
          label: t('ai_assistant.chat.records.fields.website', 'Website'),
          value: (
            <a
              href={websiteEntry.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {websiteEntry.label}
            </a>
          ),
        }
      : null,
    props.email
      ? {
          label: t('ai_assistant.chat.records.fields.email', 'Email'),
          value: (
            <a
              href={`mailto:${props.email}`}
              className="text-primary hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {props.email}
            </a>
          ),
        }
      : null,
    props.phone ? { label: t('ai_assistant.chat.records.fields.phone', 'Phone'), value: props.phone } : null,
    location ? { label: t('ai_assistant.chat.records.fields.location', 'Location'), value: location } : null,
    props.ownerName ? { label: t('ai_assistant.chat.records.fields.owner', 'Owner'), value: props.ownerName } : null,
  ].filter(Boolean) as { label: string; value: React.ReactNode }[]

  return (
    <RecordCardShell
      kindLabel={t('ai_assistant.chat.records.kinds.company', 'Company')}
      kindIcon={<Building2 className="size-4" aria-hidden />}
      leading={<Avatar label={props.name} src={props.logoUrl ?? undefined} size="md" variant="monochrome" />}
      title={props.name}
      subtitle={[props.industry, location].filter(Boolean).join(' • ') || undefined}
      status={status}
      href={props.href}
      id={props.id}
      className={props.className}
      dataKind="company"
    >
      <div className="space-y-2">
        <KeyValueList items={items} />
        {props.tags && props.tags.length > 0 ? <TagRow tags={props.tags} /> : null}
      </div>
    </RecordCardShell>
  )
}

export default CompanyCard

export { Building2, Globe, Mail, MapPin, Phone }
