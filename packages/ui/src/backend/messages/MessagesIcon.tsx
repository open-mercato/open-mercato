"use client"

import * as React from 'react'
import Link from 'next/link'
import { Mail } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { IconButton } from '../../primitives/icon-button'
import { NotificationCountBadge } from '../notifications/NotificationCountBadge'
import { useMessages } from './useMessages'

export type MessagesIconProps = {
  className?: string
}

export function MessagesIcon({ className }: MessagesIconProps) {
  const t = useT()
  const { unreadCount, hasNew } = useMessages()

  const ariaLabel = unreadCount > 0
    ? t('messages.badge.unread', '{count} unread messages', { count: unreadCount })
    : t('messages.nav.inbox', 'Messages')

  return (
    <IconButton variant="ghost" size="sm" asChild className={cn('relative', className)}>
      <Link href="/backend/messages" aria-label={ariaLabel}>
        <Mail className={cn('h-5 w-5', hasNew && 'animate-pulse')} />
        <NotificationCountBadge count={unreadCount} />
      </Link>
    </IconButton>
  )
}
