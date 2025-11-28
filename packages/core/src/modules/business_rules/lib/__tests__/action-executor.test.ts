import {
  executeAction,
  executeActions,
  interpolateMessage,
  type Action,
  type ActionContext,
  type AllowTransitionResult,
  type BlockTransitionResult,
  type LogResult,
  type ShowErrorResult,
  type ShowWarningResult,
  type ShowInfoResult,
  type NotifyResult,
  type SetFieldResult,
  type CallWebhookResult,
  type EmitEventResult,
} from '../action-executor'

describe('Action Executor', () => {
  // Type-safe result extractors
  const asAllowTransition = (result: any) => result.result as AllowTransitionResult
  const asBlockTransition = (result: any) => result.result as BlockTransitionResult
  const asLog = (result: any) => result.result as LogResult
  const asShowError = (result: any) => result.result as ShowErrorResult
  const asShowWarning = (result: any) => result.result as ShowWarningResult
  const asShowInfo = (result: any) => result.result as ShowInfoResult
  const asNotify = (result: any) => result.result as NotifyResult
  const asSetField = (result: any) => result.result as SetFieldResult
  const asCallWebhook = (result: any) => result.result as CallWebhookResult
  const asEmitEvent = (result: any) => result.result as EmitEventResult

  const baseContext: ActionContext = {
    user: {
      id: 'user-123',
      email: 'test@example.com',
      role: 'admin',
    },
    tenant: {
      id: 'tenant-456',
    },
    organization: {
      id: 'org-789',
    },
    entityType: 'WorkOrder',
    entityId: 'wo-001',
    eventType: 'beforeStatusChange',
    data: {
      status: 'RELEASED',
      priority: 'HIGH',
      workOrderNumber: 'WO-12345',
    },
    ruleId: 'RULE-001',
    ruleName: 'Work Order Guard',
  }

  describe('executeAction', () => {
    describe('ALLOW_TRANSITION', () => {
      it('should execute ALLOW_TRANSITION action', async () => {
        const action: Action = {
          type: 'ALLOW_TRANSITION',
          config: {
            message: 'Transition allowed',
          },
        }

        const result = await executeAction(action, baseContext)

        expect(result.success).toBe(true)
        expect(result.result).toEqual({
          type: 'ALLOW_TRANSITION',
          allowed: true,
          message: 'Transition allowed',
        })
        expect(result.executionTime).toBeGreaterThanOrEqual(0)
      })

      it('should use default message if not provided', async () => {
        const action: Action = {
          type: 'ALLOW_TRANSITION',
        }

        const result = await executeAction(action, baseContext)

        expect(result.success).toBe(true)
        expect((result.result as AllowTransitionResult).message).toBe('Transition allowed')
      })

      it('should interpolate message with context', async () => {
        const action: Action = {
          type: 'ALLOW_TRANSITION',
          config: {
            message: 'Work order {{data.workOrderNumber}} can proceed',
          },
        }

        const result = await executeAction(action, baseContext)

        expect((result.result as AllowTransitionResult).message).toBe('Work order WO-12345 can proceed')
      })
    })

    describe('BLOCK_TRANSITION', () => {
      it('should execute BLOCK_TRANSITION action', async () => {
        const action: Action = {
          type: 'BLOCK_TRANSITION',
          config: {
            message: 'Transition blocked',
          },
        }

        const result = await executeAction(action, baseContext)

        expect(result.success).toBe(true)
        expect(result.result).toEqual({
          type: 'BLOCK_TRANSITION',
          allowed: false,
          message: 'Transition blocked',
        })
      })

      it('should use default message if not provided', async () => {
        const action: Action = {
          type: 'BLOCK_TRANSITION',
        }

        const result = await executeAction(action, baseContext)

        expect((result.result as BlockTransitionResult)!.message).toBe('Transition blocked')
      })
    })

    describe('LOG', () => {
      it('should execute LOG action with info level', async () => {
        const action: Action = {
          type: 'LOG',
          config: {
            level: 'info',
            message: 'Rule executed successfully',
          },
        }

        const result = await executeAction(action, baseContext)

        expect(result.success).toBe(true)
        expect(result.result!.type).toBe('LOG')
        expect((result.result as LogResult)!.level).toBe('info')
        expect((result.result as LogResult)!.message).toBe('Rule executed successfully')
        expect((result.result as LogResult)!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      })

      it('should default to info level', async () => {
        const action: Action = {
          type: 'LOG',
          config: {
            message: 'Log message',
          },
        }

        const result = await executeAction(action, baseContext)

        expect((result.result as LogResult)!.level).toBe('info')
      })

      it('should support different log levels', async () => {
        const levels = ['debug', 'info', 'warn', 'error']

        for (const level of levels) {
          const action: Action = {
            type: 'LOG',
            config: {
              level,
              message: `Log at ${level} level`,
            },
          }

          const result = await executeAction(action, baseContext)

          expect(result.success).toBe(true)
          expect((result.result as LogResult)!.level).toBe(level)
        }
      })
    })

    describe('SHOW_ERROR', () => {
      it('should execute SHOW_ERROR action', async () => {
        const action: Action = {
          type: 'SHOW_ERROR',
          config: {
            message: 'An error occurred',
          },
        }

        const result = await executeAction(action, baseContext)

        expect(result.success).toBe(true)
        expect(result.result).toEqual({
          type: 'SHOW_ERROR',
          severity: 'error',
          message: 'An error occurred',
        })
      })
    })

    describe('SHOW_WARNING', () => {
      it('should execute SHOW_WARNING action', async () => {
        const action: Action = {
          type: 'SHOW_WARNING',
          config: {
            message: 'Warning message',
          },
        }

        const result = await executeAction(action, baseContext)

        expect(result.success).toBe(true)
        expect(result.result).toEqual({
          type: 'SHOW_WARNING',
          severity: 'warning',
          message: 'Warning message',
        })
      })
    })

    describe('SHOW_INFO', () => {
      it('should execute SHOW_INFO action', async () => {
        const action: Action = {
          type: 'SHOW_INFO',
          config: {
            message: 'Info message',
          },
        }

        const result = await executeAction(action, baseContext)

        expect(result.success).toBe(true)
        expect(result.result).toEqual({
          type: 'SHOW_INFO',
          severity: 'info',
          message: 'Info message',
        })
      })
    })

    describe('NOTIFY', () => {
      it('should execute NOTIFY action', async () => {
        const action: Action = {
          type: 'NOTIFY',
          config: {
            recipients: ['supervisor@example.com', 'manager@example.com'],
            subject: 'Work Order Update',
            message: 'Work order status changed',
            template: 'work_order_notification',
          },
        }

        const result = await executeAction(action, baseContext)

        expect(result.success).toBe(true)
        expect(result.result).toEqual({
          type: 'NOTIFY',
          recipients: ['supervisor@example.com', 'manager@example.com'],
          subject: 'Work Order Update',
          message: 'Work order status changed',
          template: 'work_order_notification',
        })
      })

      it('should interpolate subject and message', async () => {
        const action: Action = {
          type: 'NOTIFY',
          config: {
            recipients: ['supervisor@example.com'],
            subject: 'Work Order {{data.workOrderNumber}}',
            message: 'Status changed to {{data.status}}',
          },
        }

        const result = await executeAction(action, baseContext)

        expect((result.result as NotifyResult)!.subject).toBe('Work Order WO-12345')
        expect((result.result as NotifyResult)!.message).toBe('Status changed to RELEASED')
      })

      it('should throw error if recipients array is empty', async () => {
        const action: Action = {
          type: 'NOTIFY',
          config: {
            message: 'Notification',
          },
        }

        const result = await executeAction(action, baseContext)

        expect(result.success).toBe(false)
        expect(result.error).toContain('at least one recipient')
      })

      it('should throw error if recipients is not an array', async () => {
        const action: Action = {
          type: 'NOTIFY',
          config: {
            recipients: 'not-an-array',
            message: 'Notification',
          },
        }

        const result = await executeAction(action, baseContext)

        expect(result.success).toBe(false)
        expect(result.error).toContain('recipients to be an array')
      })
    })

    describe('SET_FIELD', () => {
      it('should execute SET_FIELD action', async () => {
        const action: Action = {
          type: 'SET_FIELD',
          config: {
            field: 'assignedTo',
            value: 'user-456',
          },
        }

        const result = await executeAction(action, baseContext)

        expect(result.success).toBe(true)
        expect(result.result).toEqual({
          type: 'SET_FIELD',
          field: 'assignedTo',
          value: 'user-456',
        })
      })

      it('should resolve special values', async () => {
        const action: Action = {
          type: 'SET_FIELD',
          config: {
            field: 'assignedAt',
            value: '{{now}}',
          },
        }

        const result = await executeAction(action, baseContext)

        expect((result.result as SetFieldResult)!.field).toBe('assignedAt')
        expect((result.result as SetFieldResult)!.value).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      })

      it('should throw error if field is not provided', async () => {
        const action: Action = {
          type: 'SET_FIELD',
          config: {
            value: 'some-value',
          },
        }

        const result = await executeAction(action, baseContext)

        expect(result.success).toBe(false)
        expect(result.error).toContain('requires a field name')
      })

      it('should throw error if field is empty string', async () => {
        const action: Action = {
          type: 'SET_FIELD',
          config: {
            field: '   ',
            value: 'some-value',
          },
        }

        const result = await executeAction(action, baseContext)

        expect(result.success).toBe(false)
        expect(result.error).toContain('non-empty field name')
      })
    })

    describe('CALL_WEBHOOK', () => {
      it('should execute CALL_WEBHOOK action', async () => {
        const action: Action = {
          type: 'CALL_WEBHOOK',
          config: {
            url: 'https://api.example.com/webhook',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: {
              event: 'work_order_updated',
            },
          },
        }

        const result = await executeAction(action, baseContext)

        expect(result.success).toBe(true)
        expect(result.result).toEqual({
          type: 'CALL_WEBHOOK',
          url: 'https://api.example.com/webhook',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: {
            event: 'work_order_updated',
          },
          status: 'pending',
        })
      })

      it('should default to POST method', async () => {
        const action: Action = {
          type: 'CALL_WEBHOOK',
          config: {
            url: 'https://api.example.com/webhook',
          },
        }

        const result = await executeAction(action, baseContext)

        expect((result.result as CallWebhookResult)!.method).toBe('POST')
      })

      it('should interpolate URL', async () => {
        const action: Action = {
          type: 'CALL_WEBHOOK',
          config: {
            url: 'https://api.example.com/webhook/{{entityId}}',
          },
        }

        const result = await executeAction(action, baseContext)

        expect((result.result as CallWebhookResult)!.url).toBe('https://api.example.com/webhook/wo-001')
      })

      it('should throw error if URL is empty', async () => {
        const action: Action = {
          type: 'CALL_WEBHOOK',
          config: {
            url: '',
          },
        }

        const result = await executeAction(action, baseContext)

        expect(result.success).toBe(false)
        expect(result.error).toContain('non-empty URL')
      })

      it('should throw error if HTTP method is invalid', async () => {
        const action: Action = {
          type: 'CALL_WEBHOOK',
          config: {
            url: 'https://api.example.com/webhook',
            method: 'INVALID',
          },
        }

        const result = await executeAction(action, baseContext)

        expect(result.success).toBe(false)
        expect(result.error).toContain('valid HTTP method')
      })

      it('should normalize HTTP method to uppercase', async () => {
        const action: Action = {
          type: 'CALL_WEBHOOK',
          config: {
            url: 'https://api.example.com/webhook',
            method: 'get',
          },
        }

        const result = await executeAction(action, baseContext)

        expect(result.success).toBe(true)
        expect((result.result as CallWebhookResult)!.method).toBe('GET')
      })
    })

    describe('EMIT_EVENT', () => {
      it('should execute EMIT_EVENT action', async () => {
        const action: Action = {
          type: 'EMIT_EVENT',
          config: {
            event: 'work_order.status_changed',
            payload: {
              workOrderId: 'wo-001',
              newStatus: 'RELEASED',
            },
          },
        }

        const result = await executeAction(action, baseContext)

        expect(result.success).toBe(true)
        expect(result.result).toEqual({
          type: 'EMIT_EVENT',
          event: 'work_order.status_changed',
          payload: {
            workOrderId: 'wo-001',
            newStatus: 'RELEASED',
          },
        })
      })

      it('should throw error if event name is not provided', async () => {
        const action: Action = {
          type: 'EMIT_EVENT',
          config: {
            payload: {},
          },
        }

        const result = await executeAction(action, baseContext)

        expect(result.success).toBe(false)
        expect(result.error).toContain('requires an event name')
      })

      it('should throw error if event name is empty string', async () => {
        const action: Action = {
          type: 'EMIT_EVENT',
          config: {
            event: '   ',
            payload: {},
          },
        }

        const result = await executeAction(action, baseContext)

        expect(result.success).toBe(false)
        expect(result.error).toContain('non-empty event name')
      })
    })

    describe('Unknown action type', () => {
      it('should handle unknown action type', async () => {
        const action: Action = {
          type: 'UNKNOWN_ACTION',
        }

        const result = await executeAction(action, baseContext)

        expect(result.success).toBe(false)
        expect(result.error).toContain('Unknown action type')
      })
    })
  })

  describe('executeActions', () => {
    it('should execute multiple actions in sequence', async () => {
      const actions: Action[] = [
        {
          type: 'LOG',
          config: {
            message: 'First action',
          },
        },
        {
          type: 'ALLOW_TRANSITION',
          config: {
            message: 'Allowed',
          },
        },
        {
          type: 'NOTIFY',
          config: {
            recipients: ['user@example.com'],
            message: 'Notification',
          },
        },
      ]

      const outcome = await executeActions(actions, baseContext)

      expect(outcome.success).toBe(true)
      expect(outcome.results).toHaveLength(3)
      expect(outcome.results.every((r) => r.success)).toBe(true)
      expect(outcome.totalTime).toBeGreaterThanOrEqual(0)
      expect(outcome.errors).toBeUndefined()
    })

    it('should continue execution even if one action fails', async () => {
      const actions: Action[] = [
        {
          type: 'LOG',
          config: {
            message: 'First action',
          },
        },
        {
          type: 'SET_FIELD',
          config: {
            // Missing field - will fail
            value: 'some-value',
          },
        },
        {
          type: 'LOG',
          config: {
            message: 'Third action',
          },
        },
      ]

      const outcome = await executeActions(actions, baseContext)

      expect(outcome.success).toBe(false)
      expect(outcome.results).toHaveLength(3)
      expect(outcome.results[0].success).toBe(true)
      expect(outcome.results[1].success).toBe(false)
      expect(outcome.results[2].success).toBe(true)
      expect(outcome.errors).toBeDefined()
      expect(outcome.errors).toHaveLength(1)
    })

    it('should collect errors from all failed actions', async () => {
      const actions: Action[] = [
        {
          type: 'UNKNOWN_ACTION_1',
        },
        {
          type: 'UNKNOWN_ACTION_2',
        },
      ]

      const outcome = await executeActions(actions, baseContext)

      expect(outcome.success).toBe(false)
      expect(outcome.errors).toHaveLength(2)
      expect(outcome.errors?.[0]).toContain('UNKNOWN_ACTION_1')
      expect(outcome.errors?.[1]).toContain('UNKNOWN_ACTION_2')
    })

    it('should handle empty actions array', async () => {
      const outcome = await executeActions([], baseContext)

      expect(outcome.success).toBe(true)
      expect(outcome.results).toHaveLength(0)
      expect(outcome.totalTime).toBeGreaterThanOrEqual(0)
    })
  })

  describe('interpolateMessage', () => {
    it('should interpolate single variable', () => {
      const result = interpolateMessage('Hello {{user.email}}', baseContext)
      expect(result).toBe('Hello test@example.com')
    })

    it('should interpolate multiple variables', () => {
      const result = interpolateMessage(
        'User {{user.email}} updated {{data.workOrderNumber}}',
        baseContext
      )
      expect(result).toBe('User test@example.com updated WO-12345')
    })

    it('should interpolate nested paths', () => {
      const result = interpolateMessage('Work order status: {{data.status}}', baseContext)
      expect(result).toBe('Work order status: RELEASED')
    })

    it('should handle special values', () => {
      const result = interpolateMessage('Today is {{today}}', baseContext)
      expect(result).toMatch(/^Today is \d{4}-\d{2}-\d{2}$/)
    })

    it('should preserve template if value not found', () => {
      const result = interpolateMessage('Value: {{nonexistent.field}}', baseContext)
      expect(result).toBe('Value: {{nonexistent.field}}')
    })

    it('should handle multiple occurrences of same variable', () => {
      const result = interpolateMessage(
        '{{user.email}} - {{user.email}}',
        baseContext
      )
      expect(result).toBe('test@example.com - test@example.com')
    })

    it('should handle empty template', () => {
      const result = interpolateMessage('', baseContext)
      expect(result).toBe('')
    })

    it('should handle template with no variables', () => {
      const result = interpolateMessage('Static message', baseContext)
      expect(result).toBe('Static message')
    })

    it('should handle whitespace in variable names', () => {
      const result = interpolateMessage('User: {{ user.email }}', baseContext)
      expect(result).toBe('User: test@example.com')
    })

    it('should convert non-string values to strings', () => {
      const contextWithNumbers = {
        ...baseContext,
        data: {
          ...baseContext.data,
          quantity: 42,
        },
      }

      const result = interpolateMessage('Quantity: {{data.quantity}}', contextWithNumbers)
      expect(result).toBe('Quantity: 42')
    })

    it('should handle null and undefined gracefully', () => {
      const contextWithNulls = {
        ...baseContext,
        data: {
          nullValue: null,
          undefinedValue: undefined,
        },
      }

      const result1 = interpolateMessage('Value: {{data.nullValue}}', contextWithNulls)
      expect(result1).toBe('Value: {{data.nullValue}}')

      const result2 = interpolateMessage('Value: {{data.undefinedValue}}', contextWithNulls)
      expect(result2).toBe('Value: {{data.undefinedValue}}')
    })
  })
})
