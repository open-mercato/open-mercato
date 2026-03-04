"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export default function StripeConfigWidget() {
  const [secretKey, setSecretKey] = React.useState('')
  const [publishableKey, setPublishableKey] = React.useState('')
  const [webhookSecret, setWebhookSecret] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)

  const save = React.useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      await readApiResultOrThrow('/api/integrations/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          integrationId: 'gateway_stripe',
          credentials: {
            secretKey,
            publishableKey,
            webhookSecret,
          },
        }),
      })
      setMessage('Saved')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save')
    } finally {
      setLoading(false)
    }
  }, [publishableKey, secretKey, webhookSecret])

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">Stripe credentials for this organization.</p>
      <Input value={publishableKey} onChange={(event) => setPublishableKey(event.target.value)} placeholder="Publishable key (pk_...)" />
      <Input value={secretKey} onChange={(event) => setSecretKey(event.target.value)} placeholder="Secret key (sk_...)" />
      <Input value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} placeholder="Webhook secret (whsec_...)" />
      <Button onClick={save} disabled={loading}>{loading ? 'Saving…' : 'Save Stripe settings'}</Button>
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
    </div>
  )
}
