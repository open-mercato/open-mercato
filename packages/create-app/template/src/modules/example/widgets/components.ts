import * as React from 'react'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { ComponentReplacementHandles } from '@open-mercato/shared/modules/widgets/component-registry'

const checkoutTestInjectionsEnabled = parseBooleanWithDefault(
  process.env.NEXT_PUBLIC_OM_EXAMPLE_CHECKOUT_TEST_INJECTIONS_ENABLED,
  false,
)

type AnyComponent = React.ComponentType<unknown>

/**
 * Builds the decorating wrapper the demo overrides use.
 *
 * Exported as a pure function so the pass-through contract below is provable by
 * calling it, instead of by grepping this file for a literal.
 */
export function decorateWithDemoFrame(
  Original: AnyComponent,
  displayName: string,
  testId: string,
  className: string,
): AnyComponent {
  const WrappedSection = (props: unknown) =>
    React.createElement(
      'div',
      { className, 'data-testid': testId },
      React.createElement(Original, props as object)
    )
  WrappedSection.displayName = displayName
  return WrappedSection
}

/**
 * Pass-through gate for demo-only overrides.
 *
 * `resolveRegisteredComponent` assigns `wrapper(resolved)` straight back into
 * the resolution chain, so returning `Original` BY IDENTITY leaves the rendered
 * tree byte-identical to having no override registered at all. That is what
 * lets the override be DECLARED unconditionally — a statically foldable array
 * literal the fact extractor can read — while the demo chrome stays opt-in.
 */
export function applyWhenEnabled(
  enabled: boolean,
  Original: AnyComponent,
  decorate: (Original: AnyComponent) => AnyComponent,
): AnyComponent {
  return enabled ? decorate(Original) : Original
}

/**
 * Example module component overrides.
 *
 * Declared as ONE array literal with no env-flag branching on purpose: the fact
 * extractor (`packages/cli/src/lib/generators/module-extension-facts.ts` →
 * `extractObjectConvention` → `staticValue`) can only fold a statically known
 * value, so an export built by a conditional spread published ZERO
 * contributions and every scaffolded app read this canonical module as
 * contributing no component override at all.
 */
export const componentOverrides: ComponentOverride[] = [
  {
    target: { componentId: ComponentReplacementHandles.section('ui.detail', 'NotesSection') },
    priority: 50,
    metadata: { module: 'example' },
    wrapper: (Original) => decorateWithDemoFrame(
      Original,
      'ExampleNotesSectionWrapper',
      'example-notes-wrapper',
      'rounded-md border border-dotted border-border/70 p-2',
    ),
  },
  {
    target: { componentId: ComponentReplacementHandles.section('checkout.pay-page', 'summary') },
    priority: 50,
    metadata: { module: 'example' },
    wrapper: (Original) => applyWhenEnabled(
      checkoutTestInjectionsEnabled,
      Original,
      (Component) => decorateWithDemoFrame(
        Component,
        'ExampleCheckoutSummaryWrapper',
        'example-checkout-summary-wrapper',
        'rounded-2xl border border-dashed border-status-info-border bg-status-info-bg p-3',
      ),
    ),
  },
  {
    target: { componentId: ComponentReplacementHandles.section('checkout.pay-page', 'help') },
    priority: 50,
    metadata: { module: 'example' },
    wrapper: (Original) => applyWhenEnabled(
      checkoutTestInjectionsEnabled,
      Original,
      (Component) => decorateWithDemoFrame(
        Component,
        'ExampleCheckoutHelpWrapper',
        'example-checkout-help-wrapper',
        'rounded-2xl border border-dashed border-status-warning-border bg-status-warning-bg p-3',
      ),
    ),
  },
]

export default componentOverrides
