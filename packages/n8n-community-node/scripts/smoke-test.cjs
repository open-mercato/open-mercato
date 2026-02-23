#!/usr/bin/env node
const assert = require('node:assert/strict')

const { OpenMercatoApi } = require('../dist/credentials/OpenMercatoApi.credentials.js')
const { OpenMercato } = require('../dist/nodes/OpenMercato/OpenMercato.node.js')

const credential = new OpenMercatoApi()
assert.equal(credential.name, 'openMercatoApi')
assert.ok(Array.isArray(credential.properties), 'credential properties should be defined')
assert.ok(credential.properties.find((p) => p.name === 'baseUrl'))
assert.ok(credential.properties.find((p) => p.name === 'apiKey'))

const node = new OpenMercato()
assert.equal(node.description.name, 'openMercato')
assert.ok(Array.isArray(node.description.properties), 'node properties should be defined')
assert.ok(node.description.properties.find((p) => p.name === 'method'))
assert.ok(node.description.properties.find((p) => p.name === 'path'))

console.log('[n8n-open-mercato] smoke test passed')
