import * as React from 'react'
import {
  Palette,
  Shapes,
  MousePointerClick,
  TextCursorInput,
  CalendarDays,
  BellRing,
  Layers,
  Compass,
  Table2,
  BarChart3,
  Filter,
  PanelsTopLeft,
  LayoutTemplate,
  Megaphone,
  Bell,
  CalendarClock,
  Mail,
} from 'lucide-react'
import type { GalleryFamily } from './types'

const familyIcon = (Icon: typeof Palette) => React.createElement(Icon, { className: 'size-4', 'aria-hidden': true })

/** The DS Figma file id — every `figmaNodeId` in gallery entries points into this file. */
export const DS_FIGMA_FILE = 'qCq9z6q1if0mpoRstV5OEA'

/** Base of the deep links into the monorepo DS docs (`.ai/ui-components.md`). */
export const DS_DOCS_URL = 'https://github.com/open-mercato/open-mercato/blob/main/.ai/ui-components.md'

/** Route of the gallery backend page; used for section-nav hrefs and deep links. */
export const GALLERY_BASE_PATH = '/backend/design-system'

/** Builds a Figma deep link for a `nodeId` in `<page>:<node>` format. */
export function figmaNodeUrl(nodeId: string): string {
  return `https://www.figma.com/design/${DS_FIGMA_FILE}/?node-id=${nodeId.replace(':', '-')}`
}

/**
 * Family manifest. Each family's entries live in `entries/<family>.tsx` and are
 * loaded lazily via a dynamic import so a family's primitives (and their
 * dependencies) only load when its section is opened.
 *
 * Adding a family: add the manifest row here and create `entries/<id>.tsx`
 * exporting `entries: GalleryEntry[]`. The coverage-guard test
 * (`__tests__/gallery-coverage.test.ts`) will tell you which primitives the
 * new file must cover.
 */
export const galleryFamilies: GalleryFamily[] = [
  {
    id: 'foundations',
    labelKey: 'design_system.families.foundations',
    icon: familyIcon(Palette),
    load: () => import('./entries/foundations'),
  },
  {
    id: 'icons',
    labelKey: 'design_system.families.icons',
    icon: familyIcon(Shapes),
    load: () => import('./entries/icons'),
  },
  {
    id: 'buttons',
    labelKey: 'design_system.families.buttons',
    icon: familyIcon(MousePointerClick),
    load: () => import('./entries/buttons'),
  },
  {
    id: 'inputs',
    labelKey: 'design_system.families.inputs',
    icon: familyIcon(TextCursorInput),
    load: () => import('./entries/inputs'),
  },
  {
    id: 'dates',
    labelKey: 'design_system.families.dates',
    icon: familyIcon(CalendarDays),
    load: () => import('./entries/dates'),
  },
  {
    id: 'feedback',
    labelKey: 'design_system.families.feedback',
    icon: familyIcon(BellRing),
    load: () => import('./entries/feedback'),
  },
  {
    id: 'overlays',
    labelKey: 'design_system.families.overlays',
    icon: familyIcon(Layers),
    load: () => import('./entries/overlays'),
  },
  {
    id: 'navigation',
    labelKey: 'design_system.families.navigation',
    icon: familyIcon(Compass),
    load: () => import('./entries/navigation'),
  },
  {
    id: 'display',
    labelKey: 'design_system.families.display',
    icon: familyIcon(Table2),
    load: () => import('./entries/display'),
  },
  {
    id: 'charts',
    labelKey: 'design_system.families.charts',
    icon: familyIcon(BarChart3),
    load: () => import('./entries/charts'),
  },
  {
    id: 'filters',
    labelKey: 'design_system.families.filters',
    icon: familyIcon(Filter),
    load: () => import('./entries/filters'),
  },
  {
    id: 'detail',
    labelKey: 'design_system.families.detail',
    icon: familyIcon(PanelsTopLeft),
    load: () => import('./entries/detail'),
  },
  {
    id: 'scaffolding',
    labelKey: 'design_system.families.scaffolding',
    icon: familyIcon(LayoutTemplate),
    load: () => import('./entries/scaffolding'),
  },
  {
    id: 'banners',
    labelKey: 'design_system.families.banners',
    icon: familyIcon(Megaphone),
    load: () => import('./entries/banners'),
  },
  {
    id: 'notifications',
    labelKey: 'design_system.families.notifications',
    icon: familyIcon(Bell),
    load: () => import('./entries/notifications'),
  },
  {
    id: 'schedule',
    labelKey: 'design_system.families.schedule',
    icon: familyIcon(CalendarClock),
    load: () => import('./entries/schedule'),
  },
  {
    id: 'messages',
    labelKey: 'design_system.families.messages',
    icon: familyIcon(Mail),
    load: () => import('./entries/messages'),
  },
]
