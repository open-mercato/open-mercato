import React from 'react'
import figma from '@figma/code-connect'
import { FieldLabel } from '../src/primitives/label'
import { KeyIconGlyph } from '../src/primitives/key-icon'
import { Input } from '../src/primitives/input'

figma.connect(FieldLabel, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=266-2814', {
  imports: ["import React from 'react'", "import { FieldLabel } from '@open-mercato/ui/primitives/label'", "import { KeyIconGlyph } from '@open-mercato/ui/primitives/key-icon'", "import { Input } from '@open-mercato/ui/primitives/input'"],
  props: {
    label: figma.string('✏️ Edit Label'),
    sublabel: figma.boolean('💬 Sublabel', { true: figma.string('✏️ Edit Sublabel'), false: undefined }),
    required: figma.boolean('🚨 Required'),
    disabled: figma.enum('📌 State', { Normal: false, Disabled: true }),
    information: figma.boolean('ℹ️ Information', { true: <KeyIconGlyph name="labelInformation" className="size-4" />, false: undefined }),
    action: figma.boolean('🌟 Button', { true: figma.children('Link Buttons [1.1]'), false: undefined }),
  },
  example: ({ label, sublabel, required, disabled, information, action }) => {
    const id = React.useId()
    return <div className="grid gap-1">
      <FieldLabel htmlFor={id} sublabel={sublabel} required={required} disabled={disabled} information={information} action={action}>{label}</FieldLabel>
      <Input id={id} disabled={disabled} aria-required={required} />
    </div>
  },
})
