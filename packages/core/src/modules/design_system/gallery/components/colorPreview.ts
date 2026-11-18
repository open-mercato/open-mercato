type Rgb = [number, number, number]

export function normalizeHex(input: string): string | null {
  const value = input.trim().replace(/^#/, '')
  if (/^[\da-f]{3}$/i.test(value)) {
    return `#${[...value].map((digit) => digit.repeat(2)).join('').toUpperCase()}`
  }
  return /^[\da-f]{6}$/i.test(value) ? `#${value.toUpperCase()}` : null
}

function channels(hex: string): Rgb {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}

function luminance(hex: string): number {
  const linear = channels(hex).map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

export function contrastRatio(first: string, second: string): number {
  const normalizedFirst = normalizeHex(first)
  const normalizedSecond = normalizeHex(second)
  if (!normalizedFirst || !normalizedSecond) return 1
  const firstLuminance = luminance(normalizedFirst)
  const secondLuminance = luminance(normalizedSecond)
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05)
}

function mix(color: string, target: string, amount: number): string {
  const targetChannels = channels(target)
  return `#${channels(color).map((channel, index) => (
    Math.round(channel + (targetChannels[index] - channel) * amount).toString(16).padStart(2, '0')
  )).join('').toUpperCase()}`
}

function readableForeground(background: string): string {
  return contrastRatio(background, '#000000') >= contrastRatio(background, '#FFFFFF') ? '#000000' : '#FFFFFF'
}

function readableAccent(color: string, surface: string): string {
  const target = readableForeground(surface)
  for (let step = 0; step <= 20; step += 1) {
    const candidate = mix(color, target, step / 20)
    if (contrastRatio(candidate, surface) >= 4.5) return candidate
  }
  return target
}

export function createAccentPalette(hex: string, surface: string) {
  const color = normalizeHex(hex) ?? '#000000'
  const normalizedSurface = normalizeHex(surface) ?? '#FFFFFF'
  const foreground = readableForeground(color)
  const hover = mix(color, foreground === '#FFFFFF' ? '#000000' : '#FFFFFF', 0.08)
  const soft = mix(normalizedSurface, color, 0.1)
  return { color, foreground, hover, soft, softForeground: readableAccent(color, soft) }
}
