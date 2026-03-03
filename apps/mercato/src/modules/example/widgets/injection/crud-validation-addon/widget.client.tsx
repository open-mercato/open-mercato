"use client"
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'

export default function CrudValidationAddonWidget({ disabled }: InjectionWidgetComponentProps) {
  return (
    <div
      data-testid="recursive-widget-addon"
      className="mt-1 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800"
    >
      <span className="font-medium">Recursive addon</span>
      <span className="ml-1">— injected into validation widget&apos;s nested spot</span>
      {disabled && <span className="ml-1 text-emerald-600">(form saving)</span>}
    </div>
  )
}
