"use client"

import * as React from 'react'
import type { IntegrationCredentialWebhookHelp } from '@open-mercato/shared/modules/integrations/types'
import { cn } from '@open-mercato/shared/lib/utils'
import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { ChevronDown, ChevronRight, Globe, Webhook } from 'lucide-react'

export type WebhookSetupGuideProps = {
  guide: IntegrationCredentialWebhookHelp
  buttonLabel?: string
  className?: string
}

export function WebhookSetupGuide({
  guide,
  buttonLabel = 'Show details',
  className,
}: WebhookSetupGuideProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [appOrigin, setAppOrigin] = React.useState('http://localhost:3000')

  React.useEffect(() => {
    if (typeof window !== 'undefined' && window.location?.origin) {
      setAppOrigin(window.location.origin)
    }
  }, [])

  const endpointUrl = `${appOrigin}${guide.endpointPath}`

  return (
    <div className={cn('space-y-3', className)}>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto px-0 text-xs font-medium"
        onClick={() => setIsOpen((current) => !current)}
      >
        {isOpen ? <ChevronDown className="mr-1 h-3.5 w-3.5" /> : <ChevronRight className="mr-1 h-3.5 w-3.5" />}
        {isOpen ? 'Hide details' : buttonLabel}
      </Button>

      {isOpen ? (
        <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Webhook className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-semibold">{guide.title}</p>
            </div>
            <p className="text-sm text-muted-foreground">{guide.summary}</p>
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Stripe dashboard
            </p>
            <div className="rounded-md border bg-background/70 px-3 py-2 text-sm">
              {guide.dashboardPathLabel}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Setup steps
            </p>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              {guide.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Webhook endpoint URL
            </p>
            <div className="rounded-md border bg-background/70 px-3 py-2 font-mono text-xs break-all">
              {endpointUrl}
            </div>
          </div>

          {guide.events && guide.events.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Recommended events
              </p>
              <div className="flex flex-wrap gap-2">
                {guide.events.map((eventName) => (
                  <Badge key={eventName} variant="outline" className="font-mono text-[11px]">
                    {eventName}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {guide.localDevelopment ? (
            <div className="space-y-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Local development
              </p>
              {guide.localDevelopment.note ? (
                <p className="text-sm text-muted-foreground">{guide.localDevelopment.note}</p>
              ) : null}
              <div className="rounded-md border bg-background/70 px-3 py-2 font-mono text-xs">
                {guide.localDevelopment.tunnelCommand}
              </div>
              <div className="rounded-md border bg-background/70 px-3 py-2 font-mono text-xs break-all">
                {guide.localDevelopment.publicUrlExample}
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Globe className="h-3.5 w-3.5" />
            <span>Use your public application URL in Stripe, not a localhost address.</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
