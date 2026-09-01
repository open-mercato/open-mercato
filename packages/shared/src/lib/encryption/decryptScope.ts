export type DecryptScopeDecision =
  | { decrypt: true; tenantId: string | null; organizationId: string | null }
  | { decrypt: false; reason: 'tenant-mismatch'; rowTenantId: string; callerTenantId: string }

export type DecryptScopeInput = {
  rowTenantId?: string | null
  rowOrganizationId?: string | null
  callerTenantId?: string | null
  callerOrganizationId?: string | null
}

/**
 * Decides whether a row may be decrypted, and with which scope.
 *
 * Decryption keys off the row's own `tenant_id` by design: a genuinely cross-tenant read
 * passes no caller tenant, so the row is the only available key id. That precedence becomes
 * dangerous when the caller DID assert a tenant and the row contradicts it — the engine would
 * fetch the foreign tenant's DEK and hand back its plaintext, amplifying a scoping bug instead
 * of containing it. In that state the row is refused: callers return it untouched (ciphertext).
 *
 * Organization is deliberately NOT compared. Organizations inside a tenant share the tenant DEK,
 * so an org mismatch does not change which key is used, and comparing it would break legitimate
 * multi-org reads for no key-scope benefit.
 */
export function resolveDecryptScope(input: DecryptScopeInput): DecryptScopeDecision {
  const rowTenantId = input.rowTenantId ?? null
  const callerTenantId = input.callerTenantId ?? null
  if (rowTenantId && callerTenantId && rowTenantId !== callerTenantId) {
    return { decrypt: false, reason: 'tenant-mismatch', rowTenantId, callerTenantId }
  }
  return {
    decrypt: true,
    tenantId: rowTenantId ?? callerTenantId,
    organizationId: input.rowOrganizationId ?? input.callerOrganizationId ?? null,
  }
}

export type DecryptEnabledInput = {
  decryptEncryptedFields?: boolean
}

/**
 * Resolves whether a query decrypts its encrypted fields at all.
 *
 * Pure opt-out: unset means today's behaviour. It is deliberately NOT defaulted off for
 * `omitAutomaticTenantOrgScope` queries — both engines require `opts.tenantId` on every query,
 * so `resolveDecryptScope` always has a caller tenant to bind against and already refuses any
 * foreign-tenant row on those reads. Flipping the default there would only strip plaintext from
 * legitimately global rows (`tenant_id IS NULL`), which the guard correctly allows.
 */
export function resolveDecryptEnabled(opts: DecryptEnabledInput): boolean {
  return opts.decryptEncryptedFields !== false
}

const MAX_SAMPLED_TENANT_IDS = 3

export const DECRYPT_REFUSAL_LOG_MESSAGE =
  'Skipped decryption for rows whose tenant does not match the query tenant'

/**
 * Collects refused rows during one query execution so the caller can emit a single aggregated
 * warning instead of one line per row — a mis-scoped query can refuse a whole page.
 */
export class DecryptRefusalTally {
  private count = 0
  private readonly rowTenantIds = new Set<string>()
  private callerTenantId: string | null = null

  record(decision: Extract<DecryptScopeDecision, { decrypt: false }>): void {
    this.count += 1
    this.callerTenantId = decision.callerTenantId
    if (this.rowTenantIds.size < MAX_SAMPLED_TENANT_IDS) this.rowTenantIds.add(decision.rowTenantId)
  }

  get refused(): number {
    return this.count
  }

  toLogContext(entity: string): Record<string, unknown> {
    return {
      entity,
      refusedRows: this.count,
      callerTenantId: this.callerTenantId,
      rowTenantIds: Array.from(this.rowTenantIds),
    }
  }
}
