import { createResolver } from '../resolver'
import { collectUmesData } from './collector'

export async function runUmesInspect(moduleId: string): Promise<void> {
  const resolver = createResolver()
  const modulesData = collectUmesData(resolver)

  const moduleData = modulesData.find((m) => m.moduleId === moduleId)

  if (!moduleData) {
    const available = modulesData.map((m) => m.moduleId).join(', ')
    console.error(`Module "${moduleId}" not found. Available modules: ${available}`)
    process.exitCode = 1
    return
  }

  console.log(`\nUMES Extensions for module: ${moduleId}`)
  console.log('═'.repeat(50))

  if (moduleData.declaredFeatures.length > 0) {
    console.log(`\nDeclared Features (${moduleData.declaredFeatures.length}):`)
    for (const feat of moduleData.declaredFeatures) {
      console.log(`  - ${feat}`)
    }
  }

  const byType = new Map<string, typeof moduleData.extensions>()
  for (const ext of moduleData.extensions) {
    const list = byType.get(ext.type) ?? []
    list.push(ext)
    byType.set(ext.type, list)
  }

  const typeLabels: Record<string, string> = {
    'enricher': 'Response Enrichers',
    'interceptor': 'API Interceptors',
    'component-override': 'Component Overrides',
    'injection-widget': 'Injection Widgets',
  }

  for (const [type, label] of Object.entries(typeLabels)) {
    const extensions = byType.get(type)
    if (!extensions?.length) continue

    console.log(`\n${label} (${extensions.length}):`)
    for (const ext of extensions) {
      console.log(`  ├─ ${ext.id}`)
      console.log(`  │  target: ${ext.target}`)
      console.log(`  │  priority: ${ext.priority}`)
      if (ext.features?.length) {
        console.log(`  │  features: ${ext.features.join(', ')}`)
      }
      if (ext.details) {
        for (const [key, value] of Object.entries(ext.details)) {
          if (value !== undefined && value !== false && value !== null) {
            console.log(`  │  ${key}: ${value}`)
          }
        }
      }
    }
  }

  if (moduleData.extensions.length === 0) {
    console.log('\n  No UMES extensions found for this module.')
  }

  console.log('')
}
