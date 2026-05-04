"use client"

import * as React from 'react'
import {
  Activity as ActivityIcon,
  CalendarClock,
  CheckCircle2,
  ListChecks,
  Mail,
  MessageSquare,
  Phone,
  StickyNote,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { KeyValueList, RecordCardShell, TagRow, statusToTagVariant } from './RecordCardShell'
import type { ActivityRecordPayload } from './types'

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function pickActivityIcon(type: string | null | undefined): LucideIcon {
  if (!type) return ActivityIcon
  const t = type.toLowerCase()
  if (t.includes('call')) return Phone
  if (t.includes('mail') || t.includes('email')) return Mail
  if (t.includes('meeting') || t.includes('chat')) return MessageSquare
  if (t.includes('task') || t.includes('todo')) return ListChecks
  if (t.includes('note')) return StickyNote
  if (t.includes('done') || t.includes('complete')) return CheckCircle2
  return ActivityIcon
}

export interface ActivityCardProps extends ActivityRecordPayload {}

export function ActivityCard(props: ActivityCardProps) {
  const t = useT()
  const Icon = pickActivityIcon(props.type)
  const status = props.status
    ? { label: props.status, variant: statusToTagVariant(props.status) }
    : null
  const dueDate = formatDate(props.dueDate)
  const completedAt = formatDate(props.completedAt)

  const items = [
    props.type ? { label: t('ai_assistant.chat.records.fields.type', 'Type'), value: props.type } : null,
    dueDate
      ? {
          label: t('ai_assistant.chat.records.fields.due', 'Due'),
          value: (
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-3 text-muted-foreground" aria-hidden />
              {dueDate}
            </span>
          ),
        }
      : null,
    completedAt
      ? {
          label: t('ai_assistant.chat.records.fields.completed', 'Completed'),
          value: (
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="size-3 text-status-success-icon" aria-hidden />
              {completedAt}
            </span>
          ),
        }
      : null,
    props.relatedTo ? { label: t('ai_assistant.chat.records.fields.related', 'Related'), value: props.relatedTo } : null,
    props.ownerName ? { label: t('ai_assistant.chat.records.fields.owner', 'Owner'), value: props.ownerName } : null,
  ].filter(Boolean) as { label: string; value: React.ReactNode }[]

  const subtitle = [props.type, props.relatedTo].filter(Boolean).join(' • ')

  return (
    <RecordCardShell
      kindLabel={t('ai_assistant.chat.records.kinds.activity', 'Activity')}
      kindIcon={<Icon className="size-4" aria-hidden />}
      title={props.title}
      subtitle={subtitle || undefined}
      status={status}
      href={props.href}
      id={props.id}
      className={props.className}
      dataKind="activity"
    >
      <div className="space-y-2">
        <KeyValueList items={items} />
        {props.description ? (
          <p className="line-clamp-3 text-muted-foreground">{props.description}</p>
        ) : null}
        {props.tags && props.tags.length > 0 ? <TagRow tags={props.tags} /> : null}
      </div>
    </RecordCardShell>
  )
}

export default ActivityCard
