# Multi-Brand System

This directory contains a simple multi-brand/white-label system. Each brand has its own URL path prefix with completely different pages.

## How It Works

1. **Default Pages**: Root-level pages (`/`, `/login`, `/reset`, `/onboarding`) serve Open Mercato (default brand).

2. **Brand Pages**: Brand-specific pages live under their path prefix (e.g., `/freighttech/`, `/freighttech/login`).

3. **Automatic URL Rewriting**: The middleware handles URL rewriting for brand domains automatically (no infrastructure changes needed).

4. **Sidebar Branding**: The AppShell uses `brandId` prop for conditional logo/name display in the admin panel.

5. **URL Rewriting**: For non-default brand domains, the middleware automatically rewrites public paths:
   - `openmercato.freighttech.org/login` → serves `/freighttech/login`
   - `openmercato.freighttech.org/` → serves `/freighttech`
   - Users see clean URLs without the brand prefix

## Directory Structure

```
src/
├── app/
│   ├── freighttech/                # FreightTech brand pages
│   │   ├── layout.tsx              # Brand layout with translations
│   │   ├── i18n/
│   │   │   └── en.json             # Brand-specific translations
│   │   ├── page.tsx                # /freighttech - Landing page
│   │   ├── login/page.tsx          # /freighttech/login
│   │   ├── reset/page.tsx          # /freighttech/reset
│   │   └── onboarding/page.tsx     # /freighttech/onboarding
│   ├── page.tsx                    # / - Open Mercato landing (default)
│   └── layout.tsx                  # Shared root layout
├── brands/
│   ├── index.ts                    # Exports
│   ├── types.ts                    # TypeScript interfaces
│   ├── registry.ts                 # Brand configs and lookup functions
│   └── README.md                   # This file
└── middleware.ts                   # Domain detection & header setting
```

## Adding a New Brand

### Step 1: Add Brand Config

Edit `/src/brands/registry.ts`:

```typescript
const myBrand: BrandConfig = {
  id: 'mybrand',
  name: 'My Brand',
  productName: 'My Brand',
  logo: {
    src: '/brands/mybrand/logo.png',
    width: 32,
    height: 32,
    alt: 'My Brand',
  },
  domains: ['mybrand.com', 'mybrand.localhost'],
}

export const brands: BrandConfig[] = [
  openMercatoBrand,
  freighttechBrand,
  myBrand,  // Add here
]
```

### Step 2: Create Brand Directory Structure

Create your brand-specific pages under their path prefix:

```bash
mkdir -p src/app/mybrand/login
mkdir -p src/app/mybrand/reset
mkdir -p src/app/mybrand/onboarding
mkdir -p src/app/mybrand/i18n
```

### Step 3: Create Brand Layout with Translations

Create a layout that loads brand-specific translations:

```tsx
// src/app/mybrand/layout.tsx
import { I18nProvider } from '@/lib/i18n/context'
import { detectLocale, loadDictionary } from '@open-mercato/shared/lib/i18n/server'
import type { Metadata } from 'next'

import en from './i18n/en.json'

const brandTranslations: Record<string, Record<string, unknown>> = { en }

function flattenDict(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      result[fullKey] = value
    } else if (typeof value === 'object' && value !== null) {
      Object.assign(result, flattenDict(value as Record<string, unknown>, fullKey))
    }
  }
  return result
}

export const metadata: Metadata = {
  title: 'My Brand',
  description: 'My Brand description',
  icons: { icon: '/brands/mybrand/logo.png' },
}

export default async function MyBrandLayout({ children }: { children: React.ReactNode }) {
  const locale = await detectLocale()
  const baseDict = await loadDictionary(locale)
  const brandDict = brandTranslations[locale] || brandTranslations.en || {}
  const flatBrandDict = flattenDict(brandDict)
  const mergedDict = { ...baseDict, ...flatBrandDict }

  return (
    <I18nProvider locale={locale} dict={mergedDict}>
      {children}
    </I18nProvider>
  )
}
```

### Step 4: Create Brand Translations

Create translation files that override base translations:

```json
// src/app/mybrand/i18n/en.json
{
  "onboarding": {
    "title": "Create your My Brand workspace"
  },
  "auth": {
    "login": {
      "subtitle": "Sign in to My Brand"
    }
  }
}
```

### Step 5: Create Brand Pages

```tsx
// src/app/mybrand/page.tsx
export default function MyBrandHome() {
  return (
    <main>
      <h1>Welcome to My Brand</h1>
      {/* Your completely custom layout */}
    </main>
  )
}
```

**Important:** For pages using `useSearchParams()` (like login), wrap the component in a Suspense boundary:

```tsx
// src/app/mybrand/login/page.tsx
"use client"
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

function LoginContent() {
  const searchParams = useSearchParams()
  // ... component logic
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginContent />
    </Suspense>
  )
}
```

### Step 6: Add Sidebar Logo (Optional)

Edit `/packages/ui/src/backend/AppShell.tsx`:

```typescript
const brandLogos: Record<string, { src: string; alt: string; name: string }> = {
  freighttech: { src: '/fms/freighttech-logo.png', alt: 'FreightTech', name: 'FreightTech' },
  mybrand: { src: '/brands/mybrand/logo.png', alt: 'My Brand', name: 'My Brand' },  // Add here
}
```

## Local Development

To test brand-specific sidebar branding locally, add the brand domain to your hosts file:

```bash
# Add to /etc/hosts
sudo nano /etc/hosts

# Add this line:
127.0.0.1  mybrand.localhost
```

Or use this one-liner:
```bash
echo "127.0.0.1  mybrand.localhost" | sudo tee -a /etc/hosts
```

Then access:
- `http://mybrand.localhost:3000/backend` - Backend with brand sidebar
- `http://mybrand.localhost:3000/mybrand` - Brand landing page

**Note:** Cookies are domain-scoped, so you'll need to log in separately for each domain.

## URL Rewriting (Infrastructure Level) - Optional

The middleware already handles URL rewriting for brand domains. However, for advanced use cases (custom caching, edge optimization), you can also configure rewrites at your infrastructure:

### AWS CloudFront Example

```json
{
  "Origins": [{
    "DomainName": "your-app.com",
    "CustomHeaders": [{
      "HeaderName": "X-Brand-Id",
      "HeaderValue": "mybrand"
    }]
  }],
  "CacheBehaviors": [{
    "PathPattern": "/*",
    "LambdaFunctionAssociations": [{
      "EventType": "origin-request",
      "LambdaFunctionARN": "arn:aws:lambda:...:url-rewrite-function"
    }]
  }]
}
```

### Nginx Example

```nginx
server {
    server_name mybrand.com;

    location / {
        rewrite ^/(.*)$ /mybrand/$1 break;
        proxy_pass http://your-app;
        proxy_set_header X-Brand-Id mybrand;
    }
}
```

## Current Brands

| Brand ID    | Name         | Path Prefix   | Domains (for sidebar)                |
|-------------|--------------|---------------|--------------------------------------|
| openmercato | Open Mercato | `/` (default) | localhost, 127.0.0.1                 |
| freighttech | FreightTech  | `/freighttech`| freighttech.org, freighttech.localhost |

## Important Notes

1. **Use Clean URLs in Brand Pages**: Since the middleware handles URL rewriting, brand pages should use clean URLs for internal links:
   ```tsx
   // In /mybrand/login/page.tsx
   <Link href="/reset">Forgot password?</Link>  // ✓ Correct - middleware rewrites on brand domains
   <Link href="/">Home</Link>                   // ✓ Correct - goes to brand landing
   ```

2. **Suspense Boundary**: Any page using `useSearchParams()` must wrap the component using it in a `<Suspense>` boundary (Next.js requirement).

3. **Translation Override**: Brand translations only need to include keys you want to override. All other keys fall back to base translations.

4. **Separate Sessions**: Each domain has its own cookie scope, so users need to log in separately for each brand domain.

## Files Reference

- **`registry.ts`** - Brand configurations and lookup functions
- **`types.ts`** - TypeScript interface for BrandConfig
- **`/src/middleware.ts`** - Domain detection and header setting
- **`/packages/ui/src/backend/AppShell.tsx`** - Sidebar with conditional logo rendering
- **`/src/app/<brand>/layout.tsx`** - Brand-specific layout with translation merging
- **`/src/app/<brand>/i18n/*.json`** - Brand-specific translation overrides
