'use client'

import { formatDistanceToNow } from 'date-fns'
import { ShieldCheck } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import type { MfaMethod } from '../types'

type MfaMethodCardProps = {
  method: MfaMethod
  removing?: boolean
  onRemove: (method: MfaMethod) => void
}

function formatLastUsed(value: string | null, localeT: ReturnType<typeof useT>): string {
  if (!value) {
    return localeT('security.profile.mfa.method.neverUsed', 'Never used')
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return localeT('security.profile.mfa.method.unknownTime', 'Unknown')
  }
  return formatDistanceToNow(parsed, { addSuffix: true })
}

export default function MfaMethodCard({ method, removing = false, onRemove }: MfaMethodCardProps) {
  const t = useT()

  return (
    <article className="rounded-md border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {method.label ?? method.type}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('security.profile.mfa.method.type', 'Type')}: {method.type}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('security.profile.mfa.method.lastUsed', 'Last used')}: {formatLastUsed(method.lastUsedAt, t)}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-green-500/40 bg-green-50 px-2 py-1 text-xs text-green-700">
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          {t('security.profile.mfa.method.active', 'Active')}
        </span>
      </div>
      <div className="mt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={removing}
          onClick={() => onRemove(method)}
        >
          {t('security.profile.mfa.method.remove', 'Remove')}
        </Button>
      </div>
    </article>
  )
}
