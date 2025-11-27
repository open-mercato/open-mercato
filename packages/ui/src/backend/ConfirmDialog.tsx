"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export function ConfirmDialog({ trigger, title, description, onConfirm }: {
  trigger: React.ReactNode
  title?: string
  description?: string
  onConfirm: () => void
}) {
  const t = useT()
  const defaultTitle = title ?? t('ui.dialogs.confirm.defaultTitle', 'Are you sure?')
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault()
    if (window.confirm(`${defaultTitle}\n${description ?? ''}`.trim())) onConfirm()
  }
  return <span onClick={onClick}>{trigger}</span>
}

