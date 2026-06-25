/**
 * Vector indexing preflight.
 *
 * The embedding provider config and the pgvector table dimension are global
 * (per-database), not per-tenant. When the configured provider is unreachable,
 * not configured, or produces a dimension that no longer matches the shared
 * vector table, every record in a reindex run fails the same way — producing a
 * storm of per-record errors and wasted embedding calls.
 *
 * This helper lets a caller decide ONCE per run whether vector work can succeed,
 * so it can skip with a single warning instead of failing every record. It is a
 * pure function: the reachability probe is injected so it stays unit-testable.
 */

export type VectorPreflightSkipCode =
  | 'provider_not_configured'
  | 'dimension_mismatch'
  | 'provider_unreachable'

export type VectorPreflightInput = {
  /** Whether the active embedding provider has its credentials/config present. */
  providerConfigured: boolean
  /** Dimension the active embedding config will produce (null when unknown). */
  effectiveDimension: number | null
  /** Dimension of the shared vector table (null when unknown/unavailable). */
  tableDimension: number | null
  /**
   * Optional reachability probe. When provided it is invoked last and MUST
   * throw if the provider cannot be reached. Omit it on hot paths (e.g.
   * single-record indexing) where the extra embedding call is not worth it.
   */
  probe?: () => Promise<unknown>
}

export type VectorPreflightResult =
  | { ok: true }
  | { ok: false; code: VectorPreflightSkipCode; reason: string }

export async function evaluateVectorPreflight(
  input: VectorPreflightInput,
): Promise<VectorPreflightResult> {
  if (!input.providerConfigured) {
    return {
      ok: false,
      code: 'provider_not_configured',
      reason:
        'embedding provider is not configured (missing API key/base URL); set the provider credentials or re-point the provider in Settings → Search',
    }
  }

  if (
    typeof input.effectiveDimension === 'number' &&
    typeof input.tableDimension === 'number' &&
    input.effectiveDimension !== input.tableDimension
  ) {
    return {
      ok: false,
      code: 'dimension_mismatch',
      reason:
        `configured provider produces ${input.effectiveDimension}-dim embeddings but the shared vector table is ${input.tableDimension}-dim; ` +
        're-point the provider in Settings → Search to recreate the table at the new dimension, then reindex',
    }
  }

  if (input.probe) {
    try {
      await input.probe()
    } catch (error) {
      return {
        ok: false,
        code: 'provider_unreachable',
        reason: `embedding provider is unreachable: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  return { ok: true }
}
