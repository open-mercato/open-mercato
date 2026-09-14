// SSRF guard for the user-supplied Tillio API URL. `apiUrl` comes from integration
// credentials, so before createTillioClient ever fetches it we reject non-http(s) schemes
// and hosts that are loopback / private / link-local (cloud metadata endpoints, internal
// services). This is the synchronous, construction-time check; the resolution-time half
// (DNS answers, rebinding, redirect targets) is `safeOutboundFetch` in `client.ts`.

import { assertStaticallySafeOutboundUrl } from '@open-mercato/shared/lib/url-safety'

export const TILLIO_URL_SUBJECT = 'Tillio API URL'

export function assertPublicTillioApiUrl(rawUrl: string): void {
  // The shared guard decides where a request may go, not whether what it carries stays
  // confidential, so it admits plaintext http. Every Tillio request sends `X-Api-Key` and,
  // once an operator is attached, `X-Token`, so http is refused here before any of them
  // reaches the wire. No development allowance: `apiUrl` always points at Tillio's public
  // host, and tests stub the transport through `fetchImpl` instead of relaxing this.
  assertTillioTls(rawUrl)
  assertStaticallySafeOutboundUrl(rawUrl, {
    subject: TILLIO_URL_SUBJECT,
    errorFactory: (_reason, message) => new Error(`${message}.`),
  })
}

function assertTillioTls(rawUrl: string): void {
  let protocol: string
  try {
    protocol = new URL(rawUrl).protocol
  } catch {
    // Malformed input belongs to the shared guard so one parser owns that message.
    return
  }
  if (protocol !== 'http:') return
  throw new Error(`${TILLIO_URL_SUBJECT} must use https, so the API key is not sent in cleartext.`)
}
