import React from 'react'
import figma from '@figma/code-connect'
import { Badge } from '../src/primitives/badge'

// Full source palette and physical sizes; named runtime sizes remain unchanged.
figma.connect(Badge, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=118-2324', {
  imports: ["import { Badge } from '@open-mercato/ui/primitives/badge'"],
  props: {
    tone: figma.enum('🎨 Color', { '🩶 Gray': 'neutral', '💙 Blue': 'info', '🧡 Orange': 'warning', '💔 Red': 'error', '💚 Green': 'success', '💛 Yellow': 'yellow', '💜 Purple': 'purple', '🩵 Sky': 'sky', '🩷 Pink': 'pink', '🩵 Teal': 'teal' }),
    appearance: figma.enum('🏵️ Style', { Filled: 'filled', Light: 'light', Lighter: 'lighter', Stroke: 'stroke' }),
    size: figma.enum('📏 Size', { 'Small (16)': 16, 'Medium (20)': 20 }),
    numeric: figma.enum('⏺️ Number', { Off: false, On: true }),
    dot: figma.enum('🧩 Type', { '📂 Basic': false, '• With Dot': true, '⬅️ Left Icon': false, '➡️ Right Icon': false }),
    leading: figma.enum('🧩 Type', { '📂 Basic': undefined, '• With Dot': undefined, '⬅️ Left Icon': figma.instance('💠 Pick Icon'), '➡️ Right Icon': undefined }),
    trailing: figma.enum('🧩 Type', { '📂 Basic': undefined, '• With Dot': undefined, '⬅️ Left Icon': undefined, '➡️ Right Icon': figma.instance('💠 Pick Icon') }),
    label: figma.enum('⏺️ Number', { Off: figma.string('✏️ Edit Text'), On: figma.string('✏️ Edit Number') }),
    disabled: figma.enum('🚫 Disabled', { Off: false, On: true }),
  },
  example: ({ appearance, tone, size, numeric, dot, leading, trailing, label, disabled }) => (
    <Badge appearance={appearance} tone={tone} size={size} numeric={numeric} dot={dot} disabled={disabled} leadingIcon={leading} trailingIcon={trailing}>
      {label}
    </Badge>
  ),
})
