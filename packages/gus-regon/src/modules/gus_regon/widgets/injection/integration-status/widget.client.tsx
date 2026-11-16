'use client'

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { useGusStatus } from '../../../components/useGusStatus'
import { describeCompanyCard, type CompanyCardState } from '../../../lib/status'

export type IntegrationDetailData = {
  state?: { isEnabled?: boolean }
  hasCredentials?: boolean
}

/**
 * Status line on Settings → Integrations → GUS REGON explaining whether the
 * "Fetch from GUS" card is shown on CRM company forms, and why not.
 */
export default function IntegrationStatusWidget({ data }: InjectionWidgetComponentProps<unknown, IntegrationDetailData>) {
  const t = useT()
  const status = useGusStatus(data)
  if (!status) return null

  const state = describeCompanyCard(status)
  const copy: Record<CompanyCardState, { title: string; body: string; status: 'success' | 'warning' | 'information' }> = {
    active: {
      status: 'success',
      title: t('gus_regon.status.active.title', 'CRM company card is on'),
      body: t('gus_regon.status.active.body', 'The "Fetch from GUS" card is shown on the company create and edit forms.'),
    },
    missing_key: {
      status: 'warning',
      title: t('gus_regon.status.missingKey.title', 'API key required'),
      body: t('gus_regon.status.missingKey.body', '"Show on CRM company forms" is on, but no API key is set — the card stays hidden until you enter one.'),
    },
    switch_off: {
      status: 'information',
      title: t('gus_regon.status.off.title', 'CRM company card is off'),
      body: status.hasApiKey
        ? t('gus_regon.status.off.body', 'Turn on "Show on CRM company forms" to add the "Fetch from GUS" card to company forms.')
        : t('gus_regon.status.offNoKey.body', 'To add the "Fetch from GUS" card to company forms, enter an API key and turn on "Show on CRM company forms".'),
    },
    integration_off: {
      status: 'information',
      title: t('gus_regon.status.integrationOff.title', 'Integration is disabled'),
      body: t('gus_regon.status.integrationOff.body', 'Enable the integration to show the "Fetch from GUS" card on company forms.'),
    },
  }
  const entry = copy[state]

  return (
    <Alert status={entry.status}>
      <AlertTitle>{entry.title}</AlertTitle>
      <AlertDescription>{entry.body}</AlertDescription>
    </Alert>
  )
}
