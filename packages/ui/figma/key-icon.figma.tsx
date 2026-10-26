import React from 'react'
import figma from '@figma/code-connect'
import { KeyIcon } from '../src/primitives/key-icon'

figma.connect(KeyIcon, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=263-1850', {
  imports: ["import { KeyIcon } from '@open-mercato/ui/primitives/key-icon'"],
  props: {
    appearance: figma.enum('🏵️ Style', { Stroke: 'stroke', Lighter: 'lighter' }),
    color: figma.enum('🎨 Color', { '🩶 Gray': 'gray', '💙 Blue': 'blue', '🧡 Orange': 'orange', '💔 Red': 'red', '💚 Green': 'green', '💛 Yellow': 'yellow', '💜 Purple': 'purple', '🩷 Pink': 'pink', '🩵 Teal': 'teal' }),
    size: figma.enum('📏 Size', { '2X-Large (64)': 64, 'X-Large (56)': 56, 'Large (48)': 48, 'Medium (40)': 40, 'Small (32)': 32 }),
    icon: figma.instance('💠 Pick Icon'),
  },
  example: ({ appearance, color, size, icon }) => <KeyIcon appearance={appearance} color={color} size={size}>{icon}</KeyIcon>,
})
