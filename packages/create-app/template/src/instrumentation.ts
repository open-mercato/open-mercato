import { isTelemetryBackendEnabled } from '@open-mercato/shared/lib/telemetry/runtime'
import { assertJwtSecretPolicy } from '@open-mercato/shared/lib/auth/jwt'

export async function register(): Promise<void> {
  // Refuse to serve traffic in production with a missing, placeholder, or too-short JWT signing
  // secret: those tokens are forgeable by anyone who has read the published compose files. Skipped
  // during `next build`, which has no need to sign anything and runs where secrets may be absent.
  if (process.env.NEXT_PHASE !== 'phase-production-build') {
    assertJwtSecretPolicy()
  }

  // dev warmup is handled by the dev runner splash flow.
  // Initialize telemetry (no-op unless TELEMETRY_BACKEND is set). OTEL's NodeSDK
  // is Node-only and incompatible with the edge runtime, so the telemetry
  // bootstrap — which can pull in the SDK — is imported only on the Node.js
  // runtime. The helper owns init + graceful degrade + shutdown flush.
  if (
    process.env.NEXT_RUNTIME === 'nodejs'
    && isTelemetryBackendEnabled()
  ) {
    const { registerTelemetryForNextjs } = await import('@open-mercato/telemetry/nextjs')
    await registerTelemetryForNextjs()
  }
}
