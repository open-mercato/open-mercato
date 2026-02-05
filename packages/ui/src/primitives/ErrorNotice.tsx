"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Notice } from './Notice'

export function ErrorNotice({ title, message, action }: {
  title?: string
  message?: string
  action?: React.ReactNode
}) {
  const t = useT()
  const defaultTitle = title ?? t('ui.errors.defaultTitle', 'Something went wrong')
  const defaultMessage = message ?? t('ui.errors.defaultMessage', 'Unable to load data. Please try again.')
  return (
    <Notice variant="error" title={defaultTitle} message={defaultMessage} action={action} />
  )
}
