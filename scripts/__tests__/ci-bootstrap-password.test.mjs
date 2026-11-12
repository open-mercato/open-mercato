import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const workflow = fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
const generator = workflow.match(/OM_INIT_SUPERADMIN_PASSWORD="\$\(node -e "([^"]+)"\)"/)
assert.ok(generator, 'CI must generate a fresh bootstrap password')

for (const randomValue of ['--' + 'x'.repeat(41), '_'.repeat(43), 'a'.repeat(43)]) {
  test(`CI bootstrap password remains a CLI value when randomness starts with ${randomValue.slice(0, 2)}`, () => {
    let password
    vm.runInNewContext(generator[1], {
      require(moduleName) {
        assert.equal(moduleName, 'node:crypto')
        return {
          randomBytes(size) {
            assert.equal(size, 32)
            return {
              toString(encoding) {
                assert.equal(encoding, 'base64url')
                return randomValue
              },
            }
          },
        }
      },
      process: { stdout: { write(value) { password = value } } },
    })

    assert.match(password, /^[A-Za-z0-9]/)
    assert.ok(password.includes(randomValue), 'Keep all 32 random bytes in the password')
    assert.equal(password.length, randomValue.length + 4)
    for (const requirement of [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/]) {
      assert.match(password, requirement)
    }
  })
}
