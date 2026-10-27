"use client"
import * as React from 'react'
import Link from 'next/link'
import type { CustomFieldDefDto } from '@open-mercato/ui/backend/utils/customFieldDefs'
import {
  getRecordListRelationDisplays,
  resolveRecordListRelationDisplays,
  type RelationDisplaysByField,
} from './recordListRelationDisplays'

const RelationDisplaysContext = React.createContext<RelationDisplaysByField>({})

export function RelationDisplaysProvider({
  displaysByField,
  children,
}: {
  displaysByField: RelationDisplaysByField
  children: React.ReactNode
}) {
  return (
    <RelationDisplaysContext.Provider value={displaysByField}>
      {children}
    </RelationDisplaysContext.Provider>
  )
}

export function useRecordListRelationDisplays(
  definitions: CustomFieldDefDto[],
  records: Array<Record<string, unknown>>,
): RelationDisplaysByField {
  const [displaysByField, setDisplaysByField] = React.useState<RelationDisplaysByField>({})

  React.useEffect(() => {
    const abortController = new AbortController()
    setDisplaysByField((current) => (Object.keys(current).length ? {} : current))
    if (!definitions.length || !records.length) {
      return () => abortController.abort()
    }

    void resolveRecordListRelationDisplays(definitions, records, abortController.signal)
      .then((resolvedDisplays) => {
        if (!abortController.signal.aborted) setDisplaysByField(resolvedDisplays)
      })
      .catch(() => {
        if (!abortController.signal.aborted) setDisplaysByField({})
      })

    return () => abortController.abort()
  }, [definitions, records])

  return displaysByField
}

export function RelationCell({
  fieldKey,
  value,
  fallbackText,
}: {
  fieldKey: string
  value: unknown
  fallbackText: string
}) {
  const displaysByField = React.useContext(RelationDisplaysContext)
  const resolvedDisplays = getRecordListRelationDisplays(value, displaysByField[fieldKey])
  const rawValue = resolvedDisplays.map((display) => display.id).join(', ') || fallbackText

  if (!resolvedDisplays.length) {
    return <span className="inline-block max-w-60 truncate align-top" title={rawValue}>{rawValue}</span>
  }

  return (
    <span className="inline-block max-w-60 truncate align-top" title={rawValue}>
      {resolvedDisplays.map((display, index) => (
        <React.Fragment key={`${display.id}-${index}`}>
          {index > 0 ? ', ' : null}
          {display.href ? (
            <Link
              href={display.href}
              className="font-medium text-primary underline-offset-2 hover:underline focus-visible:underline"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {display.label}
            </Link>
          ) : display.label}
        </React.Fragment>
      ))}
    </span>
  )
}
