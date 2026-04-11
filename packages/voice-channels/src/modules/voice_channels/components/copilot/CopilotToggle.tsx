'use client'

import { Button } from '@open-mercato/ui/primitives/button'

interface CopilotToggleProps {
  enabled: boolean
  onChange: (enabled: boolean) => void
}

export function CopilotToggle({ enabled, onChange }: CopilotToggleProps) {
  return (
    <Button
      type="button"
      onClick={() => onChange(!enabled)}
      variant="outline"
      size="sm"
      className={
        enabled
          ? 'h-auto rounded-full border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100'
          : 'h-auto rounded-full border-slate-300 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-200'
      }
    >
      <span
        className={
          enabled
            ? 'inline-block h-2 w-2 rounded-full bg-emerald-500'
            : 'inline-block h-2 w-2 rounded-full bg-slate-400'
        }
      />
      {enabled ? 'ON' : 'OFF'}
    </Button>
  )
}
