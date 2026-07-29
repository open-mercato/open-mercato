'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { classifyRunEventType, type RunEventTone } from '../../lib/run-event-tone'

const TONE_CLASSES: Record<RunEventTone, string> = {
  success: 'bg-status-success-bg text-status-success-text',
  error: 'bg-status-error-bg text-status-error-text',
  warning: 'bg-status-warning-bg text-status-warning-text',
  info: 'bg-status-info-bg text-status-info-text',
  neutral: 'bg-status-neutral-bg text-status-neutral-text',
}

/**
 * Class-only form, for the mobile overview which takes a class callback rather
 * than a component. Same classification, so the two never disagree.
 */
export function runEventBadgeClass(eventType: string): string {
  return TONE_CLASSES[classifyRunEventType(eventType)]
}

/**
 * The event type IS the label, so this badge is never colour-only by
 * construction — the tone only reinforces text the reader can already see.
 */
export function RunEventBadge({ eventType, className = '' }: { eventType: string; className?: string }) {
  const t = useT()
  const tone = classifyRunEventType(eventType)
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]} ${className}`}
    >
      {t(`workflows.events.types.${eventType}`, eventType)}
    </span>
  )
}
