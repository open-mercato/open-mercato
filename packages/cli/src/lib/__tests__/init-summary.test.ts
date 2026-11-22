import { formatInitSummary } from '../init-summary'

const users = [
  { icon: '👑', label: 'Superadmin', email: 'owner@example.test', password: 'demo-superadmin' },
  { icon: '🧰', label: 'Admin', email: 'admin@example.test', password: 'demo-admin' },
  { icon: '👷', label: 'Employee', email: 'employee@example.test', password: 'demo-employee' },
]

describe('formatInitSummary', () => {
  it('renders every supplied account and its own password without side borders', () => {
    const output = formatInitSummary({ users, autoStart: true }).join('\n')
    for (const user of users) {
      expect(output).toContain(`${user.icon} ${user.label}`)
      expect(output).toContain(user.email)
      expect(output).toContain(user.password)
    }
    expect(output).not.toMatch(/[╔║╚]/u)
    expect(output).toContain('The dev server will start automatically.')
    expect(output).not.toContain('\u001b[')
  })

  it('shows the manual startup hint when initialization is invoked directly', () => {
    const output = formatInitSummary({ users: users.slice(0, 1), autoStart: false }).join('\n')
    expect(output).toContain('🚀 Start the dev server: yarn dev')
    expect(output).not.toContain('automatically')
    expect(output).not.toContain('🧰 Admin')
  })

  it.each([8, 20, 40, 80])('wraps long credentials within %i columns without dropping characters', (columns) => {
    const password = 'long-demo-password-'.repeat(12)
    const lines = formatInitSummary({ users: [{ ...users[0], password }], autoStart: true, columns })
    for (const line of lines) {
      const width = [...line].reduce((total, character) => total + (/\p{Extended_Pictographic}/u.test(character) ? 2 : 1), 0)
      expect(width).toBeLessThanOrEqual(columns)
    }
    expect(lines.map((line) => line.trim()).join('')).toContain(password)
  })

  it('paints complete rows dark gray with light text and resets after each row', () => {
    const lines = formatInitSummary({ users, autoStart: true, color: true, columns: 80 })
    for (const line of lines) {
      expect(line).toMatch(/^\u001b\[48;2;57;62;70m\u001b\[38;2;238;238;238m/u)
      expect(line).toMatch(/\u001b\[0m$/u)
    }
  })

  it.each([NaN, Infinity, 0, -1])('uses a safe width for invalid columns %s', (columns) => {
    expect(formatInitSummary({ users, autoStart: false, columns })[0]).toHaveLength(80)
  })
})
