'use client'

import * as React from 'react'
import { ShieldOff } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '../primitives/alert'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * Banner displayed when the tenant kill switch (`loop_disabled = true`) is
 * active for the current agent. Rendered on the playground page and on
 * `<AiChat>` headers so operators are not blindsided (R11 mitigation, Phase 3
 * of spec `2026-04-28-ai-agents-agentic-loop-controls`).
 *
 * The agent still completes turns but as single-step runs. The banner is
 * informational only — operators must visit the Loop policy section of the
 * AI assistant settings to re-enable the loop.
 */
export function LoopDisabledBanner({ agentId }: { agentId?: string }) {
  const t = useT()
  return (
    <Alert
      variant="warning"
      icon={<ShieldOff aria-hidden="true" />}
      data-ai-loop-disabled-banner
      data-ai-loop-disabled-agent-id={agentId}
    >
      <AlertTitle>
        {t('ai_assistant.loop.disabledBanner.title', 'Agent loop disabled by tenant policy')}
      </AlertTitle>
      <AlertDescription>
        {t(
          'ai_assistant.loop.disabledBanner.description',
          'The agentic loop has been disabled for this agent by a tenant administrator. Each turn runs as a single model call. To re-enable the loop, update the Loop policy in AI assistant settings.',
        )}
      </AlertDescription>
    </Alert>
  )
}
