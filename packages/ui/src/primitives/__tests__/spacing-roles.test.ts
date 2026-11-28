import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '../../../../..')
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), 'utf8')

const ROLES = ['field-label', 'field-hint', 'field-stack', 'group', 'control-x', 'card', 'panel', 'dialog', 'section', 'page', 'gutter']
const STYLESHEETS = ['apps/mercato/src/app/globals.css', 'packages/create-app/template/src/app/globals.css']

function tokenBlock(css: string): string {
  return css
    .split('\n')
    .filter((line) => /--(om-space|spacing)-/.test(line) || /data-density="compact"/.test(line) || /@utility page-grid/.test(line))
    .join('\n')
}

describe('spacing roles', () => {
  it.each(STYLESHEETS)('%s defines every role as a token and a Tailwind spacing key', (stylesheet) => {
    const css = read(stylesheet)
    for (const role of ROLES) {
      expect(css).toMatch(new RegExp(`--om-space-${role}:\\s*[0-9.]+rem;`))
      expect(css).toContain(`--spacing-${role}: var(--om-space-${role});`)
    }
    expect(css).toContain('[data-density="compact"]')
    expect(css).toContain('@utility page-grid')
  })

  it('keeps the app and template stylesheets in sync', () => {
    const [app, template] = STYLESHEETS.map((stylesheet) => tokenBlock(read(stylesheet)))
    expect(template).toBe(app)
  })

  it('teaches cn() the role names so className overrides still win', () => {
    const utils = read('packages/shared/src/lib/utils.ts')
    for (const role of ROLES) expect(utils).toContain(`"${role}"`)
  })

  it('spaces form fields, cards and dialogs through the roles', () => {
    const formField = read('packages/ui/src/primitives/form-field.tsx')
    expect(formField).toContain('mb-field-label')
    expect(formField).toContain('mt-field-hint')
    expect(formField).not.toMatch(/'flex flex-col gap-1'/)

    const crudForm = read('packages/ui/src/backend/CrudForm.tsx')
    expect(crudForm).toContain('space-y-field-label')
    expect(crudForm).toContain('gap-y-field-stack')
    expect(crudForm).toContain('data-density={density}')

    expect(read('packages/ui/src/primitives/card.tsx')).toContain('py-card')
    expect(read('packages/ui/src/primitives/dialog.tsx')).toContain('p-dialog')
  })
})
