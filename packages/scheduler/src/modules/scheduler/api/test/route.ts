import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  requireAuth: false, // Allow testing without auth
}

/**
 * POST /api/scheduler/test
 * Test endpoint that executes the test command and prints args
 */
export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  
  try {
    const body = await req.json().catch(() => ({}))
    
    const container = await createRequestContainer()
    const commandBus = container.resolve('commandBus') as any

    console.log('\n📋 API Test Endpoint Called')
    console.log('Request body:', JSON.stringify(body, null, 2))
    console.log('Auth present:', !!auth)
    
    // Execute the test command
    const result = await commandBus.execute({
      commandId: 'scheduler.test.print-args',
      input: {
        message: body.message || 'Test command via API',
        ...body,
        apiCalledAt: new Date().toISOString(),
      },
      auth,
    })

    console.log('Command result:', result)
    console.log('✅ Test command completed\n')

    return NextResponse.json({
      ok: true,
      result: result.result,
      message: 'Test command executed successfully. Check server logs for output.',
    })
  } catch (error: any) {
    console.error('❌ Test command failed:', error)
    return NextResponse.json(
      { 
        error: error.message || 'Failed to execute test command',
        stack: error.stack,
      },
      { status: 500 }
    )
  }
}

// Request/Response schemas
const testRequestSchema = z
  .object({
    message: z.string().optional(),
  })
  .passthrough()

const testResponseSchema = z.object({
  ok: z.boolean(),
  result: z.unknown(),
  message: z.string(),
})

const errorResponseSchema = z.object({
  error: z.string(),
  stack: z.string().optional(),
})

// OpenAPI specification
export const openApi: OpenApiRouteDoc = {
  tag: 'Scheduler',
  summary: 'Test command execution',
  description: 'Execute a test command that prints its arguments to the server console. Useful for debugging command execution flow.',
  methods: {
    POST: {
      operationId: 'testCommandExecution',
      summary: 'Test command execution',
      description: 'Executes a test command that logs its arguments to the console for debugging purposes.',
      requestBody: {
        schema: testRequestSchema,
        contentType: 'application/json',
      },
      responses: [
        {
          status: 200,
          description: 'Test command executed successfully',
          schema: testResponseSchema,
        },
      ],
      errors: [
        { status: 500, description: 'Test command failed', schema: errorResponseSchema },
      ],
    },
  },
}
