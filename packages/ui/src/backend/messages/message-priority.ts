import type * as React from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Minus } from 'lucide-react'

export const messagePriorities = ['low', 'normal', 'high', 'urgent'] as const

export type MessagePriority = (typeof messagePriorities)[number]

type Translator = (key: string, fallback?: string) => string

type MessagePriorityMeta = {
  labelKey: string
  fallback: string
  icon: React.ComponentType<{ className?: string }>
}

const messagePriorityMeta: Record<MessagePriority, MessagePriorityMeta> = {
  low: { labelKey: 'messages.priority.low', fallback: 'Low', icon: ArrowDown },
  normal: { labelKey: 'messages.priority.normal', fallback: 'Normal', icon: Minus },
  high: { labelKey: 'messages.priority.high', fallback: 'High', icon: ArrowUp },
  urgent: { labelKey: 'messages.priority.urgent', fallback: 'Urgent', icon: AlertTriangle },
}

export function getMessagePriorityOptions(t: Translator): Array<{
  value: MessagePriority
  label: string
  icon: React.ComponentType<{ className?: string }>
}> {
  return messagePriorities.map((value) => {
    const meta = messagePriorityMeta[value]
    return {
      value,
      label: t(meta.labelKey, meta.fallback),
      icon: meta.icon,
    }
  })
}

export function getMessagePriorityLabel(value: MessagePriority, t: Translator): string {
  const meta = messagePriorityMeta[value]
  return t(meta.labelKey, meta.fallback)
}

export function getNextMessagePriority(value: MessagePriority): MessagePriority {
  const currentIndex = messagePriorities.indexOf(value)
  const nextIndex = (currentIndex + 1) % messagePriorities.length
  return messagePriorities[nextIndex]
}

export function getPreviousMessagePriority(value: MessagePriority): MessagePriority {
  const currentIndex = messagePriorities.indexOf(value)
  const previousIndex = (currentIndex - 1 + messagePriorities.length) % messagePriorities.length
  return messagePriorities[previousIndex]
}
