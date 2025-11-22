"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export function ErrorNotice({ title, message, action }: {
  title?: string
  message?: string
  action?: React.ReactNode
}) {
  const t = useT()
  const defaultTitle = title ?? t('ui.errors.defaultTitle', 'Something went wrong')
  const defaultMessage = message ?? t('ui.errors.defaultMessage', 'Unable to load data. Please try again.')
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-800">
      <div className="flex items-start gap-3">
        <span className="inline-block mt-0.5 h-4 w-4 rounded-full border-2 border-red-500" aria-hidden />
        <div className="space-y-1">
          <div className="text-sm font-medium">{defaultTitle}</div>
          <div className="text-sm opacity-90">{defaultMessage}</div>
          {action ? <div className="mt-2">{action}</div> : null}
        </div>
      </div>
    </div>
  )
}

