"use client"

import { useT } from '@open-mercato/shared/lib/i18n/context'

type ComingSoonPlaceholderProps = {
  label: string
}

export function ComingSoonPlaceholder({ label }: ComingSoonPlaceholderProps) {
  const t = useT()
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border bg-card px-6 py-16 text-center">
      <div className="mb-3 text-4xl text-muted-foreground/40">
        <svg className="mx-auto size-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-foreground">{label}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('customers.detail.comingSoon', 'Coming soon')}
      </p>
    </div>
  )
}
