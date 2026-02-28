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
          { className: 'rounded-md border border-dashed border-amber-500/80 bg-amber-50 p-2' },
          React.createElement(Original, props as object)
        )
      WrappedSection.displayName = 'ExampleNotesSectionWrapper'
      return WrappedSection
    },
  },
]

export default componentOverrides
