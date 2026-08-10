/**
 * @jest-environment node
 */
import path from 'node:path'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComponentReplacementHandles } from '@open-mercato/shared/modules/widgets/component-registry'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { extractModuleExtensionFacts } from '@open-mercato/cli/lib/generators/module-extension-facts'

const FLAG_NAME = 'NEXT_PUBLIC_OM_EXAMPLE_CHECKOUT_TEST_INJECTIONS_ENABLED'
const originalFlagValue = process.env[FLAG_NAME]

const moduleRoot = path.join(__dirname, '..', '..')

const NOTES_HANDLE = ComponentReplacementHandles.section('ui.detail', 'NotesSection')
const CHECKOUT_SUMMARY_HANDLE = ComponentReplacementHandles.section('checkout.pay-page', 'summary')
const CHECKOUT_HELP_HANDLE = ComponentReplacementHandles.section('checkout.pay-page', 'help')
const SHOWCASE_HANDLE = ComponentReplacementHandles.section('example.overrides', 'showcase')

const PaySummary = (props: unknown) =>
  React.createElement('section', { 'data-testid': 'pay-summary' }, String((props as { total?: string }).total ?? ''))
PaySummary.displayName = 'PaySummary'

async function loadComponentOverridesWithFlag(flagValue?: string): Promise<ComponentOverride[]> {
  if (typeof flagValue === 'string') process.env[FLAG_NAME] = flagValue
  else delete process.env[FLAG_NAME]
  jest.resetModules()
  const mod = await import('../components')
  return mod.componentOverrides
}

function wrapperFor(overrides: ComponentOverride[], componentId: string) {
  const override = overrides.find((entry) => entry.target.componentId === componentId)
  if (!override || !('wrapper' in override)) {
    throw new Error(`[internal] no wrapper override registered for ${componentId}`)
  }
  return override.wrapper
}

function readComponentOverrideFacts() {
  const facts = extractModuleExtensionFacts({
    moduleId: 'example',
    moduleRoot,
    sourceRoot: 'src/modules/example',
    entities: [],
    events: [],
    apiRoutes: [],
    searchEntities: [],
  })
  return facts.contributions.filter((contribution) => contribution.source?.symbol === 'componentOverrides')
}

describe('example component overrides', () => {
  afterEach(() => {
    if (typeof originalFlagValue === 'string') process.env[FLAG_NAME] = originalFlagValue
    else delete process.env[FLAG_NAME]
    jest.resetModules()
  })

  it('registers every handle unconditionally, in both flag states', async () => {
    const expectedHandles = [
      NOTES_HANDLE,
      CHECKOUT_SUMMARY_HANDLE,
      CHECKOUT_HELP_HANDLE,
      SHOWCASE_HANDLE,
      SHOWCASE_HANDLE,
    ]

    const disabled = await loadComponentOverridesWithFlag(undefined)
    expect(disabled.map((override) => override.target.componentId)).toEqual(expectedHandles)

    const enabled = await loadComponentOverridesWithFlag('true')
    expect(enabled.map((override) => override.target.componentId)).toEqual(expectedHandles)
  })

  /**
   * `resolveRegisteredComponent` does `resolved = override.wrapper(resolved)`,
   * so a wrapper that returns its argument BY IDENTITY is indistinguishable from
   * no override at all. That identity — not a source-text pattern — is what lets
   * the checkout entries be declared unconditionally without changing the DOM
   * TC-CHKT-031 asserts against.
   */
  it('returns the original component untouched when the checkout demo flag is off', async () => {
    const overrides = await loadComponentOverridesWithFlag(undefined)

    for (const handle of [CHECKOUT_SUMMARY_HANDLE, CHECKOUT_HELP_HANDLE]) {
      const resolved = wrapperFor(overrides, handle)(PaySummary)
      expect(resolved).toBe(PaySummary)
      expect(renderToStaticMarkup(React.createElement(resolved, { total: '42.00' })))
        .toBe(renderToStaticMarkup(React.createElement(PaySummary, { total: '42.00' })))
    }
  })

  it('decorates with the integration-test hooks when the checkout demo flag is on', async () => {
    const overrides = await loadComponentOverridesWithFlag('true')

    const summary = wrapperFor(overrides, CHECKOUT_SUMMARY_HANDLE)(PaySummary)
    expect(summary).not.toBe(PaySummary)
    const summaryMarkup = renderToStaticMarkup(React.createElement(summary, { total: '42.00' }))
    expect(summaryMarkup).toContain('data-testid="example-checkout-summary-wrapper"')
    expect(summaryMarkup).toContain('data-testid="pay-summary"')

    const help = wrapperFor(overrides, CHECKOUT_HELP_HANDLE)(PaySummary)
    expect(renderToStaticMarkup(React.createElement(help, { total: '42.00' })))
      .toContain('data-testid="example-checkout-help-wrapper"')
  })

  /**
   * The ungated entry, and the exception `components.ts` documents. What makes it acceptable is
   * asserted rather than described: it composes, so the host's own markup survives the frame.
   * A wrapper that dropped the host would be the `replace`-on-a-foreign-handle the file forbids,
   * and this is what would catch it.
   */
  it('always decorates the always-on notes section and keeps the host rendered, in both flag states', async () => {
    for (const flagValue of [undefined, 'true']) {
      const overrides = await loadComponentOverridesWithFlag(flagValue)
      const notes = wrapperFor(overrides, NOTES_HANDLE)(PaySummary)
      expect(notes).not.toBe(PaySummary)
      const markup = renderToStaticMarkup(React.createElement(notes, { total: '42.00' }))
      expect(markup).toContain('data-testid="example-notes-wrapper"')
      expect(markup).toContain('data-testid="pay-summary"')
      expect(markup).toContain('42.00')
    }
  })

  /**
   * The rule the `replace`-mode comment states, made mechanical: a canonical reference module may
   * decorate a handle another module exposes, but it may never replace one, because replacement
   * discards the host's markup on a screen the reader did not come to look at.
   */
  it('never replaces a handle another module exposes', async () => {
    const overrides = await loadComponentOverridesWithFlag(undefined)

    for (const override of overrides) {
      if (!('replacement' in override) || !override.replacement) continue
      expect(override.target.componentId).toBe(SHOWCASE_HANDLE)
    }
  })

  /**
   * Before this slice the export was a conditionally spread array, which
   * `staticValue` could not fold, so the framework's own reader published ZERO
   * component-override contributions for the canonical module.
   */
  it('is read by the real fact extractor, with every declared mode resolved', () => {
    const facts = readComponentOverrideFacts()

    expect(facts).toHaveLength(5)
    expect(facts.map((fact) => (fact as { details: { handle: string } }).details.handle))
      .toEqual([NOTES_HANDLE, CHECKOUT_SUMMARY_HANDLE, CHECKOUT_HELP_HANDLE, SHOWCASE_HANDLE, SHOWCASE_HANDLE])
    expect(facts.map((fact) => (fact as { details: { mode: string } }).details.mode))
      .toEqual(['wrapper', 'wrapper', 'wrapper', 'replace', 'props'])
    for (const fact of facts) {
      expect(fact.kind).toBe('component-override')
    }
  })

  it('covers all three modes the ComponentOverride union defines', () => {
    const modes = new Set(
      readComponentOverrideFacts().map((fact) => (fact as { details: { mode: string } }).details.mode),
    )
    expect([...modes].sort()).toEqual(['props', 'replace', 'wrapper'])
  })
})
