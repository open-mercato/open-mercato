import type { ReactElement } from 'react'
import { DraftWatermark } from '../components/DraftWatermark'
import { documentTheme } from '../theme'

jest.mock('@react-pdf/renderer', () => ({
  StyleSheet: { create: <T,>(styles: T) => styles },
  View: 'VIEW',
  Text: 'TEXT',
}))

type ElementProps = { fixed?: boolean; style?: Record<string, unknown>; children?: ReactElement<ElementProps> | string }

describe('DraftWatermark', () => {
  it('renders the translated label on a fixed full-page layer in the theme watermark color', () => {
    const layer = DraftWatermark({ label: 'WERSJA ROBOCZA' }) as ReactElement<ElementProps>
    expect(layer.type).toBe('VIEW')
    expect(layer.props.fixed).toBe(true)
    expect(layer.props.style).toMatchObject({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 })
    const text = layer.props.children as ReactElement<ElementProps>
    expect(text.type).toBe('TEXT')
    expect(text.props.children).toBe('WERSJA ROBOCZA')
    expect(text.props.style).toMatchObject({ color: documentTheme.colors.watermark })
    expect(text.props.style).not.toHaveProperty('fontFamily')
  })
})
