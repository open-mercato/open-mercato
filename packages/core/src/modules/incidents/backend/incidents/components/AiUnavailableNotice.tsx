"use client"

import * as React from 'react'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { IncidentAiUnavailableReason } from './useAiAvailability'

export function AiUnavailableNotice({ reason }: { reason: IncidentAiUnavailableReason | null }) {
  const t = useT()
  if (!reason) return null
  const message = reason === 'forbidden'
    ? t('incidents.ai.unavailable.forbidden', "AI features are hidden because you don't have the incidents AI permission.")
    : reason === 'runtime_missing'
      ? t('incidents.ai.unavailable.runtimeMissing', 'AI features are off because the AI runtime is not installed.')
      : t('incidents.ai.unavailable.noProvider', 'AI features are off because no AI provider is configured for this workspace.')
  const status = reason === 'forbidden' ? 'warning' : 'information'
  return (
    <Alert status={status} style="lighter" size="xs">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
