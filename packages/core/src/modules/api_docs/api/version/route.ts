import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const versionResponseSchema = z.object({
  version: z.string(),
})

type VersionResponse = z.infer<typeof versionResponseSchema>

function readDeployedVersion(): string {
  // Explicit override wins: deployments that bundle a different version than the
  // running app's package.json (or want to pin the Open Mercato platform version)
  // set OM_VERSION / OPEN_MERCATO_VERSION.
  const explicit = process.env.OM_VERSION || process.env.OPEN_MERCATO_VERSION
  if (explicit && explicit.length > 0) return explicit
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json')
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: string }
    if (typeof parsed.version === 'string' && parsed.version.length > 0) return parsed.version
  } catch {
    // Fall through to the development sentinel below.
  }
  return '0.0.0-dev'
}

const deployedVersion = readDeployedVersion()

export const metadata = {
  path: '/version',
  GET: {
    requireAuth: false,
    rateLimit: { points: 30, duration: 60, keyPrefix: 'api_version' },
  },
}

export async function GET() {
  const body: VersionResponse = { version: deployedVersion }
  return NextResponse.json(body)
}

export default GET

export const openApi: OpenApiRouteDoc = {
  tag: 'API Documentation',
  summary: 'Deployed Open Mercato version',
  methods: {
    GET: {
      summary: 'Return the deployed Open Mercato version',
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

