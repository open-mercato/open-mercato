"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { ExternalLink } from 'lucide-react'

export default function InpostConfigWidget(props: InjectionWidgetComponentProps) {
  const t = useT()
  const integrationId = (props.context as Record<string, unknown> | undefined)?.integrationId as string | undefined
  const credentialsHref = integrationId
    ? `/backend/integrations/${integrationId}`
    : '/backend/integrations'

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">
        {t('carrier_inpost.config.help', 'Configure your InPost API token and organization ID in Integration credentials. Available services: Paczkomat lockers (standard & express) and courier delivery.')}
      </p>
      <div className="space-y-2 text-sm">
        <p className="font-medium">{t('carrier_inpost.config.requiredCredentials', 'Required credentials:')}</p>
        <ul className="list-inside list-disc space-y-1 text-muted-foreground">
          <li>{t('carrier_inpost.config.credential.apiToken', 'API Token (Bearer) — from InPost Manager → API → Tokens')}</li>
          <li>{t('carrier_inpost.config.credential.organizationId', 'Organization ID — UUID visible in the InPost Manager URL after /organizations/')}</li>
        </ul>
      </div>
      <Button asChild variant="outline" size="sm">
        <a href={credentialsHref}>
          <ExternalLink className="mr-2 h-4 w-4" />
          {t('carrier_inpost.config.action.configureCredentials', 'Configure credentials')}
        </a>
      </Button>
    </div>
  )
}
