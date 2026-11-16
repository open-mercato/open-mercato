import {
  resolveSafeHostAddress as resolveSafeHostAddressShared,
  type HostLookup,
} from '@open-mercato/shared/lib/host-pinning'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

export type { HostLookup }

const INTERNAL_RESOLVED_MESSAGE =
  'Host resolves to a private or loopback address. If this is intentional, an operator must set OM_CHANNEL_IMAP_ALLOW_INTERNAL_HOSTS=true.'

const UNRESOLVABLE_MESSAGE = 'Host did not resolve to any address.'

/**
 * Resolve + pin an IMAP/SMTP host to a validated public IP at connect time.
 * See `@open-mercato/shared/lib/host-pinning` for the guard itself; this wrapper
 * only binds it to this provider's escape-hatch variable
 * (`OM_CHANNEL_IMAP_ALLOW_INTERNAL_HOSTS`) and its operator-facing wording.
 */
export async function resolveSafeHostAddress(
  host: string,
  options: { lookup?: HostLookup } = {},
): Promise<{ host: string; servername?: string }> {
  return resolveSafeHostAddressShared(host, {
    ...options,
    allowInternal: parseBooleanWithDefault(process.env.OM_CHANNEL_IMAP_ALLOW_INTERNAL_HOSTS, false),
    internalMessage: INTERNAL_RESOLVED_MESSAGE,
    unresolvableMessage: UNRESOLVABLE_MESSAGE,
  })
}
