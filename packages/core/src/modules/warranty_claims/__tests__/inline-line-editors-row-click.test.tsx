/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { InlineLineSelectCell, InlineQtyApprovedCell } from '../backend/warranty_claims/[id]/page'

jest.mock('@open-mercato/ui/ai/AiChat', () => ({
  AiChat: () => <div data-testid="mock-ai-chat" />,
}))

type CellLine = React.ComponentProps<typeof InlineQtyApprovedCell>['line']

const LINE: CellLine = {
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

const QTY_LABEL = 'Approved qty'
const DISPOSITION_LABEL = 'Disposition'

function renderInRow(cell: React.ReactNode, onRowClick: () => void) {
  return render(
    <table>
      <tbody>
        <tr onClick={onRowClick} data-testid="row">
          <td>{cell}</td>
          <td data-testid="sibling-cell">sibling</td>
        </tr>
      </tbody>
    </table>,
  )
}

describe('inline line editors do not bubble to the DataTable row action (#5288)', () => {
  it('clicking the approved-qty input does not trigger the row (opens the edit popup)', () => {
    const onRowClick = jest.fn()
    renderInRow(
      <InlineQtyApprovedCell line={LINE} disabled={false} label={QTY_LABEL} onSave={jest.fn()} />,
      onRowClick,
    )
    fireEvent.click(screen.getByLabelText(QTY_LABEL))
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('clicking the disposition select trigger does not trigger the row action', () => {
    const onRowClick = jest.fn()
    renderInRow(
      <InlineLineSelectCell
        line={LINE}
        field="disposition"
        value={null}
        options={[{ value: 'repair', label: 'Repair' }]}
        label={DISPOSITION_LABEL}
        disabled={false}
        onSave={jest.fn()}
      />,
      onRowClick,
    )
    fireEvent.click(screen.getByLabelText(DISPOSITION_LABEL))
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('clicking a sibling cell still triggers the row action (the fix is scoped, not blanket)', () => {
    const onRowClick = jest.fn()
    renderInRow(
      <InlineQtyApprovedCell line={LINE} disabled={false} label={QTY_LABEL} onSave={jest.fn()} />,
      onRowClick,
    )
    fireEvent.click(screen.getByTestId('sibling-cell'))
    expect(onRowClick).toHaveBeenCalledTimes(1)
  })

  it('the inline input still commits its edit on blur (fix preserves inline editing)', () => {
    const onSave = jest.fn()
    renderInRow(
      <InlineQtyApprovedCell line={LINE} disabled={false} label={QTY_LABEL} onSave={onSave} />,
      jest.fn(),
    )
    const input = screen.getByLabelText(QTY_LABEL) as HTMLInputElement
    fireEvent.change(input, { target: { value: '3' } })
    fireEvent.blur(input)
    expect(onSave).toHaveBeenCalledWith(LINE, 'qtyApproved', '3')
  })
})
