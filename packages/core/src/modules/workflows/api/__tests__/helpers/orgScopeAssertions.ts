type OrgScopeAssertionArgs<TEntity> = {
  Entity: TEntity
  findAndCount: jest.Mock
  resolveScope: jest.Mock
  runHandler: () => Promise<unknown>
  tenantId: string
  extraWhere?: Record<string, unknown>
}

export async function expectListHandlerScopesToFilterIds<TEntity>(
  args: OrgScopeAssertionArgs<TEntity> & { filterIds?: string[] }
): Promise<void> {
  const filterIds = args.filterIds ?? ['org-a', 'org-b']
  args.resolveScope.mockResolvedValue({ selectedId: null, filterIds })
  args.findAndCount.mockResolvedValue([[], 0])

  await args.runHandler()

  expect(args.findAndCount).toHaveBeenCalledWith(
    args.Entity,
    expect.objectContaining({
      tenantId: args.tenantId,
      organizationId: { $in: filterIds },
      ...(args.extraWhere ?? {}),
    }),
    expect.any(Object)
  )
}

type SingleRecordScopeAssertionArgs = {
  /** Scoped lookup the handler performs (e.g. a mocked `findOneWithDecryption`). */
  findOne: jest.Mock
  runHandler: () => Promise<Response>
  tenantId: string
  organizationId: string
  recordId: string
}

/**
 * Single-record counterpart of the list assertions: a handler addressing one
 * record by id MUST carry the caller's tenant + organization into the lookup,
 * so an id belonging to another tenant resolves to nothing and the response is
 * a 404 — never a 200 and never a 403 that confirms the record exists.
 */
export async function expectMutationHandlerRejectsCrossTenantRecord(
  args: SingleRecordScopeAssertionArgs
): Promise<void> {
  args.findOne.mockResolvedValue(null)

  const response = await args.runHandler()

  expect(response.status).toBe(404)
  expect(args.findOne).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    expect.objectContaining({
      id: args.recordId,
      tenantId: args.tenantId,
      organizationId: args.organizationId,
    }),
    undefined,
    expect.objectContaining({ tenantId: args.tenantId, organizationId: args.organizationId })
  )
}

export async function expectListHandlerOmitsOrganizationForWildcardScope<TEntity>(
  args: OrgScopeAssertionArgs<TEntity>
): Promise<void> {
  args.resolveScope.mockResolvedValue({ selectedId: null, filterIds: null })
  args.findAndCount.mockResolvedValue([[], 0])

  await args.runHandler()

  const callArgs = args.findAndCount.mock.calls[0][1]
  expect(callArgs).not.toHaveProperty('organizationId')
  expect(callArgs).toMatchObject({ tenantId: args.tenantId, ...(args.extraWhere ?? {}) })
}
