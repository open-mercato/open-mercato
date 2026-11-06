import type { IntegrationBundle, IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'
import { OTEL_EXPORT_HEALTH_CHECK_SERVICE, OTEL_EXPORT_INTEGRATION_ID } from './lib/trace/otel/exportIntegrationIds'

export const integration: IntegrationDefinition = {
  id: OTEL_EXPORT_INTEGRATION_ID,
  title: 'Agent trace export (OTLP)',
  description: 'Send agent run traces to your organization’s own OpenTelemetry collector over OTLP/HTTP.',
  category: 'other',
  providerKey: 'otlp',
  docsUrl: 'https://opentelemetry.io/docs/specs/otlp/',
  package: '@open-mercato/enterprise',
  version: '1.0.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'Proprietary',
  tags: ['opentelemetry', 'otlp', 'observability', 'tracing', 'ai'],
  credentials: {
    fields: [
      {
        key: 'endpoint',
        label: 'OTLP traces endpoint',
        type: 'url',
        required: true,
        placeholder: 'https://collector.example.com/v1/traces',
        helpText: 'Full OTLP/HTTP traces URL. Do not put credentials in the URL; use the headers field.',
      },
      {
        key: 'headers',
        label: 'Headers',
        type: 'secret',
        required: false,
        placeholder: 'authorization=Bearer%20token,x-tenant=acme',
        helpText: 'Optional request headers in the OTLP format k=v,k2=v2 (URL-encoded values). Stored encrypted; never logged.',
      },
      {
        key: 'protocol',
        label: 'Protocol',
        type: 'select',
        required: false,
        options: [
          { value: 'http/json', label: 'OTLP/HTTP JSON' },
          { value: 'http/protobuf', label: 'OTLP/HTTP protobuf' },
        ],
        helpText: 'Wire encoding sent to the collector. Defaults to OTLP/HTTP JSON.',
      },
    ],
  },
  healthCheck: { service: OTEL_EXPORT_HEALTH_CHECK_SERVICE },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
