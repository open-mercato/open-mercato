import { createContainer, InjectionMode } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { listRetainedAccessLogResourceKinds } from '@open-mercato/core/modules/audit_logs/services/accessLogService'
import { register } from '../../../di'
import { XRAY_INDIVIDUALS_RESOURCE_KIND } from '../privacy'

describe('X-Ray per-person access log retention', () => {
  it('registers the per-person access log kind for core retention when the insights module registers its services', () => {
    expect(listRetainedAccessLogResourceKinds()).not.toContain(XRAY_INDIVIDUALS_RESOURCE_KIND)
    register(createContainer({ injectionMode: InjectionMode.CLASSIC }) as unknown as AppContainer)
    expect(listRetainedAccessLogResourceKinds()).toContain(XRAY_INDIVIDUALS_RESOURCE_KIND)
  })
})
