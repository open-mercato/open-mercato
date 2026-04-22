"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription, AlertTitle } from './alert'

export function ErrorNotice({ title, message, action }: {
  title?: string
  message?: string
  action?: React.ReactNode
}) {
  const t = useT()
  const resolvedTitle = title ?? t('ui.errors.defaultTitle', 'Something went wrong')
  const resolvedMessage = message ?? t('ui.errors.defaultMessage', 'Unable to load data. Please try again.')
  return (
    <Alert variant="destructive">
      <AlertTitle>{resolvedTitle}</AlertTitle>
      <AlertDescription>{resolvedMessage}</AlertDescription>
      {action ? <div className="mt-2">{action}</div> : null}
    </Alert>
  )
}
