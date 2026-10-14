/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as authFeatures } from '../../auth/acl'
import { setup } from '../setup'

const descriptors: FeatureDescriptor[] = [...authFeatures] as FeatureDescriptor[]

function grantsFor(role: string): string[] {
  return (setup.defaultRoleFeatures?.[role] ?? []) as string[]
}

describe('customers ACL default role grants', () => {
  test('admin default role includes auth.users.list for staff-absent owner pickers', () => {
    expect(grantsFor('admin')).toContain('auth.users.list')
  })

  test('employee default role includes auth.users.list for staff-absent owner pickers', () => {
    expect(grantsFor('employee')).toContain('auth.users.list')
  })

  test('default roles that grant auth.users.list resolve without missing dependencies', () => {
    for (const role of ['admin', 'employee']) {
      const diagnostics = resolveAclDependencyDiagnostics(grantsFor(role), descriptors)
      expect(diagnostics.missingDependencies).toEqual([])
    }
  })
})
