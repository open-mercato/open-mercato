import path from 'node:path'
import { extractAllModuleFacts } from '../module-facts'
import { discoverPackageModuleSources } from '../module-facts-discovery'
import { createResolver } from '../../resolver'

const repo = path.resolve(__dirname, '../../../../../..')

describe('probe facts', () => {
  it('dumps guard/interceptor/enricher/component detail', () => {
    const sources = discoverPackageModuleSources(createResolver(repo))
    const { factsByModule } = extractAllModuleFacts({ sources })
    const rows: string[] = []
    for (const [moduleId, facts] of Object.entries(factsByModule)) {
      for (const c of facts.extensionSurfaces?.contributions ?? []) {
        if (['mutation-guard', 'api-interceptor', 'command-interceptor', 'response-enricher', 'component-override'].includes(c.kind)) {
          rows.push(`${moduleId}|${c.kind}|${c.id}|${JSON.stringify((c as any).details)}|phases=${JSON.stringify((c as any).phases)}`)
        }
      }
    }
    rows.sort()
    console.log('ROWS_COUNT', rows.length)
    console.log(rows.join('\n'))
  })
})
