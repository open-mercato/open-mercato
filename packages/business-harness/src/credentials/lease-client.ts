import { z } from 'zod';
import { JsonValueSchema } from '../contracts.js';
import { HarnessError } from '../errors.js';
import type { CredentialLease, CredentialRequest, CredentialResolver } from './types.js';

const LeaseResponseSchema = z
  .object({
    leaseId: z.string().min(1),
    type: z.enum(['api-key', 'bearer', 'opaque']),
    value: z.string().min(1),
    expiresAt: z.iso.datetime({ offset: true }),
    metadata: z.record(z.string(), JsonValueSchema).default({}),
  })
  .strict();

export class BrokerCredentialResolver implements CredentialResolver {
  constructor(
    private readonly endpoint: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async resolve(request: CredentialRequest, signal?: AbortSignal): Promise<CredentialLease> {
    let response: Response;
    try {
      response = await this.fetchImplementation(this.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${request.runGrant}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          protocolVersion: '1',
          runId: request.runId,
          purpose: request.purpose,
          audience: request.audience,
          bindingId: request.bindingId,
          minimumTtlMs: request.minimumTtlMs,
        }),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      throw new HarnessError('CREDENTIAL_EXCHANGE_FAILED', 'Credential broker request failed', {
        cause: error,
      });
    }

    if (!response.ok) {
      throw new HarnessError('CREDENTIAL_EXCHANGE_FAILED', 'Credential broker rejected the run grant', {
        details: { status: response.status },
      });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new HarnessError('CREDENTIAL_EXCHANGE_FAILED', 'Credential broker returned invalid JSON', {
        cause: error,
      });
    }
    const parsed = LeaseResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new HarnessError('CREDENTIAL_EXCHANGE_FAILED', 'Credential broker returned an invalid lease', {
        details: { issues: parsed.error.issues },
      });
    }
    ensureLeaseLifetime(parsed.data, request.minimumTtlMs);
    return parsed.data;
  }
}

export class EnvironmentCredentialResolver implements CredentialResolver {
  constructor(
    private readonly bindingToEnvironmentVariable: Readonly<Record<string, string>>,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async resolve(request: CredentialRequest): Promise<CredentialLease> {
    const lookupKey = `${request.audience}:${request.bindingId}`;
    const variable = this.bindingToEnvironmentVariable[lookupKey];
    const value = variable ? this.env[variable] : undefined;
    if (!variable || !value) {
      throw new HarnessError(
        'CREDENTIAL_EXCHANGE_FAILED',
        `No local environment credential is mapped for ${lookupKey}`,
      );
    }
    return {
      leaseId: `env:${lookupKey}`,
      type: 'api-key',
      value,
      expiresAt: new Date(Date.now() + Math.max(request.minimumTtlMs, 3_600_000)).toISOString(),
      metadata: {},
    };
  }
}

function ensureLeaseLifetime(lease: CredentialLease, minimumTtlMs: number): void {
  const remainingMs = new Date(lease.expiresAt).getTime() - Date.now();
  if (remainingMs < minimumTtlMs) {
    throw new HarnessError('CREDENTIAL_EXCHANGE_FAILED', 'Credential lease expires before the run deadline', {
      details: { leaseId: lease.leaseId, remainingMs, minimumTtlMs },
    });
  }
}

