type OrganizationEventSource = {
  tenantId?: string | null
  organizationId?: string | null
}

/** Project a producer's verified scope without forwarding the entity or widening an incomplete pair to its tenant. */
export function organizationEventScope(source: OrganizationEventSource | null | undefined) {
  const tenantId = source?.tenantId
  const organizationId = source?.organizationId
  return typeof tenantId === 'string' && tenantId.trim() && typeof organizationId === 'string' && organizationId.trim()
    ? { tenantId, organizationId }
    : { tenantId: null, organizationId: null }
}

/** Preserve a derived event's routing only if its data belongs to the verified subscriber scope. */
export function matchingOrganizationEventScope(
  source: OrganizationEventSource,
  event: OrganizationEventSource,
) {
  const matches = source.tenantId === event.tenantId && source.organizationId === event.organizationId
  return organizationEventScope(matches ? source : null)
}
