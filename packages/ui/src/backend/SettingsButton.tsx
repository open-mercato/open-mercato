'use client'
import Link from 'next/link'
import { Settings } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type SettingsButtonProps = {
  href?: string
}

export function SettingsButton({ href = '/backend/settings' }: SettingsButtonProps) {
  const t = useT()

  return (
    <Link
      href={href}
      className="text-sm px-2 py-1 rounded hover:bg-accent inline-flex items-center gap-2"
      title={t('backend.nav.settings', 'Settings')}
    >
      <Settings className="size-4" />
    </Link>
  )
}
