import { Font } from '@react-pdf/renderer'
import InterRegular from './fonts/Inter-Regular.generated'
import InterMedium from './fonts/Inter-Medium.generated'
import InterSemiBold from './fonts/Inter-SemiBold.generated'

Font.register({
  family: 'Inter',
  fonts: [
    { src: InterRegular, fontWeight: 400 },
    { src: InterMedium, fontWeight: 500 },
    { src: InterSemiBold, fontWeight: 600 },
  ],
})

Font.registerHyphenationCallback((word) => [word])

/** Colors shared across all PDF templates. */
export const colors = {
  text: '#1B1B1B',
  muted: '#6b7280',
  border: '#e5e7eb',
  light: '#f3f4f6',
  white: '#FFFFFF',
  dark: '#0d1117',
  accent: '#1c36bf',
  lightBg: '#F5F5F3',
  // OpenMercato brand gradient stops
  green: '#B4F372',
  yellow: '#EEFB63',
  purple: '#BC9AFF',
}

/** Border widths used across all PDF templates. */
export const borders = {
  thin: 1,
  medium: 2,
}

/** Spacing scale used across all PDF templates. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
}
