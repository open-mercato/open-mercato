"use client"

/**
 * Step 4.10 — Portal AiChat injection widget (client).
 *
 * Renders an "Ask AI" trigger button + sheet inside the portal profile
 * page's `portal:profile:after` injection spot. Clicking the trigger
 * opens a right-side sheet embedding `<AiChat>` wired to
 * `customers.account_assistant`.
 *
 * Feature-gating:
 *   - Declared in `widget.ts` metadata (`portal.account.manage`).
 *   - The widget ALSO self-checks `context.resolvedFeatures` as a
 *     defense-in-depth measure so the button never renders for a
 *     customer who lacks the feature (portal pages are themselves
 *     feature-gated, but the injection registry does not currently
 *     enforce metadata.features at render time).
 *
 * `pageContext` shape:
 *   { view: 'portal.profile', recordType: 'customer', recordId: <userId|null>, extra: {} }
 */

import * as React from 'react'
import { Sparkles } from 'lucide-react'
import { AiChat } from '@open-mercato/ui/ai/AiChat'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { hasFeature } from '@open-mercato/shared/security/features'

export const PORTAL_AI_INJECT_AGENT_ID = 'customers.account_assistant'
export const PORTAL_AI_INJECT_REQUIRED_FEATURE = 'portal.account.manage'

export interface PortalAiInjectPageContext {
  view: 'portal.profile'
  recordType: 'customer'
  recordId: string | null
  extra: Record<string, never>
}

interface PortalInjectionContext {
  orgSlug?: string
  user?: { id?: string | null } | null
  resolvedFeatures?: string[]
  isPortalAdmin?: boolean
}

interface PortalAiAssistantTriggerProps {
  context?: PortalInjectionContext
}

function readUserId(user: PortalInjectionContext['user']): string | null {
  if (!user) return null
  const id = user.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

export default function PortalAiAssistantTriggerWidget({ context }: PortalAiAssistantTriggerProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)

  const resolvedFeatures = Array.isArray(context?.resolvedFeatures)
    ? (context?.resolvedFeatures as string[])
    : []
  const featureAllowed =
    context?.isPortalAdmin === true ||
    hasFeature(resolvedFeatures, PORTAL_AI_INJECT_REQUIRED_FEATURE)

  const pageContext = React.useMemo<PortalAiInjectPageContext>(() => ({
    view: 'portal.profile',
    recordType: 'customer',
    recordId: readUserId(context?.user ?? null),
    extra: {},
  }), [context?.user])

  if (!featureAllowed) return null

  return (
    <div className="mt-6" data-ai-portal-inject-wrapper="">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-ai-portal-inject-trigger=""
        aria-label={t(
          'customer_accounts.portal_ai_assistant.trigger.ariaLabel',
          'Open portal AI assistant',
        )}
      >
        <Sparkles className="size-4" aria-hidden />
        <span>{t('customer_accounts.portal_ai_assistant.trigger.label', 'Ask AI')}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={cn(
            'sm:max-w-xl sm:top-0 sm:bottom-0 sm:right-0 sm:left-auto sm:translate-x-0 sm:translate-y-0',
            'sm:h-screen sm:max-h-screen sm:rounded-none sm:rounded-l-2xl',
            'flex flex-col gap-3 p-4',
          )}
          data-ai-portal-inject-sheet=""
        >
          <DialogHeader>
            <DialogTitle>
              {t('customer_accounts.portal_ai_assistant.sheet.title', 'Portal AI assistant')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'customer_accounts.portal_ai_assistant.sheet.description',
                'Read-only assistant for portal customers. Ask about your account and recent activity.',
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1" data-ai-portal-inject-chat-container="">
            <AiChat
              agent={PORTAL_AI_INJECT_AGENT_ID}
              pageContext={pageContext as unknown as Record<string, unknown>}
              className="h-full"
              placeholder={t(
                'customer_accounts.portal_ai_assistant.sheet.composerPlaceholder',
                'Ask about your account...',
              )}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
