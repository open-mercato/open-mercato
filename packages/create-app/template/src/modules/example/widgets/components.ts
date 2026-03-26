import * as React from 'react'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { ComponentReplacementHandles } from '@open-mercato/shared/modules/widgets/component-registry'

const exampleCheckoutTestInjectionsEnabled = parseBooleanWithDefault(
  process.env.NEXT_PUBLIC_OM_EXAMPLE_CHECKOUT_TEST_INJECTIONS_ENABLED,
  false,
)

const alwaysEnabledComponentOverrides: ComponentOverride[] = [
  {
    target: { componentId: ComponentReplacementHandles.section('ui.detail', 'NotesSection') },
    priority: 50,
    metadata: { module: 'example' },
    wrapper: (Original) => {
      const WrappedSection = (props: unknown) =>
        React.createElement(
          'div',
          {
            className: 'rounded-md border border-dotted border-border/40 p-2',
            'data-testid': 'example-notes-wrapper',
          },
          React.createElement(Original, props as object)
        )
      WrappedSection.displayName = 'ExampleNotesSectionWrapper'
      return WrappedSection
    },
  },
]

const checkoutTestComponentOverrides: ComponentOverride[] = [
  {
    target: { componentId: ComponentReplacementHandles.section('checkout.pay-page', 'summary') },
    priority: 50,
    metadata: { module: 'example' },
    wrapper: (Original) => {
      const WrappedSection = (props: unknown) =>
        React.createElement(
          'div',
          {
            className: 'rounded-2xl border border-dashed border-blue-300 bg-blue-50/40 p-3',
            'data-testid': 'example-checkout-summary-wrapper',
          },
          React.createElement(Original, props as object)
        )
      WrappedSection.displayName = 'ExampleCheckoutSummaryWrapper'
      return WrappedSection
    },
  },
  {
    target: { componentId: ComponentReplacementHandles.section('checkout.pay-page', 'help') },
    priority: 50,
    metadata: { module: 'example' },
    wrapper: (Original) => {
      const WrappedSection = (props: unknown) =>
        React.createElement(
          'div',
          {
            className: 'rounded-2xl border border-dashed border-amber-300 bg-amber-50/40 p-3',
            'data-testid': 'example-checkout-help-wrapper',
          },
          React.createElement(Original, props as object)
        )
      WrappedSection.displayName = 'ExampleCheckoutHelpWrapper'
      return WrappedSection
    },
  },
]

export const componentOverrides: ComponentOverride[] = exampleCheckoutTestInjectionsEnabled
  ? [...alwaysEnabledComponentOverrides, ...checkoutTestComponentOverrides]
  : alwaysEnabledComponentOverrides

export default componentOverrides
