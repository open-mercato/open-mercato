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
 *
 * The refusal branch engages only when BOTH ids are present. Two shapes therefore degrade instead
 * of refusing, and both are safe:
 * - No row tenant (`rowTenantId` null) — the caller's own tenant is used, which is the strongest
 *   form of the binding: a foreign row can only ever be attempted with the caller's DEK. Both query
 *   engines force `tenant_id` into the decrypt-decision projection so a narrow `fields` list cannot
 *   silently land here, but a table without a `tenant_id` column genuinely has no row tenant.
 * - No caller tenant (`callerTenantId` null) — there is no entitlement to bind against, so the row's
 *   own tenant wins exactly as it did before this guard existed. The ORM path reaches this whenever
 *   a `find*WithDecryption` call passes no scope.
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
 * A pure opt-in to declining decryption: unset means today's behaviour, and only an explicit
 * `false` turns decryption off. It is deliberately NOT defaulted off for
 * `omitAutomaticTenantOrgScope` queries — both engines require `opts.tenantId` on every query,
 * so `resolveDecryptScope` always has a caller tenant to bind against and already refuses any
 * foreign-tenant row on those reads. Flipping the default there would only strip plaintext from
 * legitimately global rows (`tenant_id IS NULL`), which the guard correctly allows.
 *
 * Declining also disables the plaintext-sort path, so a sort on an encrypted field degrades to
 * SQL ordering over ciphertext. The engines warn once when that happens.
 */
export function resolveDecryptEnabled(opts: DecryptEnabledInput): boolean {
  return opts.decryptEncryptedFields !== false
}

const MAX_SAMPLED_TENANT_IDS = 3

export const DECRYPT_REFUSAL_LOG_MESSAGE =
  'Skipped decryption for rows whose tenant does not match the query tenant'

export const DECLINED_ENCRYPTED_SORT_LOG_MESSAGE =
  'Sorting on an encrypted field while decryption is declined; rows are ordered by ciphertext'

/**
 * Collects refused rows during one query execution so the caller can emit a single aggregated
 * warning instead of one line per row — a mis-scoped query can refuse a whole page.
 *
 * Refusals are deduplicated by row id because the plaintext-sort path decrypts an overlapping row
 * set twice (a candidate scan, then the page rows); counting both passes would overstate the
 * refusal count by up to a page. Rows recorded without an id cannot be deduplicated and are
 * counted individually.
 */
export class DecryptRefusalTally {
  private readonly refusedRowIds = new Set<string>()
  private unidentifiedCount = 0
  private readonly rowTenantIds = new Set<string>()
  private callerTenantId: string | null = null

  record(decision: Extract<DecryptScopeDecision, { decrypt: false }>, rowId?: string | null): void {
    if (rowId === undefined || rowId === null || rowId === '') this.unidentifiedCount += 1
    else this.refusedRowIds.add(String(rowId))
    this.callerTenantId = decision.callerTenantId
    if (this.rowTenantIds.size < MAX_SAMPLED_TENANT_IDS) this.rowTenantIds.add(decision.rowTenantId)
  }

  get refused(): number {
    return this.refusedRowIds.size + this.unidentifiedCount
  }

  toLogContext(entity: string): Record<string, unknown> {
    return {
      entity,
      refusedRows: this.refused,
      callerTenantId: this.callerTenantId,
      rowTenantIds: Array.from(this.rowTenantIds),
    }
  }
}
