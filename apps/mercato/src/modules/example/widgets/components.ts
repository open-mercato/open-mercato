import * as React from 'react'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { ComponentReplacementHandles } from '@open-mercato/shared/modules/widgets/component-registry'

export const componentOverrides: ComponentOverride[] = [
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

export default componentOverrides
