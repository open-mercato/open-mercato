/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { InlineQtyApprovedCell } from '../backend/warranty_claims/[id]/page'

jest.mock('@open-mercato/ui/ai/AiChat', () => ({
  AiChat: () => <div data-testid="mock-ai-chat" />,
}))

type CellProps = React.ComponentProps<typeof InlineQtyApprovedCell>
type CellLine = CellProps['line']

const QTY_LABEL = 'Approved qty'

const LINE_TEMPLATE: CellLine = {
  id: 'line-1',
  claimId: 'claim-1',
  lineNo: 1,
  productId: null,
  variantId: null,
  productName: 'Widget',
  orderLineId: null,
  sku: null,
  serialNumber: null,
  purchaseDate: null,
  warrantyMonths: null,
  faultCode: null,
  faultDescription: null,
  qtyClaimed: '4',
  qtyApproved: '2',
  qtyReceived: null,
  disposition: null,
  lineStatus: 'pending',
  creditAmount: null,
  restockingFee: null,
  coreChargeAmount: null,
  coreCreditAmount: null,
  vendorClaimLineId: null,
  conditionOnReceipt: null,
  conditionGrade: null,
  quarantineStatus: null,
  inspectionNotes: null,
  assessmentPayload: null,
  updatedAt: '2026-07-19T10:00:00.000Z',
}

function renderCell(onSave: CellProps['onSave']) {
  render(
    <InlineQtyApprovedCell
      line={LINE_TEMPLATE}
      disabled={false}
      label={QTY_LABEL}
      onSave={onSave}
    />,
  )
  const input = screen.getByLabelText(QTY_LABEL) as HTMLInputElement
  input.focus()
  expect(document.activeElement).toBe(input)
  return input
}

describe('InlineQtyApprovedCell', () => {
  it('discards the edit on Escape without saving', () => {
    const onSave = jest.fn().mockResolvedValue(undefined)
    const input = renderCell(onSave)

    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onSave).not.toHaveBeenCalled()
    expect(input.value).toBe('2')
  })

  it('saves exactly once on Enter', () => {
    const onSave = jest.fn().mockResolvedValue(undefined)
    const input = renderCell(onSave)

    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(LINE_TEMPLATE, 'qtyApproved', '5')
  })

  it('saves once when the field loses focus without a key press', () => {
    const onSave = jest.fn().mockResolvedValue(undefined)
    const input = renderCell(onSave)

    fireEvent.change(input, { target: { value: '7' } })
    fireEvent.blur(input)

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(LINE_TEMPLATE, 'qtyApproved', '7')
  })

  it('still saves on a later blur after an Escape was discarded', () => {
    const onSave = jest.fn().mockResolvedValue(undefined)
    const input = renderCell(onSave)

    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    input.focus()
    fireEvent.change(input, { target: { value: '9' } })
    fireEvent.blur(input)

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(LINE_TEMPLATE, 'qtyApproved', '9')
  })

  it('does not save when the value is unchanged', () => {
    const onSave = jest.fn().mockResolvedValue(undefined)
    const input = renderCell(onSave)

    fireEvent.change(input, { target: { value: '2' } })
    fireEvent.blur(input)

    expect(onSave).not.toHaveBeenCalled()
  })
})
