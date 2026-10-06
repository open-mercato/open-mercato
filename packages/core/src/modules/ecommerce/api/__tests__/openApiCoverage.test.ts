import fs from 'node:fs'
import path from 'node:path'

const API_ROOT = path.resolve(__dirname, '..')

function collectRouteFiles(directory: string): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : collectRouteFiles(fullPath)
      return entry.name === 'route.ts' ? [fullPath] : []
    })
    .sort((left, right) => left.localeCompare(right))
}

describe('ecommerce API OpenAPI coverage', () => {
  const routeFiles = collectRouteFiles(API_ROOT)

  it('finds the storefront and admin routes', () => {
    const relative = routeFiles.map((file) => path.relative(API_ROOT, file).split(path.sep).join('/'))
    expect(relative).toEqual(
      expect.arrayContaining([
        'storefront/context/route.ts',
        'storefront/products/route.ts',
        'storefront/products/[idOrHandle]/route.ts',
        'storefront/categories/route.ts',
        'storefront/categories/[slug]/route.ts',
        'storefront/search/suggest/route.ts',
        'stores/route.ts',
        'stores/[id]/branding/route.ts',
        'stores/[id]/preview-branding/route.ts',
        'store-domain-bindings/route.ts',
        'store-channel-bindings/route.ts',
      ]),
    )
  })

  it.each(routeFiles.map((file) => [path.relative(API_ROOT, file).split(path.sep).join('/'), file]))(
    '%s exports openApi',
    (_relative, file) => {
      expect(fs.readFileSync(file, 'utf8')).toMatch(/export const openApi\b/)
    },
  )

  it('keeps the declarative rateLimit metadata off the storefront routes, which limit per ip and store in the handler', () => {
    for (const file of routeFiles.filter((candidate) => candidate.includes(`${path.sep}storefront${path.sep}`))) {
      expect(fs.readFileSync(file, 'utf8')).not.toMatch(/rateLimit:\s*\{/)
    }
  })
})
