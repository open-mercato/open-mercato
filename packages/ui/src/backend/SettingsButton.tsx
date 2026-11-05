'use client'
import Link from 'next/link'
import { Settings } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { IconButton } from '../primitives/icon-button'

export type SettingsButtonProps = {
  href?: string
}

export function SettingsButton({ href = '/backend/settings' }: SettingsButtonProps) {
  const t = useT()

  return (
    <IconButton
      asChild
      variant="ghost"
      size="sm" 
      title={t('backend.nav.settings', 'Settings')}
    >
      <Link href={href}>
        <Settings className="size-4" />
      </Link>
    </IconButton>
  )
}
