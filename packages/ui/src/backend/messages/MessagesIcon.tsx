"use client"

import * as React from 'react'
import Link from 'next/link'
import { Mail } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '../../primitives/button'
import { useMessagesPoll } from './useMessagesPoll'

export type MessagesIconProps = {
  className?: string
  canViewMessages?: boolean
}

export function MessagesIcon({ className, canViewMessages = true }: MessagesIconProps) {
  const t = useT()
  const { unreadCount, hasNew } = useMessagesPoll({ enabled: canViewMessages })

  const ariaLabel = unreadCount > 0
    ? t('messages.badge.unread', '{count} unread messages', { count: unreadCount })
    : t('messages.nav.inbox', 'Messages')

  return (
    <Button variant="ghost" size="icon" asChild className={cn('relative', className)}>
      <Link href="/backend/messages" aria-label={ariaLabel}>
        <Mail className={cn('h-5 w-5', hasNew && 'animate-pulse')} />
        {unreadCount > 0 ? (
          <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-medium text-white dark:bg-destructive dark:text-destructive-foreground">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </Link>
    </Button>
  )
}
