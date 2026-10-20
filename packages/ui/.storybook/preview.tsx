import * as React from 'react'
import type { Preview } from '@storybook/nextjs-vite'
import type { Locale } from '@open-mercato/shared/lib/i18n/config'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { FlashMessages } from '@open-mercato/ui/backend/FlashMessages'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import appEnglish from '../../../apps/mercato/src/i18n/en.json'
import galleryEnglish from '../../core/src/modules/design_system/i18n/en.json'
import appPolish from '../../../apps/mercato/src/i18n/pl.json'
import galleryPolish from '../../core/src/modules/design_system/i18n/pl.json'
import appGerman from '../../../apps/mercato/src/i18n/de.json'
import galleryGerman from '../../core/src/modules/design_system/i18n/de.json'
import appSpanish from '../../../apps/mercato/src/i18n/es.json'
import gallerySpanish from '../../core/src/modules/design_system/i18n/es.json'
import appKorean from '../../../apps/mercato/src/i18n/ko.json'
import galleryKorean from '../../core/src/modules/design_system/i18n/ko.json'
import '@fontsource-variable/inter'
import './generated/theme.css'
import './preview.css'

const localeDictionaries = {
  en: { ...appEnglish, ...galleryEnglish },
  pl: { ...appPolish, ...galleryPolish },
  de: { ...appGerman, ...galleryGerman },
  es: { ...appSpanish, ...gallerySpanish },
  ko: { ...appKorean, ...galleryKorean },
}

function PreviewBoundary({ theme, font, locale, children }: React.PropsWithChildren<{ theme: string; font: string; locale: Locale }>) {
  const [client] = React.useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }))
  React.useLayoutEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.style.colorScheme = theme
    root.dataset.storybookFont = font
  }, [theme, font])
  return <QueryClientProvider client={client}><I18nProvider locale={locale} dict={localeDictionaries[locale]}>
    <div className="om-story-surface">{children}</div><FlashMessages />
  </I18nProvider></QueryClientProvider>
}

const preview: Preview = {
  initialGlobals: { theme: 'light', font: 'application', locale: 'en' },
  globalTypes: {
    locale: { description: 'Example language', toolbar: { title: 'Language', icon: 'globe', dynamicTitle: true, items: [{ value: 'en', title: 'English' }, { value: 'pl', title: 'Polski' }, { value: 'de', title: 'Deutsch' }, { value: 'es', title: 'Español' }, { value: 'ko', title: '한국어' }] } },
    theme: { description: 'Color scheme including portaled overlays', toolbar: { title: 'Theme', icon: 'circlehollow', dynamicTitle: true, items: [{ value: 'light', title: 'Light' }, { value: 'dark', title: 'Dark' }] } },
    font: { description: 'Compare runtime typography with the Figma reference', toolbar: { title: 'Typography', icon: 'paragraph', dynamicTitle: true, items: [{ value: 'application', title: 'Application font' }, { value: 'figma', title: 'Figma reference: Inter' }] } },
  },
  decorators: [(Story, context) => <PreviewBoundary theme={String(context.globals.theme)} font={String(context.globals.font)} locale={Object.hasOwn(localeDictionaries, String(context.globals.locale)) ? context.globals.locale as Locale : 'en'}><Story /></PreviewBoundary>],
  parameters: {
    layout: 'fullscreen',
    nextjs: { appDirectory: true, navigation: { pathname: '/backend/design-system', query: {} } },
    controls: { expanded: true, matchers: { color: /(background|color)$/i, date: /Date$/i } },
    options: { storySort: { order: ['Design system', ['Components', 'Figma library', 'Start here', 'Figma comparison', 'Coverage and gaps', '*'], 'Foundations', 'Primitives', 'Backend', 'Playgrounds'] } },
    docs: { toc: true },
    a11y: { test: 'todo' },
  },
}
export default preview
