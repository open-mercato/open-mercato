"use client"

import { Clock } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ComingSoonPlaceholderProps = {
  label: string
}

export function ComingSoonPlaceholder({ label }: ComingSoonPlaceholderProps) {
  const t = useT()
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border bg-card px-6 py-16 text-center">
      <Clock className="mb-3 size-12 text-muted-foreground/40" aria-hidden="true" />
      <h3 className="text-lg font-semibold text-foreground">{label}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('customers.detail.comingSoon', 'Coming soon')}
      </p>
    </div>
  )
}
