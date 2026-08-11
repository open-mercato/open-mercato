import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

// Browser RUM support. The browser usually cannot reach the OTLP collector
// directly (in-cluster service, auth in front of it), so this module owns the
// same-origin proxy the browser exporter posts to. Server-side telemetry stays
// with the `@open-mercato/telemetry` facade — this module never initializes it.
export const metadata: ModuleInfo = {
  name: 'telemetry',
  title: 'Telemetry',
  version: '0.1.0',
  description:
    'Same-origin OTLP proxy for browser RUM spans (document load, fetch, user interaction), ' +
    'forwarding to the collector configured for the environment.',
  author: 'Open Mercato Team',
}
