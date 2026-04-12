import path from 'node:path'
import { createStaticModuleReader } from '../source-analysis'

const REPO_ROOT = path.resolve(__dirname, '../../../../../../')

function repoPath(...segments: string[]): string {
  return path.join(REPO_ROOT, ...segments)
}

describe('createStaticModuleReader', () => {
  it('reads source UMES exports from app module files', () => {
    const reader = createStaticModuleReader()

    const features = reader.readExport(
      repoPath('apps/mercato/src/modules/example/acl.ts'),
      ['features', 'default'],
    )
    expect(features).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'example.backend' }),
      expect.objectContaining({ id: 'example.view' }),
      expect.objectContaining({ id: 'example.todos.view' }),
    ]))

    const enrichers = reader.readExport(
      repoPath('apps/mercato/src/modules/example/data/enrichers.ts'),
      ['enrichers', 'default'],
    )
    expect(enrichers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'example.customer-todo-count',
        targetEntity: 'customers.person',
        priority: 10,
        timeout: 2000,
      }),
    ]))

    const interceptors = reader.readExport(
      repoPath('apps/mercato/src/modules/example/api/interceptors.ts'),
      ['interceptors', 'default'],
    )
    expect(interceptors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'example.customer-priority-filter',
        targetRoute: 'customers/people',
        methods: ['GET'],
        priority: 70,
      }),
    ]))

    const componentOverrides = reader.readExport(
      repoPath('apps/mercato/src/modules/example/widgets/components.ts'),
      ['componentOverrides', 'default'],
    )
    expect(componentOverrides).toEqual(expect.arrayContaining([
      expect.objectContaining({
        priority: 50,
        target: expect.objectContaining({
          componentId: 'section:ui.detail.NotesSection',
        }),
      }),
    ]))

    const injectionTable = reader.readExport(
      repoPath('apps/mercato/src/modules/example/widgets/injection-table.ts'),
      ['injectionTable', 'default'],
    )
    expect(injectionTable).toEqual(expect.objectContaining({
      'menu:sidebar:main': expect.objectContaining({
        widgetId: 'example.injection.example-menus',
        priority: 50,
      }),
      'portal:dashboard:sections': expect.arrayContaining([
        expect.objectContaining({
          widgetId: 'example.injection.portal-stats',
          priority: 5,
        }),
      ]),
    }))
  })

  it('resolves factory-built exports and imported computed keys', () => {
    const reader = createStaticModuleReader()

    const salesEnrichers = reader.readExport(
      repoPath('packages/core/src/modules/sales/data/enrichers.ts'),
      ['enrichers', 'default'],
    )
    expect(salesEnrichers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'sales.catalog-image:sales:sales_quote_line',
        targetEntity: 'sales:sales_quote_line',
        priority: 5,
        timeout: 1000,
      }),
      expect.objectContaining({
        id: 'sales.catalog-image:sales:sales_order_line',
        targetEntity: 'sales:sales_order_line',
        priority: 5,
        timeout: 1000,
      }),
    ]))

    const gatewayStripeInjectionTable = reader.readExport(
      repoPath('packages/gateway-stripe/src/modules/gateway_stripe/widgets/injection-table.ts'),
      ['injectionTable', 'default'],
    )
    expect(gatewayStripeInjectionTable).toEqual(expect.objectContaining({
      'integrations.detail:gateway_stripe': expect.arrayContaining([
        expect.objectContaining({
          widgetId: 'gateway_stripe.injection.config',
          priority: 100,
        }),
      ]),
    }))
  })

  it('preserves negative priorities in real module injection tables', () => {
    const reader = createStaticModuleReader()

    const integrationsInjectionTable = reader.readExport(
      repoPath('packages/core/src/modules/integrations/widgets/injection-table.ts'),
      ['injectionTable', 'default'],
    )

    expect(integrationsInjectionTable).toEqual(expect.objectContaining({
      'detail:*:sidebar': expect.objectContaining({
        widgetId: 'integrations.injection.external-ids',
        priority: -10,
      }),
    }))
  })
})
