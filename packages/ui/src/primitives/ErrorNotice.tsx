"use client"
import * as React from 'react'

export function ErrorNotice({ title = 'Something went wrong', message = 'Unable to load data. Please try again.', action }: {
  title?: string
  message?: string
  action?: React.ReactNode
}) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-800">
      <div className="flex items-start gap-3">
        <span className="inline-block mt-0.5 h-4 w-4 rounded-full border-2 border-red-500" aria-hidden />
        <div className="space-y-1">
          <div className="text-sm font-medium">{title}</div>
          <div className="text-sm opacity-90">{message}</div>
          {action ? <div className="mt-2">{action}</div> : null}
        </div>
      </div>
    </div>
  )
}

