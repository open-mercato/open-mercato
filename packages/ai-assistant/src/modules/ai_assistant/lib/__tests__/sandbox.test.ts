import { createSandbox, normalizeCode } from '../sandbox'

describe('normalizeCode', () => {
  it('strips markdown code fences', () => {
    expect(normalizeCode('```javascript\nasync () => 42\n```')).toBe('async () => 42')
  })

  it('strips ts fences', () => {
    expect(normalizeCode('```ts\nasync () => 42\n```')).toBe('async () => 42')
  })

  it('auto-wraps bare expressions into async arrow functions', () => {
    expect(normalizeCode('spec.paths')).toBe('async () => { return spec.paths }')
  })

  it('auto-wraps Object.keys(...) calls', () => {
    expect(normalizeCode('Object.keys(spec.paths)')).toBe(
      'async () => { return Object.keys(spec.paths) }'
    )
  })

  it('preserves async arrow functions', () => {
    expect(normalizeCode('async () => spec.paths')).toBe('async () => spec.paths')
  })

  it('preserves async arrow functions with body', () => {
    const code = 'async () => { const x = 1; return x }'
    expect(normalizeCode(code)).toBe(code)
  })

  it('trims whitespace', () => {
    expect(normalizeCode('  async () => 42  ')).toBe('async () => 42')
  })

  it('wraps const declarations without auto-return', () => {
    expect(normalizeCode('const x = 1; return x')).toBe(
      'async () => { const x = 1; return x }'
    )
  })

  it('wraps let declarations without auto-return', () => {
    expect(normalizeCode('let x = 1; x')).toBe('async () => { let x = 1; x }')
  })

  it('wraps var declarations without auto-return', () => {
    expect(normalizeCode('var x = 1')).toBe('async () => { var x = 1 }')
  })

  it('wraps for loops without auto-return', () => {
    expect(normalizeCode('for (const x of [1]) { console.log(x) }')).toBe(
      'async () => { for (const x of [1]) { console.log(x) } }'
    )
  })

  it('wraps if statements without auto-return', () => {
    expect(normalizeCode('if (true) { return 1 }')).toBe(
      'async () => { if (true) { return 1 } }'
    )
  })

  it('wraps try/catch without auto-return', () => {
    expect(normalizeCode('try { return 1 } catch(e) { return 2 }')).toBe(
      'async () => { try { return 1 } catch(e) { return 2 } }'
    )
  })
})

describe('createSandbox', () => {
  describe('basic execution', () => {
    it('executes simple expressions', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute('async () => 1 + 2')
      expect(result.error).toBeUndefined()
      expect(result.result).toBe(3)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('returns objects', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute('async () => ({ name: "test", count: 42 })')
      expect(result.result).toEqual({ name: 'test', count: 42 })
    })

    it('handles arrays', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute('async () => [1, 2, 3].filter(x => x > 1)')
      expect(result.result).toEqual([2, 3])
    })

    it('returns undefined for void functions', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute('async () => { const x = 1 }')
      expect(result.error).toBeUndefined()
      expect(result.result).toBeUndefined()
    })
  })

  describe('injected globals', () => {
    it('exposes custom globals', async () => {
      const sandbox = createSandbox({ myValue: 42 })
      const result = await sandbox.execute('async () => myValue')
      expect(result.result).toBe(42)
    })

    it('exposes complex objects as globals', async () => {
      const spec = {
        paths: {
          '/api/customers/companies': { get: { summary: 'List companies' } },
          '/api/sales/orders': { get: { summary: 'List orders' } },
        },
      }
      const sandbox = createSandbox({ spec })
      const result = await sandbox.execute('async () => Object.keys(spec.paths)')
      expect(result.result).toEqual(['/api/customers/companies', '/api/sales/orders'])
    })

    it('exposes helper functions as globals', async () => {
      const spec = {
        findEndpoints: (kw: string) =>
          ['/api/customers/companies', '/api/sales/orders']
            .filter((p) => p.includes(kw))
            .map((p) => ({ path: p })),
      }
      const sandbox = createSandbox({ spec })
      const result = await sandbox.execute(
        'async () => spec.findEndpoints("customer")'
      )
      expect(result.result).toEqual([{ path: '/api/customers/companies' }])
    })

    it('makes the context object available', async () => {
      const context = { tenantId: 't1', organizationId: 'o1', userId: 'u1' }
      const sandbox = createSandbox({ context })
      const result = await sandbox.execute('async () => context.tenantId')
      expect(result.result).toBe('t1')
    })
  })

  describe('security restrictions', () => {
    it('blocks require', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute("async () => require('fs')")
      expect(result.error).toBeDefined()
    })

    it('blocks process', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute('async () => process.env')
      expect(result.error).toBeDefined()
    })

    it('blocks fetch', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute("async () => fetch('http://evil.com')")
      expect(result.error).toBeDefined()
    })

    it('blocks globalThis', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute('async () => globalThis')
      expect(result.result).toBeUndefined()
    })

    it('blocks Buffer', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute("async () => Buffer.from('test')")
      expect(result.error).toBeDefined()
    })

    it('blocks setTimeout', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute(
        'async () => setTimeout(() => {}, 100)'
      )
      expect(result.error).toBeDefined()
    })

    it('blocks setInterval', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute(
        'async () => setInterval(() => {}, 100)'
      )
      expect(result.error).toBeDefined()
    })
  })

  describe('allowed built-ins', () => {
    it('allows JSON', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute(
        'async () => JSON.parse(JSON.stringify({ a: 1 }))'
      )
      expect(result.result).toEqual({ a: 1 })
    })

    it('allows Object methods', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute(
        'async () => Object.keys({ a: 1, b: 2 })'
      )
      expect(result.result).toEqual(['a', 'b'])
    })

    it('allows Array methods', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute(
        'async () => [3, 1, 2].sort((a, b) => a - b)'
      )
      expect(result.result).toEqual([1, 2, 3])
    })

    it('allows Map and Set', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute(
        'async () => { const s = new Set([1,2,2,3]); return s.size }'
      )
      expect(result.result).toBe(3)
    })

    it('allows Math', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute('async () => Math.max(1, 5, 3)')
      expect(result.result).toBe(5)
    })

    it('allows RegExp', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute(
        "async () => /customer/.test('customers/companies')"
      )
      expect(result.result).toBe(true)
    })

    it('allows Promise', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute(
        'async () => Promise.resolve(42)'
      )
      expect(result.result).toBe(42)
    })
  })

  describe('console capture', () => {
    it('captures console.log output', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute(
        'async () => { console.log("hello"); return 42 }'
      )
      expect(result.result).toBe(42)
      expect(result.logs).toContain('hello')
    })

    it('captures multiple console methods', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute(
        'async () => { console.info("a"); console.warn("b"); console.error("c"); return true }'
      )
      expect(result.logs).toEqual(['a', 'b', 'c'])
    })

    it('serializes objects in console output', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute(
        'async () => { console.log("data:", { x: 1 }); return true }'
      )
      expect(result.logs[0]).toContain('data:')
      expect(result.logs[0]).toContain('"x":1')
    })
  })

  describe('error handling', () => {
    it('catches runtime errors', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute(
        'async () => { throw new Error("boom") }'
      )
      expect(result.error).toBe('boom')
      expect(result.result).toBeNull()
    })

    it('catches type errors', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute(
        'async () => { const x = null; return x.foo }'
      )
      expect(result.error).toBeDefined()
    })

    it('catches syntax errors', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute('async () => { if ( }')
      expect(result.error).toBeDefined()
    })
  })

  describe('timeout', () => {
    it('times out long-running code', async () => {
      const sandbox = createSandbox({}, { timeout: 100 })
      const result = await sandbox.execute(
        'async () => { while(true) {} }'
      )
      expect(result.error).toBeDefined()
      expect(result.error).toMatch(/timed out/i)
    }, 10_000)
  })

  describe('async api.request() integration', () => {
    it('executes async api.request calls', async () => {
      const api = {
        request: jest.fn().mockResolvedValue({
          success: true,
          statusCode: 200,
          data: { items: [{ id: '1', name: 'ACME' }] },
        }),
      }
      const sandbox = createSandbox({ api })
      const result = await sandbox.execute(
        'async () => api.request({ method: "GET", path: "/api/customers/companies" })'
      )
      expect(result.error).toBeUndefined()
      expect(result.result).toEqual({
        success: true,
        statusCode: 200,
        data: { items: [{ id: '1', name: 'ACME' }] },
      })
      expect(api.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/customers/companies',
      })
    })

    it('executes multiple sequential api.request calls', async () => {
      let callCount = 0
      const api = {
        request: jest.fn().mockImplementation(async (params: { path: string }) => {
          callCount++
          return {
            success: true,
            statusCode: 200,
            data: { id: callCount, path: params.path },
          }
        }),
      }
      const sandbox = createSandbox({ api })
      const result = await sandbox.execute(`
        async () => {
          const companies = await api.request({ method: "GET", path: "/api/customers/companies" })
          const people = await api.request({ method: "GET", path: "/api/customers/people" })
          return { companies: companies.data, people: people.data }
        }
      `)
      expect(result.error).toBeUndefined()
      expect(api.request).toHaveBeenCalledTimes(2)
      expect(result.result).toEqual({
        companies: { id: 1, path: '/api/customers/companies' },
        people: { id: 2, path: '/api/customers/people' },
      })
    })

    it('handles api.request errors gracefully', async () => {
      const api = {
        request: jest.fn().mockResolvedValue({
          success: false,
          statusCode: 404,
          error: 'Not found',
        }),
      }
      const sandbox = createSandbox({ api })
      const result = await sandbox.execute(
        'async () => api.request({ method: "GET", path: "/api/nonexistent" })'
      )
      expect(result.error).toBeUndefined()
      expect(result.result).toEqual({
        success: false,
        statusCode: 404,
        error: 'Not found',
      })
    })

    it('handles api.request rejections', async () => {
      const api = {
        request: jest.fn().mockRejectedValue(new Error('Network error')),
      }
      const sandbox = createSandbox({ api })
      const result = await sandbox.execute(
        'async () => api.request({ method: "GET", path: "/api/fail" })'
      )
      expect(result.error).toBe('Network error')
    })

    it('supports write operations in sandbox', async () => {
      const api = {
        request: jest.fn().mockResolvedValue({
          success: true,
          statusCode: 201,
          data: { id: 'new-id', name: 'New Company' },
        }),
      }
      const sandbox = createSandbox({ api })
      const result = await sandbox.execute(`
        async () => api.request({
          method: "POST",
          path: "/api/customers/companies",
          body: { name: "New Company", isActive: true }
        })
      `)
      expect(result.error).toBeUndefined()
      expect(api.request).toHaveBeenCalledWith({
        method: 'POST',
        path: '/api/customers/companies',
        body: { name: 'New Company', isActive: true },
      })
    })

    it('supports processing API results with JS logic', async () => {
      const api = {
        request: jest.fn().mockResolvedValue({
          success: true,
          statusCode: 200,
          data: {
            items: [
              { id: '1', name: 'ACME', city: 'New York' },
              { id: '2', name: 'Beta', city: 'London' },
              { id: '3', name: 'Gamma', city: 'New York' },
            ],
          },
        }),
      }
      const sandbox = createSandbox({ api })
      const result = await sandbox.execute(`
        async () => {
          const res = await api.request({ method: "GET", path: "/api/customers/companies" })
          return res.data.items
            .filter(c => c.city === "New York")
            .map(c => c.name)
        }
      `)
      expect(result.result).toEqual(['ACME', 'Gamma'])
    })
  })

  describe('spec search patterns', () => {
    const spec = {
      paths: {
        '/api/customers/companies': {
          get: { summary: 'List companies', parameters: [{ name: 'name', in: 'query' }] },
          post: { summary: 'Create company', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } } } },
        },
        '/api/customers/people': {
          get: { summary: 'List people' },
        },
        '/api/sales/orders': {
          get: { summary: 'List orders' },
          post: { summary: 'Create order' },
        },
      },
      entitySchemas: [
        { className: 'Company', tableName: 'customers_companies', module: 'customers', fields: [{ name: 'id', type: 'string' }, { name: 'name', type: 'string' }] },
        { className: 'Person', tableName: 'customers_people', module: 'customers', fields: [{ name: 'id', type: 'string' }, { name: 'firstName', type: 'string' }] },
      ],
      findEndpoints: (kw: string) =>
        Object.entries(spec.paths)
          .filter(([p]) => p.toLowerCase().includes(kw.toLowerCase()))
          .map(([path, methods]) => ({
            path,
            methods: Object.keys(methods).filter((m) => m !== 'parameters'),
          })),
      describeEntity: (kw: string) =>
        spec.entitySchemas.find(
          (e) =>
            e.className.toLowerCase().includes(kw.toLowerCase()) ||
            e.tableName.toLowerCase().includes(kw.toLowerCase())
        ) || null,
    }

    it('finds endpoints by keyword', async () => {
      const sandbox = createSandbox({ spec })
      const result = await sandbox.execute(
        'async () => spec.findEndpoints("customer")'
      )
      expect(result.result).toEqual([
        { path: '/api/customers/companies', methods: ['get', 'post'] },
        { path: '/api/customers/people', methods: ['get'] },
      ])
    })

    it('reads endpoint details directly from paths', async () => {
      const sandbox = createSandbox({ spec })
      const result = await sandbox.execute(
        'async () => spec.paths["/api/customers/companies"].get'
      )
      expect(result.result).toEqual({
        summary: 'List companies',
        parameters: [{ name: 'name', in: 'query' }],
      })
    })

    it('extracts request body schema', async () => {
      const sandbox = createSandbox({ spec })
      const result = await sandbox.execute(
        'async () => spec.paths["/api/customers/companies"].post.requestBody.content["application/json"].schema'
      )
      expect(result.result).toEqual({
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      })
    })

    it('discovers entity schemas by keyword', async () => {
      const sandbox = createSandbox({ spec })
      const result = await sandbox.execute(
        'async () => spec.describeEntity("company")'
      )
      expect(result.result).toEqual({
        className: 'Company',
        tableName: 'customers_companies',
        module: 'customers',
        fields: [
          { name: 'id', type: 'string' },
          { name: 'name', type: 'string' },
        ],
      })
    })

    it('lists all available paths', async () => {
      const sandbox = createSandbox({ spec })
      const result = await sandbox.execute(
        'async () => Object.keys(spec.paths)'
      )
      expect(result.result).toEqual([
        '/api/customers/companies',
        '/api/customers/people',
        '/api/sales/orders',
      ])
    })

    it('combines search + execute pattern', async () => {
      const api = {
        request: jest.fn().mockResolvedValue({
          success: true,
          statusCode: 200,
          data: { items: [{ id: '1', name: 'ACME' }] },
        }),
      }

      // Step 1: search for endpoints
      const searchSandbox = createSandbox({ spec })
      const searchResult = await searchSandbox.execute(
        'async () => spec.findEndpoints("companies")'
      )
      expect(searchResult.result).toEqual([
        { path: '/api/customers/companies', methods: ['get', 'post'] },
      ])

      // Step 2: execute API call using discovered path
      const execSandbox = createSandbox({ api })
      const execResult = await execSandbox.execute(`
        async () => api.request({
          method: "GET",
          path: "/api/customers/companies"
        })
      `)
      expect(execResult.result).toEqual({
        success: true,
        statusCode: 200,
        data: { items: [{ id: '1', name: 'ACME' }] },
      })
    })
  })

  describe('statement execution', () => {
    it('executes code with const declarations', async () => {
      const api = {
        request: jest.fn().mockResolvedValue({
          success: true,
          statusCode: 200,
          data: { items: [{ id: '1', name: 'ACME' }] },
        }),
      }
      const sandbox = createSandbox({ api })
      const result = await sandbox.execute(
        'const result = await api.request({ method: "GET", path: "/api/customers/companies" }); return result'
      )
      expect(result.error).toBeUndefined()
      expect(result.result).toEqual({
        success: true,
        statusCode: 200,
        data: { items: [{ id: '1', name: 'ACME' }] },
      })
    })

    it('executes for loops', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute(
        'const items = [1, 2, 3]; let sum = 0; for (const item of items) { sum += item }; return sum'
      )
      expect(result.error).toBeUndefined()
      expect(result.result).toBe(6)
    })

    it('executes try/catch blocks', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute(
        'try { throw new Error("test") } catch (e) { return e.message }'
      )
      expect(result.error).toBeUndefined()
      expect(result.result).toBe('test')
    })

    it('executes if/else blocks', async () => {
      const sandbox = createSandbox({ val: 42 })
      const result = await sandbox.execute(
        'if (val > 10) { return "big" } else { return "small" }'
      )
      expect(result.error).toBeUndefined()
      expect(result.result).toBe('big')
    })

    it('executes let declarations', async () => {
      const sandbox = createSandbox({})
      const result = await sandbox.execute('let x = 5; x = x * 2; return x')
      expect(result.error).toBeUndefined()
      expect(result.result).toBe(10)
    })
  })

  describe('auto-wrapping bare expressions', () => {
    it('handles bare property access', async () => {
      const sandbox = createSandbox({ spec: { paths: { '/a': 1 } } })
      const result = await sandbox.execute('Object.keys(spec.paths)')
      expect(result.result).toEqual(['/a'])
    })

    it('handles bare function calls', async () => {
      const fn = jest.fn().mockReturnValue('result')
      const sandbox = createSandbox({ fn })
      const result = await sandbox.execute('fn()')
      expect(result.result).toBe('result')
    })
  })
})
