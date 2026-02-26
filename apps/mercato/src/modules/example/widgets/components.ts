import * as React from 'react'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { ComponentReplacementHandles } from '@open-mercato/shared/modules/widgets/component-registry'

export const componentOverrides: ComponentOverride[] = [
  {
    target: { componentId: ComponentReplacementHandles.section('ui.detail', 'NotesSection') },
    priority: 50,
    features: ['example.view'],
    metadata: { module: 'example' },
    wrapper: (Original) => {
      const WrappedSection = (props: unknown) => (
        <div className="rounded-md border border-dashed border-muted-foreground/40 p-2">
          <Original {...props} />
        </div>
      )
      WrappedSection.displayName = 'ExampleNotesSectionWrapper'
      return WrappedSection
    },
  },
]

export default componentOverrides
