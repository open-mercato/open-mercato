import {
  asnStatusVariant,
  canShowPutawayCompleteAction,
  formatAgingLabel,
  lineHasDiscrepancy,
  putawayStatusVariant,
  qcStatusVariant,
  resolveAsnCompleteGate,
} from '../inboundStatusUi'

describe('inboundStatusUi', () => {
  it('maps ASN statuses to semantic badge variants', () => {
    expect(asnStatusVariant('draft')).toBe('neutral')
    expect(asnStatusVariant('in_transit')).toBe('info')
    expect(asnStatusVariant('received')).toBe('success')
    expect(asnStatusVariant('closed')).toBe('neutral')
  })

  it('maps QC and putaway statuses to semantic badge variants', () => {
    expect(qcStatusVariant('pending')).toBe('warning')
    expect(qcStatusVariant('passed')).toBe('success')
    expect(qcStatusVariant('failed')).toBe('error')
    expect(putawayStatusVariant('open')).toBe('info')
    expect(putawayStatusVariant('in_progress')).toBe('warning')
    expect(putawayStatusVariant('done')).toBe('success')
    expect(putawayStatusVariant('cancelled')).toBe('neutral')
  })

  it('detects receiving discrepancies only after receipt activity', () => {
    expect(lineHasDiscrepancy(10, 0)).toBe(false)
    expect(lineHasDiscrepancy(10, 10)).toBe(false)
    expect(lineHasDiscrepancy(10, 12)).toBe(true)
    expect(lineHasDiscrepancy(10, 8)).toBe(true)
  })

  it('formats aging labels from created_at', () => {
    const now = Date.parse('2026-08-12T12:00:00.000Z')
    expect(formatAgingLabel('2026-08-12T11:30:00.000Z', now)).toBe('30m')
    expect(formatAgingLabel('2026-08-12T09:00:00.000Z', now)).toBe('3h')
    expect(formatAgingLabel('2026-08-10T12:00:00.000Z', now)).toBe('2d')
  })

  it('gates putaway Complete on adjust_inventory floor + manage or assignee', () => {
    expect(
      canShowPutawayCompleteAction({
        canManagePutaway: true,
        canAdjustInventory: true,
        isAssignee: false,
      }),
    ).toBe(true)
    expect(
      canShowPutawayCompleteAction({
        canManagePutaway: false,
        canAdjustInventory: true,
        isAssignee: true,
      }),
    ).toBe(true)
    expect(
      canShowPutawayCompleteAction({
        canManagePutaway: true,
        canAdjustInventory: false,
        isAssignee: false,
      }),
    ).toBe(false)
    expect(
      canShowPutawayCompleteAction({
        canManagePutaway: false,
        canAdjustInventory: true,
        isAssignee: false,
      }),
    ).toBe(false)
    expect(
      canShowPutawayCompleteAction({
        canManagePutaway: false,
        canAdjustInventory: false,
        isAssignee: true,
      }),
    ).toBe(false)
  })

  describe('resolveAsnCompleteGate', () => {
    const fullLines = [
      { expected_qty: 10, received_qty: 10, qc_status: 'passed' },
      { expected_qty: 5, received_qty: 5, qc_status: 'passed' },
    ]
    const shortLines = [
      { expected_qty: 10, received_qty: 10, qc_status: 'passed' },
      { expected_qty: 5, received_qty: 3, qc_status: 'passed' },
    ]
    const qcFailLines = [{ expected_qty: 10, received_qty: 10, qc_status: 'failed' }]
    const untouchedLines = [{ expected_qty: 10, received_qty: 0, qc_status: 'pending' }]

    it('hides Complete without manage, open status, or receipt activity', () => {
      expect(
        resolveAsnCompleteGate({
          canManageAsn: false,
          asnStatus: 'in_transit',
          lines: fullLines,
          closeWhenShort: false,
        }),
      ).toEqual({
        canShowComplete: false,
        canSubmitComplete: false,
        showCloseWhenShort: false,
      })
      expect(
        resolveAsnCompleteGate({
          canManageAsn: true,
          asnStatus: 'received',
          lines: fullLines,
          closeWhenShort: false,
        }),
      ).toEqual({
        canShowComplete: false,
        canSubmitComplete: false,
        showCloseWhenShort: false,
      })
      expect(
        resolveAsnCompleteGate({
          canManageAsn: true,
          asnStatus: 'draft',
          lines: untouchedLines,
          closeWhenShort: false,
        }),
      ).toEqual({
        canShowComplete: false,
        canSubmitComplete: false,
        showCloseWhenShort: false,
      })
      expect(
        resolveAsnCompleteGate({
          canManageAsn: true,
          asnStatus: 'draft',
          lines: untouchedLines,
          closeWhenShort: true,
        }),
      ).toEqual({
        canShowComplete: false,
        canSubmitComplete: false,
        showCloseWhenShort: false,
      })
      expect(
        resolveAsnCompleteGate({
          canManageAsn: true,
          asnStatus: 'draft',
          lines: [],
          closeWhenShort: false,
        }),
      ).toEqual({
        canShowComplete: false,
        canSubmitComplete: false,
        showCloseWhenShort: false,
      })
      expect(
        resolveAsnCompleteGate({
          canManageAsn: true,
          asnStatus: 'in_transit',
          lines: [],
          closeWhenShort: true,
        }),
      ).toEqual({
        canShowComplete: false,
        canSubmitComplete: false,
        showCloseWhenShort: false,
      })
    })

    it('enables default Complete when QC-passed accepted qty meets expected', () => {
      expect(
        resolveAsnCompleteGate({
          canManageAsn: true,
          asnStatus: 'in_transit',
          lines: fullLines,
          closeWhenShort: false,
        }),
      ).toEqual({
        canShowComplete: true,
        canSubmitComplete: true,
        showCloseWhenShort: false,
      })
    })

    it('keeps default Complete disabled for short receipts until closeWhenShort', () => {
      expect(
        resolveAsnCompleteGate({
          canManageAsn: true,
          asnStatus: 'draft',
          lines: shortLines,
          closeWhenShort: false,
        }),
      ).toEqual({
        canShowComplete: true,
        canSubmitComplete: false,
        showCloseWhenShort: true,
      })
      expect(
        resolveAsnCompleteGate({
          canManageAsn: true,
          asnStatus: 'draft',
          lines: shortLines,
          closeWhenShort: true,
        }),
      ).toEqual({
        canShowComplete: true,
        canSubmitComplete: true,
        showCloseWhenShort: true,
      })
    })

    it('treats QC-fail audit qty as short-close only (not default closeable)', () => {
      expect(
        resolveAsnCompleteGate({
          canManageAsn: true,
          asnStatus: 'in_transit',
          lines: qcFailLines,
          closeWhenShort: false,
        }),
      ).toEqual({
        canShowComplete: true,
        canSubmitComplete: false,
        showCloseWhenShort: true,
      })
      expect(
        resolveAsnCompleteGate({
          canManageAsn: true,
          asnStatus: 'in_transit',
          lines: qcFailLines,
          closeWhenShort: true,
        }),
      ).toEqual({
        canShowComplete: true,
        canSubmitComplete: true,
        showCloseWhenShort: true,
      })
    })
  })
})
