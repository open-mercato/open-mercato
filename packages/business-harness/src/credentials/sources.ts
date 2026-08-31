import type { CredentialSource } from '../config.js';
import { HarnessError } from '../errors.js';
import type { CredentialLease } from './types.js';

export function resolveCredentialSource(source: CredentialSource, lease: CredentialLease): string {
  if (source.source === 'credential-value') return lease.value;
  const value = lease.metadata[source.key];
  if (typeof value !== 'string') {
    throw new HarnessError(
      'CREDENTIAL_EXCHANGE_FAILED',
      `Credential lease metadata does not contain string field ${source.key}`,
    );
  }
  return value;
}

export function resolveHiddenArguments(
  sources: Readonly<Record<string, CredentialSource>> | undefined,
  lease: CredentialLease,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(sources ?? {}).map(([argument, source]) => [
      argument,
      resolveCredentialSource(source, lease),
    ]),
  );
}

