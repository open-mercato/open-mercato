import { getCurrentOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/organizationEvents'

export function isTimelineScopeCurrent(scopeVersion: number): boolean {
  return getCurrentOrganizationScopeVersion() === scopeVersion
}

export async function runTimelineScopedWrite<TResult>(
  scopeVersion: number,
  operation: () => Promise<TResult>,
): Promise<TResult> {
  if (!isTimelineScopeCurrent(scopeVersion)) {
    throw new DOMException('[internal] The organization scope changed.', 'AbortError')
  }
  try {
    return await operation()
  } catch (error) {
    if (!isTimelineScopeCurrent(scopeVersion)) {
      throw new DOMException('[internal] The organization scope changed.', 'AbortError')
    }
    throw error
  }
}
