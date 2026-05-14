"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription, AlertTitle } from '../../primitives/alert'
import type { AiUiPartProps } from '../ui-part-registry'

/**
 * Default placeholder for the four Phase 3 reserved slot ids.
 *
 * Consumers that forget to register the real mutation-approval cards still
 * see a humane "Phase 3 pending" state instead of the neutral debug chip the
 * `<AiChat>` fallback uses for genuinely unknown component ids. Uses the
 * shared DS `Alert` primitive with `variant="info"` — no hardcoded colors.
 *
 * When Step 5.10 lands the real cards, app bootstrappers will call
 * `registerAiUiPart('mutation-preview-card', MutationPreviewCard)` (etc.)
 * which overwrites this placeholder. The unit tests in
 * `__tests__/ui-part-registry.test.ts` pin that replacement behavior so the
 * Phase 3 hand-off stays deterministic.
 */
export function PendingPhase3Placeholder({ componentId }: AiUiPartProps) {
  const t = useT()
  return (
    <Alert
      variant="info"
      data-ai-ui-part-pending-phase3={componentId}
    >
      <AlertTitle>
        {t(
          'ai_assistant.chat.pending_phase3.title',
          'Mutation approval card pending',
        )}
      </AlertTitle>
      <AlertDescription>
        <span>
          {t(
            'ai_assistant.chat.pending_phase3.body',
            'This interactive card will land in Phase 3 of the unified AI framework.',
          )}
        </span>
        <span className="ml-1 font-mono text-xs">{componentId}</span>
      </AlertDescription>
    </Alert>
  )
}

export default PendingPhase3Placeholder
