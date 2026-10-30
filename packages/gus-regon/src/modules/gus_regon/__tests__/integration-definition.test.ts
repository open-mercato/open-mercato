import { integration, integrations, bundles, bundle, gusRegonDetailWidgetSpotId } from '../integration'
import { register } from '../di'
import { gusRegonHealthCheck } from '../lib/health'
import { metadata } from '../index'

describe('gus_regon integration definition', () => {
  it('declares a standalone integration with a detail widget spot and a health check', () => {
    expect(integrations).toEqual([integration])
    expect(bundles).toEqual([])
    expect(bundle).toBeUndefined()
    expect(integration).toMatchObject({
      id: 'gus_regon',
      providerKey: 'gus_regon',
      package: '@open-mercato/gus-regon',
      detailPage: { widgetSpotId: gusRegonDetailWidgetSpotId },
      healthCheck: { service: 'gusRegonHealthCheck' },
    })
    expect(metadata.requires).toEqual(['integrations'])
  })

  it('declares credential fields with expected keys, types and required flags', () => {
    const fields = integration.credentials?.fields.map((field) => [field.key, field.type, field.required ?? false])
    expect(fields).toEqual([
      ['environment', 'select', true],
      ['apiKey', 'secret', false],
      ['showOnCompanyForms', 'boolean', false],
    ])
    const environment = integration.credentials?.fields.find((field) => field.key === 'environment')
    expect(environment && 'options' in environment ? environment.options.map((option) => option.value) : []).toEqual([
      'test',
      'production',
    ])
  })
})

describe('gus_regon DI registration', () => {
  it('registers the health check service named by the integration', () => {
    const registered: Record<string, unknown> = {}
    register({
      register: (entries: Record<string, { resolve: () => unknown }>) => {
        for (const [key, value] of Object.entries(entries)) registered[key] = value.resolve()
      },
    } as never)
    expect(registered).toEqual({ gusRegonHealthCheck })
  })
})
