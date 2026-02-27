"use client"

import * as React from 'react'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { MessageListItemProps } from '@open-mercato/shared/modules/messages/types'
import type { MessageDetail } from '../types'

export type ConversationItem = {
  id: string
  senderUserId: string
  senderName?: string | null
  senderEmail?: string | null
  body: string
  bodyFormat?: 'text' | 'markdown'
  sentAt?: string | null
  objects?: Array<{ id: string }>
}

type UseMessageDetailsConversationInput = {
  detail: MessageDetail | null
  t: TranslateFn
}

export function useMessageDetailsConversation({
  detail,
  t,
}: UseMessageDetailsConversationInput) {
  const conversationItems = React.useMemo<ConversationItem[]>(() => {
    const thread = detail?.thread ?? []
    if (thread.length === 0 && detail) {
      return [{
        id: detail.id,
        senderUserId: detail.senderUserId,
        senderName: detail.senderName,
        senderEmail: detail.senderEmail,
        body: detail.body,
        bodyFormat: detail.bodyFormat,
        sentAt: detail.sentAt,
        objects: detail.objects.map((item) => ({ id: item.id })),
      }]
    }

    const items = thread
      .map((item) => ({
        id: item.id,
        senderUserId: item.senderUserId,
        senderName: item.senderName,
        senderEmail: item.senderEmail,
        body: item.body,
        bodyFormat: item.bodyFormat,
        sentAt: item.sentAt,
        objects: item.objects?.map((entry) => ({ id: entry.id })) ?? [],
      }))

    if (detail && !items.some((item) => item.id === detail.id)) {
      items.push({
        id: detail.id,
        senderUserId: detail.senderUserId,
        senderName: detail.senderName,
        senderEmail: detail.senderEmail,
        body: detail.body,
        bodyFormat: detail.bodyFormat,
        sentAt: detail.sentAt,
        objects: detail.objects.map((entry) => ({ id: entry.id })),
      })
    }

    items.sort((a, b) => {
      const aTime = a.sentAt ? new Date(a.sentAt).getTime() : 0
      const bTime = b.sentAt ? new Date(b.sentAt).getTime() : 0
      return aTime - bTime
    })

    return items
  }, [detail])

  const forcedExpandedItemId = conversationItems.length > 0
    ? conversationItems[conversationItems.length - 1].id
    : null

  const [expandedById, setExpandedById] = React.useState<Record<string, boolean>>({})
  const conversationIdsKey = React.useMemo(
    () => conversationItems.map((item) => item.id).join('|'),
    [conversationItems],
  )

  React.useEffect(() => {
    const nextState: Record<string, boolean> = {}
    for (const item of conversationItems) {
      nextState[item.id] = forcedExpandedItemId === item.id
    }
    setExpandedById(nextState)
  }, [conversationIdsKey, conversationItems, forcedExpandedItemId])

  const toggleConversationItem = React.useCallback((itemId: string) => {
    if (itemId === forcedExpandedItemId) return
    setExpandedById((previous) => ({
      ...previous,
      [itemId]: !previous[itemId],
    }))
  }, [forcedExpandedItemId])

  const isConversationItemExpanded = React.useCallback((itemId: string) => {
    if (itemId === forcedExpandedItemId) return true
    return Boolean(expandedById[itemId])
  }, [expandedById, forcedExpandedItemId])

  const buildConversationListItemMessage = React.useCallback((item: ConversationItem): MessageListItemProps['message'] => ({
    id: item.id,
    type: detail?.type ?? 'default',
    typeLabel: detail ? t(detail.typeDefinition.labelKey, detail.type) : undefined,
    subject: detail?.subject ?? '',
    body: item.body,
    bodyFormat: item.bodyFormat ?? 'text',
    priority: 'normal',
    sentAt: item.sentAt ? new Date(item.sentAt) : null,
    senderName: item.senderName || item.senderEmail || item.senderUserId,
    hasObjects: (item.objects ?? []).length > 0,
    objectCount: (item.objects ?? []).length,
    hasAttachments: false,
    attachmentCount: 0,
    hasActions: false,
    actionTaken: null,
    unread: false,
  }), [detail, t])

  return {
    conversationItems,
    forcedExpandedItemId,
    toggleConversationItem,
    isConversationItemExpanded,
    buildConversationListItemMessage,
  }
}
