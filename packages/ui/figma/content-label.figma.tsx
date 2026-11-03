import React from 'react'
import figma from '@figma/code-connect'
import { ContentLabel } from '../src/primitives/content-label'

figma.connect(ContentLabel, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=2945-5539', {
  imports: ["import React from 'react'", "import { ContentLabel } from '@open-mercato/ui/primitives/content-label'"],
  props: {
    label: figma.string('✏️ Edit Label'),
    description: figma.string('✏️ Edit Description'),
    sublabel: figma.boolean('💬 Sublabel', { true: figma.string('✏️ Edit Sublabel'), false: undefined }),
    size: figma.enum('📏 Size', { 'Medium (40)': 40, 'Large (48)': 48 }),
    leading: figma.enum('🧩 Type', { '📂 Basic': undefined, '⬅️ Left Icon': figma.children('Key Icons [1.1]'), '👨🏻 Avatar': figma.children('Avatar [1.1]'), '🎗️ Brand': figma.instance('🎗️ Pick Brand'), '🏢 Company': figma.instance('🏢 Pick Company') }),
    badge: figma.boolean('🎖️ Badge', { true: figma.children('Badge [1.1]'), false: undefined }),
    toggle: figma.boolean('🔀 Toggle', { true: figma.children('Switch [1.1]'), false: undefined }),
  },
  example: ({ label, description, sublabel, size, leading, badge, toggle }) => {
    return <ContentLabel label={label} description={description} sublabel={sublabel} size={size} leading={leading} badge={badge} trailing={toggle} />
  },
})
