import { createResolver } from '../resolver'
import { collectUmesData } from './collector'
import { detectConflicts } from '@open-mercato/shared/lib/umes/conflict-detection'
import type { ComponentOverrideInput, InterceptorInput, GatedExtensionInput } from '@open-mercato/shared/lib/umes/conflict-detection'

export async function runUmesCheck(): Promise<void> {
  const resolver = createResolver()
  const modulesData = collectUmesData(resolver)

  const componentOverrides: ComponentOverrideInput[] = []
  const interceptors: InterceptorInput[] = []
  const gatedExtensions: GatedExtensionInput[] = []
  const declaredFeatures = new Set<string>()

  for (const moduleData of modulesData) {
    for (const feat of moduleData.declaredFeatures) {
      declaredFeatures.add(feat)
    }

    for (const ext of moduleData.extensions) {
      if (ext.type === 'component-override') {
        componentOverrides.push({
          moduleId: ext.moduleId,
          componentId: ext.target,
          priority: ext.priority,
        })
      }

      if (ext.type === 'interceptor') {
        interceptors.push({
          moduleId: ext.moduleId,
          id: ext.id,
          targetRoute: (ext.details?.targetRoute as string) ?? ext.target,
          methods: (ext.details?.methods as string[]) ?? [],
          priority: ext.priority,
        })
      }

      if (ext.features?.length) {
        gatedExtensions.push({
          moduleId: ext.moduleId,
          extensionId: ext.id,
          features: ext.features,
        })
      }
    }
  }

  console.log('Running UMES conflict detection...\n')

  const result = detectConflicts({
    componentOverrides,
    interceptors,
    gatedExtensions,
    declaredFeatures,
  })

  if (result.warnings.length === 0 && result.errors.length === 0) {
    console.log('\x1b[32mNo conflicts found.\x1b[0m')
    return
  }

  for (const warning of result.warnings) {
    console.warn(`\x1b[33m[Warning]\x1b[0m ${warning.message}`)
  }

  for (const error of result.errors) {
    console.error(`\x1b[31m[Error]\x1b[0m ${error.message}`)
  }

  console.log(`\nSummary: ${result.errors.length} error(s), ${result.warnings.length} warning(s)`)

  if (result.errors.length > 0) {
    process.exitCode = 1
  }
}
