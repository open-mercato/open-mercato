/** @jest-environment jsdom */
import { render } from '@testing-library/react'
import { CrudForm, type CrudFormSubmitContext } from '@open-mercato/ui/backend/CrudForm'
import { TodoShowcaseForm } from '../TodoShowcaseForm'
import en from '../../i18n/en.json'

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: jest.fn(() => null),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: keyof typeof en) => en[key] ?? key,
}))

afterEach(() => {
  document.cookie = 'om_selected_org=; Max-Age=0; Path=/'
  jest.clearAllMocks()
})

function renderSubmit() {
  render(<TodoShowcaseForm />)
  const onSubmit = jest.mocked(CrudForm).mock.calls[0]?.[0].onSubmit
  if (!onSubmit) throw new Error('[internal] Todo showcase submit handler is missing')
  const write = jest.fn().mockResolvedValue({
    ok: true,
    result: { id: '00000000-0000-4000-8000-000000000001' },
  })
  const context = { mutation: { request: jest.fn(), write }, sectionPayload: { is_done: false } } satisfies CrudFormSubmitContext
  return { submit: () => onSubmit({}, context), write }
}

it('shows localized organization guidance before sending a create request in All organizations', async () => {
  document.cookie = 'om_selected_org=__all__; Path=/'
  const { submit, write } = renderSubmit()

  await expect(submit()).rejects.toThrow(en['example.todos.form.error.organizationRequired'])
  expect(write).not.toHaveBeenCalled()
})

it.each(['om_selected_org=00000000-0000-4000-8000-000000000002', ''])(
  'continues with the normal create request when the organization is selected or server-resolved (%s)',
  async (selection) => {
    if (selection) document.cookie = `${selection}; Path=/`
    const { submit, write } = renderSubmit()

    await expect(submit()).resolves.toEqual({ resourceId: '00000000-0000-4000-8000-000000000001' })
    expect(write).toHaveBeenCalledWith('/api/example/todos/section-policy', { is_done: false })
  },
)
