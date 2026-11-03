import React from 'react'
import figma from '@figma/code-connect'
import { ChartLegend, ChartLegendDot } from '../src/primitives/chart-legend'

figma.connect(ChartLegend, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=2942-9934', {
  imports: ["import { ChartLegend } from '@open-mercato/ui/primitives/chart-legend'"],
  props: {
    color: figma.enum('🎨 Colors', { '🩶 Gray': 'gray', '🤍 Light Gray': 'light-gray', '💙 Blue': 'blue', '🧡 Orange': 'orange', '💔 Red': 'red', '💚 Green': 'green', '💛 Yellow': 'yellow', '💜 Purple': 'purple', '🩵 Sky': 'sky', '🩷 Pink': 'pink', '🩵 Teal': 'teal', '🚫 Disabled': 'light-gray' }),
    disabled: figma.enum('🎨 Colors', { '🚫 Disabled': true }),
    text: figma.string('✏️ Edit Text'),
  },
  example: ({ color, disabled, text }) => <ChartLegend color={color} disabled={disabled}>{text}</ChartLegend>,
})

figma.connect(ChartLegendDot, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=2942-9880', {
  imports: ["import { ChartLegendDot } from '@open-mercato/ui/primitives/chart-legend'"],
  props: {
    color: figma.enum('🎨 Colors', { '🩶 Gray': 'gray', '🤍 Light Gray': 'light-gray', '💙 Blue': 'blue', '🧡 Orange': 'orange', '💔 Red': 'red', '💚 Green': 'green', '💛 Yellow': 'yellow', '💜 Purple': 'purple', '🩵 Sky': 'sky', '🩷 Pink': 'pink', '🩵 Teal': 'teal' }),
    size: figma.enum('📏 Size', { 'Medium (20)': 20, 'Small (16)': 16 }),
  },
  example: ({ color, size }) => <ChartLegendDot color={color} size={size} />,
})
