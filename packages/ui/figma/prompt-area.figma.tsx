import React from 'react'
import figma from '@figma/code-connect'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { PromptArea } from '../src/primitives/prompt-area'

figma.connect(PromptArea, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=191226-4236', {
  imports: ["import React from 'react'", "import { useT } from '@open-mercato/shared/lib/i18n/context'", "import { PromptArea } from '@open-mercato/ui/primitives/prompt-area'"],
  variant: { '📂 Add File': 'Off', '🌠 Add Image': 'Off' },
  props: { compact: figma.enum('📱 Mobile', { Off: false, On: true }) },
  example: ({ compact }) => {
    const t = useT()
    const [value, setValue] = React.useState('')
    const [draft, setDraft] = React.useState('')
    return <div className="grid gap-3"><PromptArea compact={compact} value={value} onValueChange={setValue} onSubmit={message => { setDraft(message); setValue('') }} inputLabel={t('design_system.gallery.examples.aiProduct.prompt')} submitLabel={t('design_system.gallery.examples.aiProduct.saveDraft')} placeholder={t('design_system.gallery.examples.aiProduct.placeholder')} information={<span>{t('design_system.gallery.examples.aiProduct.premium')}</span>} />{draft ? <output>{draft}</output> : null}</div>
  },
})
