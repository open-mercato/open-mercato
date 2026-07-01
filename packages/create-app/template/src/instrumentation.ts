export async function register(): Promise<void> {
  // dev warmup is handled by the dev runner splash flow.
  // Initialize telemetry (no-op unless TELEMETRY_BACKEND is set). OTEL's NodeSDK
  // is Node-only and incompatible with the edge runtime, so the bootstrap is
  // imported conditionally.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNode } = await import('./instrumentation.node')
    await registerNode()
  }
}
