"use client"
import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'

export default function ValidationWidget({ context, data, disabled }: InjectionWidgetComponentProps) {
  return (
    <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm">
      <div className="font-medium text-blue-900">Example Injection Widget</div>
      <div className="text-blue-700 mt-1">
        This widget is injected via the widget injection system. It can respond to form events and add custom UI.
      </div>
      {disabled && <div className="text-blue-600 mt-1 text-xs">Form is currently saving...</div>}
    </div>
  )
}
