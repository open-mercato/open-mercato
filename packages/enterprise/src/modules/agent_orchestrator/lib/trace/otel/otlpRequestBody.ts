import type { OtelExportProtocol } from './exportSettings'
import { OTLP_JSON_CONTENT_TYPE, OTLP_PROTOBUF_CONTENT_TYPE } from './otlpHttpClient'
import { encodeOtlpTraceRequest, type OtlpResourceSpansInput } from './otlpJson'
import { encodeOtlpTraceRequestProto } from './otlpProto'

export type OtlpRequestBody =
  | { protocol: 'http/json'; body: string; contentType: typeof OTLP_JSON_CONTENT_TYPE; byteLength: number }
  | { protocol: 'http/protobuf'; body: Uint8Array; contentType: typeof OTLP_PROTOBUF_CONTENT_TYPE; byteLength: number }

/**
 * One OTLP trace request body for the wire protocol: OTLP/JSON text for
 * `http/json`, OTLP/protobuf bytes for `http/protobuf`, with the matching
 * content type and the uncompressed size in bytes.
 */
export function encodeOtlpRequestBody(
  input: OtlpResourceSpansInput | readonly OtlpResourceSpansInput[],
  protocol: OtelExportProtocol,
): OtlpRequestBody {
  if (protocol === 'http/protobuf') {
    const body = encodeOtlpTraceRequestProto(input)
    return { protocol, body, contentType: OTLP_PROTOBUF_CONTENT_TYPE, byteLength: body.byteLength }
  }
  const body = JSON.stringify(encodeOtlpTraceRequest(input))
  return { protocol, body, contentType: OTLP_JSON_CONTENT_TYPE, byteLength: Buffer.byteLength(body, 'utf8') }
}
