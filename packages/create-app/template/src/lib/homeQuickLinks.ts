type ModuleLike = { id: string }

export type HomeQuickLink = {
  href: string
  translationKey: string
  fallbackLabel: string
}

const EXAMPLE_MODULE_ID = 'example'

const BASE_LINKS: HomeQuickLink[] = [
  { href: '/login', translationKey: 'app.page.quickLinks.login', fallbackLabel: 'Login' },
]

const EXAMPLE_LINKS: HomeQuickLink[] = [
  { href: '/example', translationKey: 'app.page.quickLinks.examplePage', fallbackLabel: 'Example Page' },
  { href: '/backend/example', translationKey: 'app.page.quickLinks.exampleAdmin', fallbackLabel: 'Example Admin' },
  { href: '/backend/todos', translationKey: 'app.page.quickLinks.exampleTodos', fallbackLabel: 'Example Todos with Custom Fields' },
  { href: '/blog/123', translationKey: 'app.page.quickLinks.exampleBlog', fallbackLabel: 'Example Blog Post' },
]

export function buildHomeQuickLinks(modules: readonly ModuleLike[]): HomeQuickLink[] {
  if (modules.some((module) => module.id === EXAMPLE_MODULE_ID)) {
    return [...BASE_LINKS, ...EXAMPLE_LINKS]
  }

  return BASE_LINKS
}
