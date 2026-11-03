import { asValue, createContainer, InjectionMode } from 'awilix'
import { register as registerAuthDi } from '../modules/auth/di'
import { register as registerApiKeysDi } from '../modules/api_keys/di'
import { register as registerDirectoryDi } from '../modules/directory/di'
import { register as registerAttachmentsDi } from '../modules/attachments/di'
import { register as registerNotificationsDi } from '../modules/notifications/di'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

// The request container is created with InjectionMode.CLASSIC
// (packages/shared/src/lib/di/container.ts). A registration written for proxy
// injection — asFunction((cradle: {...}) => ...) or destructured params —
// silently fails to resolve (or injects undefined) unless it declares
// `.proxy()`. Documents fails closed on a missing organizationScopeService,
// so a regression here turns into an all-403 API with green unit tests.
describe('cross-module DI seams resolve under CLASSIC injection mode', () => {
  const seamsByRegistrar: Array<{
    register: (container: AppContainer) => void
    seams: string[]
  }> = [
    { register: registerAuthDi, seams: ['authPrincipalService', 'rbacService'] },
    { register: registerApiKeysDi, seams: ['apiKeyPrincipalService'] },
    { register: registerDirectoryDi, seams: ['organizationScopeService', 'organizationHierarchyService'] },
    { register: registerAttachmentsDi, seams: ['attachmentService'] },
    { register: registerNotificationsDi, seams: ['notificationService'] },
  ]

  const buildClassicContainer = (): AppContainer => {
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      em: asValue({ fork: () => ({}) }),
      rbacService: asValue({ loadAcl: async () => ({ features: [], isSuperAdmin: false }) }),
      storageDriverFactory: asValue({}),
      moduleConfigService: asValue({}),
      eventBus: asValue({}),
      commandBus: asValue({}),
    })
    return container as unknown as AppContainer
  }

  it.each(seamsByRegistrar.flatMap(({ register, seams }) => seams.map((seam) => ({ register, seam }))))(
    'resolves $seam without throwing',
    ({ register, seam }) => {
      const container = buildClassicContainer()
      register(container)
      const resolved = (container as unknown as { resolve: (name: string) => unknown }).resolve(seam)
      expect(resolved).toBeDefined()
      expect(resolved).not.toBeNull()
    },
  )
})
