import fs from 'node:fs'
import path from 'node:path'

describe('AppProviders import graph', () => {
  it('uses direct UI imports instead of the broad package barrel', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/components/AppProviders.tsx'), 'utf8')

    expect(source).not.toContain("from '@open-mercato/ui'")
    expect(source).toContain("@open-mercato/ui/theme/ThemeProvider")
    expect(source).toContain("@open-mercato/ui/theme/QueryProvider")
    expect(source).toContain("@open-mercato/ui/frontend/Layout")
    expect(source).toContain("@open-mercato/ui/frontend/AuthFooter")
  })

  it('keeps generated and backend registry modules behind dynamic profile imports', () => {
    const bootstrapSource = fs.readFileSync(path.join(process.cwd(), 'src/components/ClientBootstrap.tsx'), 'utf8')
    const overridesSource = fs.readFileSync(path.join(process.cwd(), 'src/components/ComponentOverridesBootstrap.tsx'), 'utf8')

    expect(bootstrapSource).not.toMatch(/^import .*\.mercato\/generated/m)
    expect(bootstrapSource).not.toMatch(/^import .*backend\/(?:injection|dashboard)/m)
    expect(overridesSource).not.toMatch(/^import .*component-overrides\.generated/m)
    expect(overridesSource).not.toMatch(/^import .*ComponentOverrideProvider/m)
    expect(bootstrapSource).toContain("import('@/.mercato/generated/messages.client.generated')")
    expect(bootstrapSource).toContain("import('@/.mercato/generated/payments.client.generated')")
    expect(overridesSource).toContain("import('@/.mercato/generated/component-overrides.generated')")
  })

  it('keeps the scoped bootstrap implementation identical in the standalone template', () => {
    for (const file of ['ClientBootstrap.tsx', 'ComponentOverridesBootstrap.tsx']) {
      const appSource = fs.readFileSync(path.join(process.cwd(), 'src/components', file), 'utf8')
      const templateSource = fs.readFileSync(
        path.join(process.cwd(), '../../packages/create-app/template/src/components', file),
        'utf8',
      )
      expect(templateSource).toBe(appSource)
    }
  })
})
