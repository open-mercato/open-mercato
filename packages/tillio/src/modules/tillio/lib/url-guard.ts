// SSRF guard for the user-supplied Tillio API URL. `apiUrl` comes from integration
// credentials, so before createTillioClient ever fetches it we reject non-http(s) schemes
// and hosts that are loopback / private / link-local (cloud metadata endpoints, internal
// services). This is the synchronous, construction-time check; the resolution-time half
// (DNS answers, rebinding, redirect targets) is `safeOutboundFetch` in `client.ts`.

import { assertStaticallySafeOutboundUrl } from '@open-mercato/shared/lib/url-safety'

export const TILLIO_URL_SUBJECT = 'Tillio API URL'

export function assertPublicTillioApiUrl(rawUrl: string): void {
  assertStaticallySafeOutboundUrl(rawUrl, {
    subject: TILLIO_URL_SUBJECT,
    errorFactory: (_reason, message) => new Error(`${message}.`),
  })
}
