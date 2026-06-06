const createEntityProxy = (moduleId) => new Proxy({}, {
  get: (_target, prop) => (typeof prop === 'string' ? `${moduleId}:${prop}` : undefined),
})

const E = new Proxy({}, {
  get: (_target, prop) => (typeof prop === 'string' ? createEntityProxy(prop) : undefined),
})

module.exports = { E, M: E }
