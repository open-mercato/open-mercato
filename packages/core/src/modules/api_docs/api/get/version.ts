import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { APP_VERSION } from '@open-mercato/shared/lib/version'

const versionResponseSchema = z.object({
  version: z
    .string()
    .describe(
      'Deployed Open Mercato version: the OM_VERSION / OPEN_MERCATO_VERSION override when set, otherwise the installed platform version.',
    ),
  platform: z
    .string()
    .describe('Installed Open Mercato platform version (the version shown in the backend footer).'),
  app: z
    .string()
    .nullable()
    .describe("Version from the deployment app's own package.json, or null when it cannot be read."),
})

type VersionResponse = z.infer<typeof versionResponseSchema>

function readExplicitVersion(): string | null {
  const explicit = process.env.OM_VERSION || process.env.OPEN_MERCATO_VERSION
  return explicit && explicit.length > 0 ? explicit : null
}

function readAppVersion(): string | null {
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json')
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: string }
    if (typeof parsed.version === 'string' && parsed.version.length > 0) return parsed.version
  } catch {
    return null
  }
  return null
}

const versionInfo: VersionResponse = {
  version: readExplicitVersion() ?? APP_VERSION,
  platform: APP_VERSION,
  app: readAppVersion(),
}

export const metadata = {
  path: '/version',
  GET: {
    requireAuth: false,
    rateLimit: { points: 30, duration: 60, keyPrefix: 'api_version' },
  },
}

export async function GET() {
  return NextResponse.json(versionInfo)
}

export default GET

export const openApi: OpenApiRouteDoc = {
  tag: 'API Documentation',
  summary: 'Deployed Open Mercato version',
  methods: {
    GET: {
      summary: 'Return the deployed Open Mercato version',
      description:
        'Reports the installed Open Mercato platform version (the same value the backend footer shows). `version` honours an explicit OM_VERSION / OPEN_MERCATO_VERSION override; `platform` is always the installed platform version; `app` is the deployment app shell version from its package.json.',
      tags: ['API Documentation'],
      responses: [
        {
          status: 200,
          description: 'Current deployment version metadata',
          schema: versionResponseSchema,
        },
      ],
    },
  },
}
