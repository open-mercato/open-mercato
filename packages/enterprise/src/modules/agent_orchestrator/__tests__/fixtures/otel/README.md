# OTel export fixtures

## `trace-request.golden.pb.hex`

Hex dump of one `opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest`
(one resource, one scope, one span with string/bool/int/negative-int/double/array/kvlist
attributes, one event, one link, error status) produced by the upstream OpenTelemetry JS
serializer. It is the independent reference for `otel-otlp-proto.test.ts`, which decodes it
with an in-test wire decoder and compares it with the output of `encodeOtlpTraceRequestProto`.

Provenance:

- Generated once, offline, with `ProtobufTraceSerializer.serializeRequest` from
  `@opentelemetry/otlp-transformer@0.220.0` (a transitive dependency of the workspace; it is
  not imported by the module or by the test).
- Input: a hand-built `ReadableSpan`-shaped object mirroring `goldenInput` in
  `otel-otlp-proto.test.ts` (same ids, names, attributes, timestamps as `HrTime`, status,
  resource and scope).
- The upstream serializer always writes zero `dropped_*_count` fields and the span/link
  `flags` (`fixed32`); the test treats exactly those fields as expected extras. Our encoder
  omits them (proto3 default omission, no trace flags tracked).

Regenerate only if the OTLP proto definitions change; record the new transformer version here.
