"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type EmailProvider = 'smtp' | 'gmail' | 'outlook' | 'none'

export default function EmailConfigPage() {
  const t = useT()
  const [selectedProvider, setSelectedProvider] = React.useState<EmailProvider>('none')

  const providers: Array<{ id: EmailProvider; label: string; description: string }> = [
    {
      id: 'none',
      label: t('customers.email.config.providerNone', 'Disabled'),
      description: t('customers.email.config.providerNoneDesc', 'Email integration is not active.'),
    },
    {
      id: 'smtp',
      label: t('customers.email.config.providerSmtp', 'SMTP'),
      description: t('customers.email.config.providerSmtpDesc', 'Send emails via an SMTP server (e.g. Mailgun, SendGrid, SES).'),
    },
    {
      id: 'gmail',
      label: t('customers.email.config.providerGmail', 'Gmail'),
      description: t('customers.email.config.providerGmailDesc', 'Connect via Google Workspace OAuth2 for send and receive.'),
    },
    {
      id: 'outlook',
      label: t('customers.email.config.providerOutlook', 'Microsoft Outlook'),
      description: t('customers.email.config.providerOutlookDesc', 'Connect via Microsoft Graph API for send and receive.'),
    },
  ]

  return (
    <Page>
      <PageBody>
        <FormHeader
          mode="detail"
          backHref="/backend/config/customers"
          backLabel={t('customers.email.config.back', 'Back to customer settings')}
          title={t('customers.email.config.title', 'Email integration')}
          subtitle={t('customers.email.config.subtitle', 'Configure the email provider for sending and receiving deal emails.')}
        />

        <div className="mt-6 max-w-2xl space-y-6">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">
              {t('customers.email.config.providerLabel', 'Email provider')}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {providers.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    selectedProvider === provider.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/40'
                  }`}
                  onClick={() => setSelectedProvider(provider.id)}
                >
                  <div className="flex items-center gap-2">
                    <div className={`h-3 w-3 rounded-full border-2 ${
                      selectedProvider === provider.id
                        ? 'border-primary bg-primary'
                        : 'border-muted-foreground'
                    }`} />
                    <span className="text-sm font-medium text-foreground">{provider.label}</span>
                  </div>
                  <p className="mt-1 pl-5 text-xs text-muted-foreground">{provider.description}</p>
                </button>
              ))}
            </div>
          </div>

          {selectedProvider === 'smtp' ? (
            <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
              <h4 className="text-sm font-semibold text-foreground">
                {t('customers.email.config.smtpTitle', 'SMTP settings')}
              </h4>
              <p className="text-xs text-muted-foreground">
                {t('customers.email.config.smtpNote', 'SMTP configuration is managed via environment variables. Set OM_SMTP_HOST, OM_SMTP_PORT, OM_SMTP_USER, and OM_SMTP_PASS in your environment.')}
              </p>
              <div className="grid gap-2 text-sm">
                <div className="flex items-center justify-between rounded border border-border bg-background px-3 py-2">
                  <span className="text-muted-foreground">{t('customers.email.config.smtpHost', 'Host')}</span>
                  <span className="font-mono text-xs text-foreground">OM_SMTP_HOST</span>
                </div>
                <div className="flex items-center justify-between rounded border border-border bg-background px-3 py-2">
                  <span className="text-muted-foreground">{t('customers.email.config.smtpPort', 'Port')}</span>
                  <span className="font-mono text-xs text-foreground">OM_SMTP_PORT</span>
                </div>
                <div className="flex items-center justify-between rounded border border-border bg-background px-3 py-2">
                  <span className="text-muted-foreground">{t('customers.email.config.smtpUser', 'Username')}</span>
                  <span className="font-mono text-xs text-foreground">OM_SMTP_USER</span>
                </div>
              </div>
            </div>
          ) : null}

          {selectedProvider === 'gmail' || selectedProvider === 'outlook' ? (
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <p className="text-sm text-muted-foreground">
                {t('customers.email.config.oauthNote', 'OAuth-based providers require API credentials configured in the integrations module. Visit the Integrations page to connect your account.')}
              </p>
              <Button variant="outline" size="sm" className="mt-3" asChild>
                <a href="/backend/integrations">
                  {t('customers.email.config.goToIntegrations', 'Go to Integrations')}
                </a>
              </Button>
            </div>
          ) : null}

          <div className="flex items-center gap-3 pt-2">
            <Button disabled>
              {t('customers.email.config.testConnection', 'Test connection')}
            </Button>
            <span className="text-xs text-muted-foreground">
              {t('customers.email.config.testNote', 'Tests the configured email provider connection.')}
            </span>
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
