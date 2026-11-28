import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-node'
import { redactAttributes, redactSpanName } from '../facade/redact'

export function createRedactingSpanProcessor(processor: SpanProcessor): SpanProcessor {
  return {
    onStart: (span, parentContext) => processor.onStart(span, parentContext),
    onEnding: (span) => processor.onEnding?.(span),
    onEnd(span) {
      const attributes: ReadableSpan['attributes'] = {}
      for (const [key, value] of Object.entries(span.attributes)) {
        attributes[key] = typeof value === 'string'
          ? redactAttributes({ [key]: value })[key]
          : Array.isArray(value)
            ? value.map((entry) => typeof entry === 'string'
              ? String(redactAttributes({ [key]: entry })[key])
              : entry) as typeof value
            : value
      }
      processor.onEnd({
        name: redactSpanName(span.name),
        attributes,
        spanContext: () => span.spanContext(),
        kind: span.kind,
        parentSpanContext: span.parentSpanContext,
        startTime: span.startTime,
        endTime: span.endTime,
        status: span.status,
        links: span.links,
        events: span.events,
        resource: span.resource,
        instrumentationScope: span.instrumentationScope,
        duration: span.duration,
        ended: span.ended,
        droppedAttributesCount: span.droppedAttributesCount,
        droppedEventsCount: span.droppedEventsCount,
        droppedLinksCount: span.droppedLinksCount,
      })
    },
    forceFlush: () => processor.forceFlush(),
    shutdown: () => processor.shutdown(),
  }
}
