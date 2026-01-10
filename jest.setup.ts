process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/mercato_test'

// Note: Bootstrap is NOT called here because it imports modules.generated.ts
// which eagerly loads all UI components with ESM dependencies that Jest cannot parse.
// Tests that need bootstrap should:
// 1. Call bootstrap() directly in their test file, OR
// 2. Mock the specific registration functions they need
