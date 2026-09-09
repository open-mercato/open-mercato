import { histogram } from './meter'

/**
 * Emit the OpenTelemetry-standard HTTP server metric
 * `http.server.request.duration` (histogram, seconds) with semconv attributes.
 * `route` MUST be a low-cardinality route template, never a resolved pathname.
 */
export function recordHttpDuration(
  method: string,
  route: string,
  status: number,
  startedAt: number,
): void {
  histogram(
    'http.server.request.duration',
    (Date.now() - startedAt) / 1000,
    {
      'http.request.method': method,
      'http.route': route,
      'http.response.status_code': status,
      'error.type': status >= 500 ? String(status) : undefined,
    },
    's',
  )
}
