import fs from 'node:fs'
import path from 'node:path'

describe('embedding provider loading', () => {
  it('keeps provider SDKs out of static runtime imports', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/vector/services/embedding.ts'),
      'utf8',
    )
    const providers = [
      '@ai-sdk/openai',
      '@ai-sdk/google',
      '@ai-sdk/mistral',
      '@ai-sdk/cohere',
      '@ai-sdk/amazon-bedrock',
      'ai-sdk-ollama',
    ]

    for (const provider of providers) {
      expect(source).not.toMatch(new RegExp(`import\\s+(?!type\\s)[^\\n]+from\\s+['\"]${provider}['\"]`))
      expect(source).toContain(`await import('${provider}')`)
    }
  })
})
