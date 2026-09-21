/**
 * Request init for cockpit sub-requests whose failure must DEGRADE a panel
 * rather than blank the page that hosts it.
 *
 * Without the opt-out header `apiFetch` throws a `ForbiddenError` on 403 before
 * `apiCall` can apply a `fallback` or return a result the caller can inspect —
 * so a `Promise.all` of four loads dies whole when one of them is gated on a
 * feature the operator was never granted. The header keeps the 403 as a plain
 * response (and suppresses the global forbidden toast), which is what every
 * `call.ok === false` / `status === 403` branch in the cockpit already assumes.
 *
 * Use it ONLY where a denial is an expected, survivable outcome: the caseload
 * queue's run enrichment, the overview's per-panel loads, and health probes.
 * A request the page cannot render without must keep the default behaviour.
 */
export const OPTIONAL_REQUEST_INIT: RequestInit = {
  headers: { 'x-om-forbidden-redirect': '0' },
}
