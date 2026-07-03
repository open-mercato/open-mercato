# Step 4 — Webhook processing, health check, and config widget

## 4.1 Webhook handler

If the external service sends webhooks (most do), normalize them under `lib/webhook-handler.ts`:

```typescript
export async function verifyProviderWebhook(input: VerifyWebhookInput): Promise<WebhookEvent> {
  const { rawBody, headers, credentials } = input
  const secret = credentials.webhookSecret as string
  // Use the provider SDK for signature verification when available;
  // for manual HMAC use a timing-safe comparison. Return a normalized WebhookEvent.
  return {
    eventType: '<provider>.<entity>.<action>',
    eventId: '<provider-event-id>',
    data: parsedPayload,
    idempotencyKey: `<provider>:${eventId}`,
    timestamp: new Date(parsedPayload.created),
  }
}
```

## 4.2 Webhook worker

```typescript
// workers/webhook-processor.ts
export const metadata = {
  queue: '<provider>-webhook',
  id: '<module_id>:webhook-processor',
  concurrency: 5,  // I/O-bound
}

export default async function handle(job: QueuedJob, ctx: JobContext) {
  // 1. Parse webhook event
  // 2. Resolve credentials via the integrationCredentials service
  // 3. Process event (update local state, emit events)
  // 4. Log result via the integrationLog service
}
```

## 4.3 Webhook setup guide (admin UI)

Attach a `helpDetails` guide on the webhook-secret credential field (see `step-2-core-files.md` § 2.1),
or export a standalone guide for richer setup docs:

```typescript
// lib/webhook-guide.ts
import type { IntegrationCredentialWebhookHelp } from '@open-mercato/shared/modules/integrations'

export const webhookSetupGuide: IntegrationCredentialWebhookHelp = {
  kind: 'webhook_setup',
  title: '<Provider> Webhook Configuration',
  summary: 'Configure <Provider> to send webhook events to Open Mercato.',
  endpointPath: '/api/<hub>/webhook/<providerKey>',
  dashboardPathLabel: '<Provider> Dashboard > Developers > Webhooks',
  steps: [
    'Log in to your <Provider> dashboard',
    'Navigate to Developers > Webhooks',
    'Click "Add endpoint"',
    'Paste the webhook URL shown below',
    'Select the events you want to receive',
    'Copy the signing secret and paste it above',
  ],
  events: ['payment_intent.succeeded', 'charge.refunded'],
  localDevelopment: {
    tunnelCommand: 'npx localtunnel --port 3000',
    publicUrlExample: 'https://xxx.loca.lt/api/<hub>/webhook/<providerKey>',
    note: 'Use a tunnel for local webhook testing',
  },
}
```

## 4.4 Health check

```typescript
// lib/health.ts
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { createClient } from './client'

export function createHealthCheck(container: AppContainer) {
  return {
    async check(credentials: Record<string, unknown>): Promise<{
      healthy: boolean
      details?: Record<string, unknown>
      message?: string
    }> {
      try {
        const client = createClient(credentials)
        const result = await client.someValidationEndpoint()
        return { healthy: true, details: { accountId: result.id } }
      } catch (error) {
        return { healthy: false, message: error instanceof Error ? error.message : 'Connection failed' }
      }
    },
  }
}
```

**DI registration** (add to `di.ts`):

```typescript
import { asFunction } from 'awilix'
container.register({
  '<providerKey>HealthCheck': asFunction(createHealthCheck).singleton(),
})
```

The `service` name MUST match `integration.ts` → `healthCheck.service`. The health check MUST
validate real connectivity, not just credential format.

## 4.5 Config widget injection

Inject configuration UI into the integration detail page.

```typescript
// widgets/injection/<widget-name>/widget.ts
import type { WidgetDefinition } from '@open-mercato/shared/modules/widgets'

export const widget: WidgetDefinition = {
  id: '<module_id>:config',
  type: 'injection',
  label: '<Provider> Configuration',
  component: () => import('./widget.client'),
}
```

```typescript
// widgets/injection/<widget-name>/widget.client.tsx
'use client'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function ProviderConfigWidget({ context }: { context: Record<string, unknown> }) {
  const t = useT()
  // context contains: integrationId, credentials (masked), isEnabled, scope
  return <div>{/* provider-specific configuration UI */}</div>
}
```

```typescript
// widgets/injection-table.ts
export const widgetInjections = [
  {
    widgetId: '<module_id>:config',
    spotId: 'integrations.detail:tabs',
    position: 'append',
    metadata: { tab: { label: 'Configuration', icon: 'settings' } },
  },
]
```

**Available integration injection spots**:
- `integrations.detail:tabs` — tab on the integration detail page
- `integrations.detail:settings` — settings section
- `integrations.bundle:tabs` — tab on the bundle detail page

Proceed to `step-5-i18n-and-tests.md`.
