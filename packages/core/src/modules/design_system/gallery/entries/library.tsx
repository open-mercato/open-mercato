import * as React from 'react'
import { SourceLibrary } from '../components/SourceLibrary'
import type { GalleryEntry } from '../types'

export const entries: GalleryEntry[] = [{
  id: 'source-library',
  title: 'Complete source library',
  importPath: '@open-mercato/core/modules/design_system/gallery/components/SourceLibrary',
  descriptionKey: 'design_system.gallery.sourceLibrary.boundary',
  variants: [{
    id: 'inventory',
    title: 'All source pages, component sets and variant axes',
    render: () => <SourceLibrary />,
    code: `import { SourceLibrary } from '@open-mercato/core/modules/design_system/gallery/components/SourceLibrary'\n\n<SourceLibrary />`,
  }],
}]
