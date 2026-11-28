import type { AuthContext } from '../auth/server'
import type { AppContainer } from '../di/container'
import type { Where } from './types'

export type RelationOptionAccess = (input: {
  auth: NonNullable<AuthContext>
  container: AppContainer
  tenantId: string
  organizationId: string
}) => Promise<{
  filters?: Where
  authorizeIds?: (ids: string[]) => Promise<string[]>
} | null>

export function relationOptionAccessKey(entityId: string): string {
  return `relationOptionAccess:${entityId}`
}
