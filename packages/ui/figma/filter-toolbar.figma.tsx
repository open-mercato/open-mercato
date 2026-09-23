import React from 'react'
import figma from '@figma/code-connect'
import { Button } from '../src/primitives/button'
import { FilterPanelItem, FilterPanelHeader, FilterPanelFooter } from '../src/primitives/filter-toolbar'

figma.connect(FilterPanelItem, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=4379-1183', {
  imports: ["import { FilterPanelItem } from '@open-mercato/ui/primitives/filter-toolbar'"],
  props: {
    active: figma.enum('📌 State', { Default: false, Hover: false, Active: true }),
    leading: figma.boolean('⬅️ Left Icon', { true: figma.instance('⬅️ Pick Left'), false: undefined }),
    label: figma.string('✏️ Edit Text'),
  },
  example: ({ active, leading, label }) => <FilterPanelItem active={active} leading={leading}>{label}</FilterPanelItem>,
})

figma.connect(FilterPanelHeader, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=4379-2209', {
  imports: ["import { FilterPanelHeader } from '@open-mercato/ui/primitives/filter-toolbar'", "import { Button } from '@open-mercato/ui/primitives/button'"],
  props: {
    title: figma.string('✏️ Edit Text'),
    leading: figma.boolean('⬅️ Left Icon', { true: figma.instance('⬅️ Pick Left'), false: undefined }),
    action: figma.boolean('🔗 Link Button', { true: <Button variant="link" className="h-auto p-0 text-sm leading-5">Clear</Button>, false: undefined }),
  },
  example: ({ title, leading, action }) => <FilterPanelHeader title={title} leading={leading} action={action} />,
})

// Consumers translate labels and supply their own clear/apply handlers.
figma.connect(FilterPanelFooter, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=4415-863', {
  imports: ["import { FilterPanelFooter } from '@open-mercato/ui/primitives/filter-toolbar'", "import { Button } from '@open-mercato/ui/primitives/button'"],
  example: () => <FilterPanelFooter><Button variant="outline">Clear</Button><Button variant="primary-filled">Apply</Button></FilterPanelFooter>,
})
