import {
  assertSafeOutboundUrl,
  assertStaticallySafeOutboundUrl,
  parseOutboundUrl,
  type HostLookup,
  type UrlSafetyReason,
} from '@open-mercato/shared/lib/url-safety'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

export { isPrivateIpAddress } from '@open-mercato/shared/lib/network'

const SUBJECT = 'Webhook URL'

// reason: string (not UrlSafetyReason) preserves BC per BACKWARD_COMPATIBILITY.md §2
export class UnsafeWebhookUrlError extends Error {
  public readonly reason: string

  constructor(reason: string, message?: string) {
    super(message ?? `Webhook URL rejected: ${reason}`)
    this.name = 'UnsafeWebhookUrlError'
    this.reason = reason
  }
}

const webhookErrorFactory = (reason: UrlSafetyReason, message: string) =>
  new UnsafeWebhookUrlError(reason, message)

type ParsedWebhookUrl = {
  url: URL
  hostname: string
}

export function parseWebhookUrl(rawUrl: string): ParsedWebhookUrl {
  return parseOutboundUrl(rawUrl, { errorFactory: webhookErrorFactory, subject: SUBJECT })
}

export type AssertStaticWebhookUrlDeps = {
  allowPrivate?: boolean
}

export function assertStaticallySafeWebhookUrl(
  rawUrl: string,
  deps: AssertStaticWebhookUrlDeps = {},
): void {
  const allowPrivate = deps.allowPrivate ?? isAllowPrivateWebhookUrlsEnabled()
  assertStaticallySafeOutboundUrl(rawUrl, {
    errorFactory: webhookErrorFactory,
    subject: SUBJECT,
    allowPrivate,
  })
}

export function isAllowPrivateWebhookUrlsEnabled(): boolean {
  return parseBooleanWithDefault(process.env.OM_WEBHOOKS_ALLOW_PRIVATE_URLS, false)
}

export type AssertSafeWebhookDeliveryDeps = {
  lookupHost?: HostLookup
  allowPrivate?: boolean
}

export async function assertSafeWebhookDeliveryUrl(
  rawUrl: string,
  deps: AssertSafeWebhookDeliveryDeps = {},
): Promise<void> {
  const allowPrivate = deps.allowPrivate ?? isAllowPrivateWebhookUrlsEnabled()
  await assertSafeOutboundUrl(rawUrl, {
    errorFactory: webhookErrorFactory,
    subject: SUBJECT,
    allowPrivate,
    lookupHost: deps.lookupHost,
  })
}
