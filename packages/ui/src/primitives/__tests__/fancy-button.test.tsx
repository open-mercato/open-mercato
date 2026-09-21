/** @jest-environment jsdom */
import * as React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { render } from '@testing-library/react'
import { FancyButton } from '../fancy-button'

type Color = [number, number, number]
const css = fs.readFileSync(path.resolve(__dirname, '../../../../../apps/mercato/src/app/globals.css'), 'utf8')
const declarations = (selector: string) => Object.fromEntries(
  [...(css.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '').matchAll(/(--[\w-]+):\s*([^;]+);/g)]
    .map(match => [match[1], match[2].trim()]),
)
const light = declarations(':root')
const dark = { ...light, ...declarations('\\.dark') }

function color(value: string): Color {
  if (value.startsWith('#')) return [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16) / 255) as Color
  const [lightness, chroma, hue] = value.match(/[\d.]+/g)!.map(Number)
  const angle = hue * Math.PI / 180
  const axisA = chroma * Math.cos(angle)
  const axisB = chroma * Math.sin(angle)
  const long = (lightness + 0.3963377774 * axisA + 0.2158037573 * axisB) ** 3
  const medium = (lightness - 0.1055613458 * axisA - 0.0638541728 * axisB) ** 3
  const short = (lightness - 0.0894841775 * axisA - 1.291485548 * axisB) ** 3
  return [4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short, -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short, -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short]
    .map(channel => Math.max(0, Math.min(1, channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055))) as Color
}
function luminance(value: Color) {
  return value.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0)
}
function contrast(first: Color, second: Color) {
  const values = [luminance(first), luminance(second)].sort((left, right) => right - left)
  return (values[0] + 0.05) / (values[1] + 0.05)
}
function fromClass(button: HTMLElement, prefix: string, tokens: Record<string, string>) {
  const token = [...button.classList].map(name => name.startsWith(prefix) ? `--${name.slice(prefix.length)}` : '').find(name => tokens[name])
  if (!token) throw new Error('Missing semantic color class')
  return color(tokens[token])
}

it.each([['light', light], ['dark', dark]] as const)('keeps text above 4.5:1 across the entire brand gradient in %s mode', (_theme, tokens) => {
  const { getByRole } = render(<FancyButton intent="primary">Primary</FancyButton>)
  const button = getByRole('button')
  const foreground = fromClass(button, 'text-', tokens)
  const stops = [...button.style.backgroundImage.matchAll(/var\((--[\w-]+)/g)].map(match => color(tokens[match[1]]))
  expect(stops).toHaveLength(3)
  for (let segment = 0; segment < stops.length - 1; segment++) {
    for (let sample = 0; sample <= 100; sample++) {
      const background = stops[segment].map((channel, index) => channel + (stops[segment + 1][index] - channel) * sample / 100) as Color
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5)
    }
  }
})

it.each([['light', light], ['dark', dark]] as const)('keeps destructive text above 4.5:1 under its gradient in %s mode', (_theme, tokens) => {
  const { getByRole } = render(<FancyButton intent="destructive">Delete</FancyButton>)
  const button = getByRole('button')
  const foreground = fromClass(button, 'text-', tokens)
  const background = fromClass(button, 'bg-', tokens)
  const overlay = button.style.backgroundImage.match(/rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/)
  expect(overlay).not.toBeNull()
  for (let sample = 0; sample <= 100; sample++) {
    const opacity = Number(overlay![4]) * sample / 100
    const surface = background.map((channel, index) => channel * (1 - opacity) + Number(overlay![index + 1]) / 255 * opacity) as Color
    expect(contrast(foreground, surface)).toBeGreaterThanOrEqual(4.5)
  }
})
