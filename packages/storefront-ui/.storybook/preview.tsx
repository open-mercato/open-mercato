import * as React from 'react'
import type { Preview } from '@storybook/nextjs-vite'
import '@fontsource-variable/inter'
import './preview.css'
import { Toast } from '../src/primitives/toast'
import { Tooltip } from '../src/primitives/tooltip'

/**
 * Brand presets exercise the merchant surface from the spec (§2): primary family,
 * accent, surface tint, promo hue, label case and the brand radius. Everything else
 * stays fixed, which is the point: the system must look finished under any of them.
 */
export const brandPresets: Record<string, { title: string; vars: Record<string, string> }> = {
  'open-mercato': { title: 'Open Mercato (default)', vars: {} },
  ziarno: {
    title: 'Ziarno (coffee, green and sand)',
    vars: {
      '--primary': '#174233', '--primary-hover': '#0f3326', '--primary-foreground': '#f2ede0', '--ring': '#174233',
      '--background': '#f2ede0', '--card': '#ffffff', '--popover': '#ffffff', '--foreground': '#1a1714',
      '--muted-foreground': '#544f45', '--border': '#d6cfbd', '--input': '#d6cfbd',
      '--accent': '#dbf26b', '--accent-foreground': '#173326',
      '--sf-surface': '#ffffff', '--sf-surface-tint': '#e8e0cc', '--sf-primary-soft': '#295445', '--sf-sale': '#b81a1a',
    },
  },
  atelier: {
    title: 'Atelier (fashion, square, uppercase)',
    vars: { '--radius': '0', '--sf-label-case': 'uppercase', '--sf-surface': '#f2f1ee', '--sf-sale': '#b91c1c' },
  },
  motion: {
    title: 'Motion (sport, pill, blue)',
    vars: { '--radius': '1.5rem', '--primary': '#1d4ed8', '--primary-hover': '#1e40af', '--ring': '#1d4ed8', '--accent': '#dbeafe', '--sf-sale': '#16a34a' },
  },
  hearth: {
    title: 'Hearth (home, rounded, warm)',
    vars: { '--primary': '#9a3412', '--primary-hover': '#7c2d12', '--ring': '#9a3412', '--sf-surface': '#f8f4ee', '--background': '#fffdf9', '--card': '#fffdf9', '--popover': '#fffdf9' },
  },
}

const BRAND_VARS = Array.from(new Set(Object.values(brandPresets).flatMap((preset) => Object.keys(preset.vars))))

function Stage({ theme, brand, density, layout, children }: React.PropsWithChildren<{ theme: string; brand: string; density: string; layout: string }>) {
  React.useLayoutEffect(() => {
    const root = document.documentElement
    const preset = brandPresets[brand] ?? brandPresets['open-mercato']
    root.classList.toggle('dark', theme === 'dark')
    root.style.colorScheme = theme
    root.dataset.sfDensity = density
    for (const name of BRAND_VARS) root.style.removeProperty(name)
    for (const [name, value] of Object.entries(preset.vars)) root.style.setProperty(name, value)
  }, [theme, brand, density])
  return (
    <Tooltip.Provider>
      <Toast.Provider dismissLabel="Dismiss">
        <div className="sf-story" data-layout={layout}>{children}</div>
      </Toast.Provider>
    </Tooltip.Provider>
  )
}

const preview: Preview = {
  initialGlobals: { theme: 'light', brand: 'open-mercato', density: 'default' },
  globalTypes: {
    theme: { description: 'Colour scheme, applied on the document root so portals follow', toolbar: { title: 'Theme', icon: 'circlehollow', dynamicTitle: true, items: [{ value: 'light', title: 'Light' }, { value: 'dark', title: 'Dark' }] } },
    brand: { description: 'Merchant brand preset: primary, accent, surface tint, promo hue, label case, shape', toolbar: { title: 'Brand', icon: 'paintbrush', dynamicTitle: true, items: Object.entries(brandPresets).map(([value, preset]) => ({ value, title: preset.title })) } },
    density: { description: 'Grid gap and control size step', toolbar: { title: 'Density', icon: 'component', dynamicTitle: true, items: [{ value: 'compact', title: 'Compact' }, { value: 'default', title: 'Default' }, { value: 'comfortable', title: 'Comfortable' }] } },
  },
  decorators: [
    (Story, context) => (
      <Stage theme={String(context.globals.theme)} brand={String(context.globals.brand)} density={String(context.globals.density)} layout={String(context.parameters.layout ?? 'padded')}>
        <Story />
      </Stage>
    ),
  ],
  parameters: {
    layout: 'padded',
    controls: { expanded: true, matchers: { color: /(background|color)$/i } },
    options: { storySort: { order: ['Foundations', 'Primitives', 'Patterns'] } },
    docs: { toc: true },
    a11y: { test: 'todo' },
    viewport: {
      options: {
        phone: { name: 'Phone 390', styles: { width: '390px', height: '844px' } },
        tablet: { name: 'Tablet 768', styles: { width: '768px', height: '1024px' } },
        desktop: { name: 'Desktop 1440', styles: { width: '1440px', height: '900px' } },
      },
    },
  },
}

export default preview
