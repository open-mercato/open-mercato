import { buildLlmsTxt } from '../llms'
import type { ManifestEntry } from '../manifest-types'

function entry(partial: Pick<ManifestEntry, 'id' | 'title' | 'group' | 'importPath'>): ManifestEntry {
  return {
    ...partial,
    family: partial.group,
    familyLabelKey: `design_system.families.${partial.group}`,
    keywords: [],
    galleryFile: 'packages/core/src/modules/design_system/gallery/entries/x.tsx',
    variants: [{ id: 'default', title: 'Default', code: '<X />' }],
  }
}

const copy = {
  title: 'Open Mercato Design',
  summary: 'Summary line.',
  groupLabels: { foundations: 'Foundations', components: 'Components', blocks: 'Blocks', screens: 'Screens' },
}

describe('buildLlmsTxt', () => {
  const entries = [
    entry({ id: 'timeline', title: 'Timeline', group: 'blocks', importPath: '@open-mercato/ui/blocks/timeline' }),
    entry({ id: 'button', title: 'Button', group: 'components', importPath: '@open-mercato/ui/primitives/button' }),
    entry({ id: 'badge', title: 'Badge', group: 'components', importPath: '@open-mercato/ui/primitives/badge' }),
  ]

  it('renders a title, summary and one section per non-empty group', () => {
    const output = buildLlmsTxt(entries, copy)
    expect(output.startsWith('# Open Mercato Design\n\n> Summary line.\n')).toBe(true)
    expect(output).toContain('## Components')
    expect(output).toContain('## Blocks')
    expect(output).not.toContain('## Foundations')
    expect(output.endsWith('\n')).toBe(true)
  })

  it('lists entries alphabetically with links and import paths', () => {
    const output = buildLlmsTxt(entries, copy, 'https://design.example.com/')
    const badge = output.indexOf('- [Badge](https://design.example.com/components/badge/): `@open-mercato/ui/primitives/badge`')
    const button = output.indexOf('- [Button](https://design.example.com/components/button/)')
    expect(badge).toBeGreaterThan(-1)
    expect(button).toBeGreaterThan(badge)
    expect(output).toContain('- [Timeline](https://design.example.com/blocks/timeline/): `@open-mercato/ui/blocks/timeline`')
  })

  it('adds the contract file and the copy command to blocks only', () => {
    const output = buildLlmsTxt(entries, copy)
    expect(output).toContain('contract [timeline.json](/r/timeline.json), copy with `yarn mercato ui add timeline --module <moduleId>`')
    expect(output).not.toContain('mercato ui add button')
  })

  it('links a screen to its published source file instead of an import path', () => {
    const screen = {
      ...entry({ id: 'screen-record-list', title: 'Record list', group: 'screens', importPath: 'packages/core/demos/screens/record-list.tsx' }),
      sourceFile: 'packages/core/demos/screens/record-list.tsx',
    }
    const output = buildLlmsTxt([...entries, screen], copy)
    expect(output).toContain('## Screens')
    expect(output).toContain('- [Record list](/screens/screen-record-list/): source [record-list.tsx](/r/source/packages/core/demos/screens/record-list.tsx.txt)')
    expect(output).not.toContain('mercato ui add screen-record-list')
  })

  it('uses relative links without a site url', () => {
    expect(buildLlmsTxt(entries, copy)).toContain('- [Timeline](/blocks/timeline/)')
  })
})
