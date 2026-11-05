"use client"

import * as React from 'react'
import { Mail, Phone, User as UserIcon } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Avatar } from '../../primitives/avatar'
import { KeyValueList, RecordCardShell, TagRow, statusToTagVariant } from './RecordCardShell'
import type { PersonRecordPayload } from './types'

export interface PersonCardProps extends PersonRecordPayload {}

export function PersonCard(props: PersonCardProps) {
  const t = useT()
  const status = props.status
    ? { label: props.status, variant: statusToTagVariant(props.status) }
    : null

  const items = [
    props.title ? { label: t('ai_assistant.chat.records.fields.title', 'Title'), value: props.title } : null,
    props.companyName ? { label: t('ai_assistant.chat.records.fields.company', 'Company'), value: props.companyName } : null,
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
    props.phone
      ? {
          label: t('ai_assistant.chat.records.fields.phone', 'Phone'),
          value: (
            <a
              href={`tel:${props.phone.replace(/\s+/g, '')}`}
              className="text-primary hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {props.phone}
            </a>
          ),
        }
      : null,
    props.ownerName ? { label: t('ai_assistant.chat.records.fields.owner', 'Owner'), value: props.ownerName } : null,
  ].filter(Boolean) as { label: string; value: React.ReactNode }[]

  const subtitle = [props.title, props.companyName].filter(Boolean).join(' • ')

  return (
    <RecordCardShell
      kindLabel={t('ai_assistant.chat.records.kinds.person', 'Person')}
      kindIcon={<UserIcon className="size-4" aria-hidden />}
      leading={<Avatar label={props.name} src={props.avatarUrl ?? undefined} size="md" />}
      title={props.name}
      subtitle={subtitle || undefined}
      status={status}
      href={props.href}
      id={props.id}
      className={props.className}
      dataKind="person"
    >
      <div className="space-y-2">
        <KeyValueList items={items} />
        {props.tags && props.tags.length > 0 ? <TagRow tags={props.tags} /> : null}
      </div>
    </RecordCardShell>
  )
}

export default PersonCard

export { Mail, Phone, UserIcon }
