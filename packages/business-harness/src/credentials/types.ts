import type { JsonValue } from '../contracts.js';

export interface CredentialLease {
  leaseId: string;
  type: 'api-key' | 'bearer' | 'opaque';
  value: string;
  expiresAt: string;
  metadata: Record<string, JsonValue>;
}

export interface CredentialRequest {
  runId: string;
  runGrant: string;
  purpose: 'model' | 'capability';
  audience: string;
  bindingId: string;
  minimumTtlMs: number;
}

export interface CredentialResolver {
  resolve(request: CredentialRequest, signal?: AbortSignal): Promise<CredentialLease>;
}

