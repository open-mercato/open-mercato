"use client"

import * as React from 'react'
import { Mail, Phone, User as UserIcon } from 'lucide-react'
import { Avatar } from '../../primitives/avatar'
import { KeyValueList, RecordCardShell, TagRow, statusToTagVariant } from './RecordCardShell'
import type { PersonRecordPayload } from './types'

export interface PersonCardProps extends PersonRecordPayload {}

export function PersonCard(props: PersonCardProps) {
  const status = props.status
    ? { label: props.status, variant: statusToTagVariant(props.status) }
    : null

  const items = [
    props.title ? { label: 'Title', value: props.title } : null,
    props.companyName ? { label: 'Company', value: props.companyName } : null,
    props.email
      ? {
          label: 'Email',
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
          label: 'Phone',
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
    props.ownerName ? { label: 'Owner', value: props.ownerName } : null,
  ].filter(Boolean) as { label: string; value: React.ReactNode }[]

  const subtitle = [props.title, props.companyName].filter(Boolean).join(' • ')

  return (
    <RecordCardShell
      kindLabel="Person"
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
