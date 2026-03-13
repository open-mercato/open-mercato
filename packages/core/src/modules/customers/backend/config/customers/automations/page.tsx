'use client'

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import Link from 'next/link'

type AutomationExample = {
  titleKey: string
  titleFallback: string
  triggerKey: string
  triggerFallback: string
  triggerEvent: string
  actionKey: string
  actionFallback: string
}

const AUTOMATION_EXAMPLES: AutomationExample[] = [
  {
    titleKey: 'customers.config.automations.dealStageChange.title',
    titleFallback: 'Deal Stage Change \u2192 Create Task',
    triggerKey: 'customers.config.automations.dealStageChange.trigger',
    triggerFallback: 'When deal stage changes to "Proposal"',
    triggerEvent: 'customers.deal.stage.changed',
    actionKey: 'customers.config.automations.dealStageChange.action',
    actionFallback: 'Create task "Send proposal to contact"',
  },
  {
    titleKey: 'customers.config.automations.dealInactivity.title',
    titleFallback: 'Deal Inactivity Alert',
    triggerKey: 'customers.config.automations.dealInactivity.trigger',
    triggerFallback: 'When a deal has no activity for 7 days',
    triggerEvent: 'customers.deal.inactive',
    actionKey: 'customers.config.automations.dealInactivity.action',
    actionFallback: 'Send notification to deal owner',
  },
  {
    titleKey: 'customers.config.automations.dealWon.title',
    titleFallback: 'Deal Won \u2192 Congratulation',
    triggerKey: 'customers.config.automations.dealWon.trigger',
    triggerFallback: 'When a deal is marked as won',
    triggerEvent: 'customers.deal.won',
    actionKey: 'customers.config.automations.dealWon.action',
    actionFallback: 'Send notification',
  },
]

export default function CrmAutomationsPage() {
  const t = useT()

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-6 max-w-2xl">
          <FormHeader
            backHref="/backend/config/customers"
            backLabel={t('customers.config.automations.back', 'Back to CRM settings')}
            title={t('customers.config.automations.title', 'CRM Automations')}
          />

          <p className="text-sm text-muted-foreground">
            {t(
              'customers.config.automations.description',
              'Automated workflow rules triggered by CRM events. These automations run in the background when specific conditions are met, such as deal stage changes or inactivity periods.',
            )}
          </p>

          <div className="flex flex-col gap-4">
            {AUTOMATION_EXAMPLES.map((automation) => (
              <div key={automation.triggerEvent} className="rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">
                        {t(automation.titleKey, automation.titleFallback)}
                      </h3>
                      <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {t('customers.config.automations.exampleBadge', 'Example')}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                      <span>
                        <span className="font-medium text-foreground">
                          {t('customers.config.automations.triggerLabel', 'Trigger:')}
                        </span>{' '}
                        {t(automation.triggerKey, automation.triggerFallback)}{' '}
                        <code className="rounded bg-muted px-1 py-0.5 text-xs">
                          {automation.triggerEvent}
                        </code>
                      </span>
                      <span>
                        <span className="font-medium text-foreground">
                          {t('customers.config.automations.actionLabel', 'Action:')}
                        </span>{' '}
                        {t(automation.actionKey, automation.actionFallback)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-dashed p-4">
            <p className="text-sm text-muted-foreground">
              {t(
                'customers.config.automations.workflowsHint',
                'To create custom automations, use the full workflow editor where you can define triggers, conditions, and actions.',
              )}
            </p>
            <Link
              href="/backend/workflows"
              className="mt-2 inline-flex text-sm font-medium text-primary hover:underline"
            >
              {t('customers.config.automations.openWorkflows', 'Open Workflow Editor')} &rarr;
            </Link>
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
