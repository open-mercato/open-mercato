import { z } from 'zod'

// Test with string format for dates
const dateSchema = z.object({
  createdAt: z.date()
})

// Check if there's a 'string' option for unrepresentable
const testOptions = [
  { unrepresentable: 'string' },
  { unrepresentable: 'error' },
  { unrepresentable: 'any' },
  { target: 'jsonSchema7' },
  { target: 'openApi3' },
]

for (const opt of testOptions) {
  try {
    const result = z.toJSONSchema(dateSchema, opt as any)
    console.log('Option ' + JSON.stringify(opt) + ':')
    console.log('  Result:', JSON.stringify(result, null, 2).slice(0, 400))
  } catch (e: any) {
    console.log('Option ' + JSON.stringify(opt) + ' error:', e.message)
  }
}

// What about coerce.date - does it behave differently?
console.log('\n--- Testing z.coerce.date ---')
const coerceDateSchema = z.object({
  createdAt: z.coerce.date()
})
try {
  const result = z.toJSONSchema(coerceDateSchema, { unrepresentable: 'any' } as any)
  console.log('coerce.date result:', JSON.stringify(result, null, 2))
} catch (e: any) {
  console.log('coerce.date error:', e.message)
}
