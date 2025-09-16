import * as fs from 'fs'

describe('Module Registry Generator - Per-Method Metadata', () => {
  it('should generate correct API metadata structure for per-method metadata', () => {
    // Test the actual generated content by reading the real generated file
    const generatedContent = fs.readFileSync('generated/modules.generated.ts', 'utf-8')
    
    // Check that the generated content includes the correct metadata structure
    expect(generatedContent).toContain('metadata: R')
    expect(generatedContent).toContain('handlers: R')
    
    // Check that todos API is included
    expect(generatedContent).toContain('/example/todos')
    expect(generatedContent).toContain('/example/organizations')
  })

  it('should include todos and organizations APIs in generated registry', () => {
    const generatedContent = fs.readFileSync('generated/modules.generated.ts', 'utf-8')
    
    // Check that both APIs are included
    expect(generatedContent).toContain('/example/todos')
    expect(generatedContent).toContain('/example/organizations')
    
    // Check that they have the correct import structure
    expect(generatedContent).toContain('@open-mercato/example/modules/example/api/todos/route')
    expect(generatedContent).toContain('@open-mercato/example/modules/example/api/organizations/route')
  })
})
