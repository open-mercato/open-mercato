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
