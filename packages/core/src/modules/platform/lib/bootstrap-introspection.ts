import {
  loadIntrospectionBootstrapData,
  type IntrospectionBootstrapData,
} from '@open-mercato/shared/lib/bootstrap/dynamicLoader'
import { createBootstrap, waitForAsyncRegistration } from '@open-mercato/shared/lib/bootstrap/factory'
import { registerEventModuleConfigs } from '@open-mercato/shared/modules/events'
import { resolveBootstrapFilesForSurfaces } from '@open-mercato/shared/lib/introspection/surface-bootstrap-deps'
import type { SurfaceTier } from '@open-mercato/shared/lib/introspection/types'

export type { IntrospectionBootstrapData }

export type BootstrapForIntrospectionOptions = {
  surfaceIds?: string[]
  maxTier?: SurfaceTier
}

export async function bootstrapForIntrospection(
  appRoot?: string,
  options: BootstrapForIntrospectionOptions = {},
): Promise<IntrospectionBootstrapData> {
  const requiredFiles = [...resolveBootstrapFilesForSurfaces({
    surfaceIds: options.surfaceIds,
    maxTier: options.maxTier,
  })]

  const data = await loadIntrospectionBootstrapData(appRoot, { requiredFiles })
  const bootstrap = createBootstrap(data)
  bootstrap()

  if (data.eventModuleConfigs.length > 0) {
    registerEventModuleConfigs(data.eventModuleConfigs as Parameters<typeof registerEventModuleConfigs>[0])
  }

  if (data.messageTypes.length > 0) {
    try {
      const { registerMessageTypes } = await import('@open-mercato/core/modules/messages/lib/message-types-registry')
      registerMessageTypes(data.messageTypes as Parameters<typeof registerMessageTypes>[0], { replace: true })
    } catch {
      // optional module
    }
  }

  if (data.messageObjectTypes.length > 0) {
    try {
      const { registerMessageObjectTypes } = await import('@open-mercato/core/modules/messages/lib/message-objects-registry')
      registerMessageObjectTypes(data.messageObjectTypes as Parameters<typeof registerMessageObjectTypes>[0], { replace: true })
    } catch {
      // optional module
    }
  }

  if (data.codeWorkflows.length > 0) {
    try {
      const { registerCodeWorkflows } = await import('@open-mercato/core/modules/workflows/lib/code-registry')
      registerCodeWorkflows(data.codeWorkflows as Parameters<typeof registerCodeWorkflows>[0])
    } catch {
      // optional module
    }
  }

  data.runBootstrapRegistrations?.()
  await waitForAsyncRegistration()

  return data
}
