import React from 'react'
import figma from '@figma/code-connect'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ContentCard } from '../src/primitives/content-card'

figma.connect(ContentCard, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=2942-9503', {
  imports: ["import React from 'react'", "import { useT } from '@open-mercato/shared/lib/i18n/context'", "import { ContentCard } from '@open-mercato/ui/primitives/content-card'"],
  props: {
    label: figma.string('✏️ Edit Label'),
    description: figma.string('✏️ Edit Description'),
    sublabel: figma.boolean('💬 Sublabel', { true: figma.string('✏️ Edit Sublabel'), false: undefined }),
    leading: figma.enum('🧩 Type', { '📂 Basic': undefined, '⬅️ Left Icon': figma.children('Key Icons [1.1]'), '👨🏻 Avatar': figma.children('Avatar [1.1]'), '💳 Card Provider': figma.instance('💳 Pick Provider'), '🎗️ Brand': figma.instance('🎗️ Pick Brand'), '🏢 Company': figma.instance('🏢 Pick Company') }),
    badge: figma.boolean('🎖️ Badge', { true: figma.children('Badge [1.1]'), false: undefined }),
  },
  example: ({ label, description, sublabel, leading, badge }) => {
    const t = useT()
    const [visible, setVisible] = React.useState(true)
    return <>{visible ? <ContentCard label={label} description={description} sublabel={sublabel} leading={leading} badge={badge} onDismiss={() => setVisible(false)} dismissLabel={t('design_system.gallery.examples.keyComponents.dismiss')} className="w-90 max-w-full" /> : null}</>
  },
})
