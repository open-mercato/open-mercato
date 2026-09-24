/**
 * The browser's outbound trace propagator: standard W3C plus the backup copy
 * (`x-original-traceparent`) that a load balancer will not rewrite — the mirror
 * image of `provider/otlp-provider.ts`'s `backupHeaderPropagator`.
 *
 * Injecting these headers is necessary but NOT sufficient for one end-to-end
 * trace. The server ignores every inbound trace header — standard and backup
 * alike — unless `TELEMETRY_TRUST_INBOUND_TRACE=true`, because at an HTTP
 * boundary they are caller-controlled. That flag is therefore the supported way
 * to stitch a browser span to its server span; the backup header is what
 * survives a proxy in between. Without the flag RUM still works, it just yields
 * two disconnected traces per page (the server warns about that once).
 *
 * The W3C propagator is passed in rather than imported: the web SDK is only ever
 * loaded through a dynamic `import()` inside `BrowserTelemetry.tsx`. Keeping the
 * logic here — free of any runtime OTel import — is also what lets a test drive
 * the real injector against the real server extractor.
 */
import type { TextMapPropagator, TextMapSetter } from '@opentelemetry/api'
import { BACKUP_TRACEPARENT_HEADER, BACKUP_TRACESTATE_HEADER } from '../trace-headers'

export function createBackupHeaderPropagator(
  w3c: TextMapPropagator,
  defaultTextMapSetter: TextMapSetter<Record<string, string>>,
): TextMapPropagator {
  return {
    inject(ctx, carrier, setter) {
      w3c.inject(ctx, carrier, setter)
      // Inject into a plain temp carrier so the values can be mirrored regardless
      // of the real carrier's setter shape.
      const mirror: Record<string, string> = {}
      w3c.inject(ctx, mirror, defaultTextMapSetter)
      if (mirror.traceparent) setter.set(carrier, BACKUP_TRACEPARENT_HEADER, mirror.traceparent)
      if (mirror.tracestate) setter.set(carrier, BACKUP_TRACESTATE_HEADER, mirror.tracestate)
    },
    // A browser is always the root of its own trace — nothing inbound to extract.
    extract: (ctx) => ctx,
    fields: () => [...w3c.fields(), BACKUP_TRACEPARENT_HEADER, BACKUP_TRACESTATE_HEADER],
  }
}
