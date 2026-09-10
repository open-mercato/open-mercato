export type DefinitionScopeClauseInput = {
  organizationId?: string | null
  tenantId?: string | null
}

// SQL `IN (?, NULL)` never matches rows where the column IS NULL, so a scope
// filter that mixes a concrete id with a literal null has to be expressed as an
// `$or` of equality and IS NULL. Every query that resolves the definitions
// visible to a scope — the write path, the validation path, the single-key
// lookups — routes through this builder so they cannot drift apart again (#5919).
export function createVisibleDefinitionScopeClause(scope: DefinitionScopeClauseInput) {
  const organizationId = scope.organizationId ?? null
  const tenantId = scope.tenantId ?? null

  const organizationCandidates = [{ organizationId: null as string | null }]
  if (organizationId) organizationCandidates.unshift({ organizationId })

  const tenantCandidates = [{ tenantId: null as string | null }]
  if (tenantId) tenantCandidates.unshift({ tenantId })

  return {
    $and: [
      { $or: organizationCandidates },
      { $or: tenantCandidates },
    ],
  }
}
