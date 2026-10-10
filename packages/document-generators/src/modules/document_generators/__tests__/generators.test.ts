import { generatorPlugins } from '../generators'
import { TemplateRegistry } from '../lib/template-registry'

describe('document template generator', () => {
  it('emits a deterministic flat registry with bootstrap registration owned by the optional engine', () => {
    const plugin = generatorPlugins[0]
    const entriesLiteral = [plugin.configExpr('SALES', 'sales'), plugin.configExpr('CUSTOM', 'custom')].join(',\n')
    const params = { importSection: "import * as SALES from 'sales/document-generators'\nimport * as CUSTOM from 'custom/document-generators'", entriesLiteral }
    const output = plugin.buildOutput(params)
    expect(plugin.conventionFile).toBe('document-generators.ts')
    expect(plugin.id).toBe('document_generators.templates')
    expect(output).toBe(plugin.buildOutput(params))
    expect(output).toContain('...(SALES.templates as TemplateEntry[])')
    expect(output).toContain('...(CUSTOM.templates as TemplateEntry[])')
    expect(plugin.bootstrapRegistration?.buildCall('entries')).toBe('templateRegistry.register(entries)')
    expect(plugin.bootstrapRegistration?.registrationImports[0]).toContain('@open-mercato/document-generators/')
  })

  it('supports an enabled engine with no contributing modules without creating implicit templates', () => {
    const plugin = generatorPlugins[0]
    expect(plugin.buildOutput({ importSection: '', entriesLiteral: '' })).toContain('documentTemplateEntries: TemplateEntry[] = [\n\n]')
    const registry = new TemplateRegistry()
    registry.register([])
    expect(registry.listTemplates()).toEqual([])
  })
})
