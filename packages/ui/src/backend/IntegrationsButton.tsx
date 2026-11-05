'use client'

import Link from 'next/link'
import { PlugZap } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { IconButton } from '../primitives/icon-button'

export type IntegrationsButtonProps = {
  href?: string
}

export function IntegrationsButton({ href = '/backend/integrations' }: IntegrationsButtonProps) {
  const t = useT()
  const label = t('integrations.nav.title', 'Integrations')

  return (
    <IconButton
      asChild
      variant="ghost"
      size="sm"
      title={label}
      aria-label={label}
    >
      <Link href={href}>
        <PlugZap className="size-4" />
      </Link>
    </IconButton>
  )
}
