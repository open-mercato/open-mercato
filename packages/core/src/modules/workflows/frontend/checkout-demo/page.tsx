'use client'

import { useState, useEffect } from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'

interface CartItem {
  id: string // Product UUID
  name: string
  price: number
  quantity: number
}

interface Product {
  id: string
  title: string
  pricing: {
    unit_price_gross: number
    unit_price_net: number
    currency_code: string
    price_kind_code?: string
  } | null
}

interface WorkflowResult {
  instanceId: string
  status: string
  workflowId: string
  currentStepId?: string
  context?: any
}

interface StepInfo {
  stepId: string
  stepName: string
  stepType: string
  description?: string
}

interface WorkflowEvent {
  id: string
  eventType: string
  occurredAt: string
  eventData?: any
}

export default function CheckoutDemoPage() {
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [result, setResult] = useState<WorkflowResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState<StepInfo | null>(null)
  const [availableSteps, setAvailableSteps] = useState<StepInfo[]>([])
  const [formData, setFormData] = useState<Record<string, any>>({})
  const [submittingTask, setSubmittingTask] = useState(false)
  const [taskError, setTaskError] = useState<string | null>(null)
  const [sendingSignal, setSendingSignal] = useState(false)
  const [signalError, setSignalError] = useState<string | null>(null)
  const [enableTaskPolling, setEnableTaskPolling] = useState(false)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('')
  const [selectedCurrency, setSelectedCurrency] = useState<string>('USD')
  const [cart, setCart] = useState<CartItem[]>([])

  // Poll workflow instance for real-time status updates
  const { data: instanceData } = useQuery({
    queryKey: ['workflow-instance', result?.instanceId],
    queryFn: async () => {
      if (!result?.instanceId) return null

      const response = await fetch(`/api/workflows/instances/${result.instanceId}`)
      if (!response.ok) return null

      const json = await response.json()
      return json.data // API returns { data: instance }
    },
    enabled: !!result?.instanceId,
    refetchInterval: (query) => {
      // Poll while workflow is active (not completed, failed, or cancelled)
      const status = query.state.data?.status || result?.status
      return (status === 'RUNNING' || status === 'PAUSED' || status === 'WAITING_FOR_ACTIVITIES') ? 500 : false
    },
  })

  // Update result when instance data changes
  useEffect(() => {
    if (instanceData) {
      setResult({
        instanceId: instanceData.id,
        status: instanceData.status,
        workflowId: instanceData.workflowId,
        currentStepId: instanceData.currentStepId,
        context: instanceData.context,
      })
    }
  }, [instanceData])

  // Fetch workflow events for the current instance
  const { data: events = [] } = useQuery({
    queryKey: ['workflow-events', result?.instanceId],
    queryFn: async () => {
      if (!result?.instanceId) return []

      const response = await fetch(
        `/api/workflows/events?workflowInstanceId=${result.instanceId}&sortField=occurredAt&sortDir=desc&pageSize=20`
      )

      if (!response.ok) return []

      const data = await response.json()
      return data.items || []
    },
    enabled: !!result?.instanceId,
    refetchInterval: (query) => {
      // Poll while workflow is active
      const status = instanceData?.status || result?.status
      return (status === 'RUNNING' || status === 'PAUSED' || status === 'WAITING_FOR_ACTIVITIES') ? 1000 : false
    },
  })

  // Fetch pending user tasks for this workflow instance
  const { data: userTasks = [], isLoading: tasksLoading, error: tasksError, refetch: refetchTasks } = useQuery({
    queryKey: ['workflow-user-tasks', result?.instanceId],
    queryFn: async () => {
      if (!result?.instanceId) return []

      const response = await fetch(
        `/api/workflows/tasks?workflowInstanceId=${result.instanceId}&status=PENDING`
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        console.error('[UserTasks] Error response:', errorData)
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }

      const data = await response.json()
      return data.data || []
    },
    enabled: !!result?.instanceId && result?.status === 'PAUSED' && enableTaskPolling,
    refetchInterval: result?.status === 'PAUSED' && enableTaskPolling ? 2000 : false,
  })

  // Fetch workflow definition to get dynamic steps
  const { data: workflowDefinition } = useQuery({
    queryKey: ['workflow-definition', 'checkout_simple_v1'],
    queryFn: async () => {
      const response = await fetch('/api/workflows/definitions?workflowId=checkout_simple_v1')
      if (!response.ok) return null
      const json = await response.json()
      return json.data?.[0] || null
    },
  })

  // Fetch customers for dropdown
  const { data: customers = [], isLoading: customersLoading } = useQuery({
    queryKey: ['customers-companies'],
    queryFn: async () => {
      const response = await fetch('/api/customers/companies?pageSize=100')
      if (!response.ok) return []
      const json = await response.json()
      return json.items || []
    },
  })

  // Fetch products for cart selection with pricing context
  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ['catalog-products', selectedCurrency],
    queryFn: async () => {
      // Pass pricing context to get resolved prices
      const params = new URLSearchParams({
        pageSize: '100',
        quantity: '1',
        priceDate: new Date().toISOString(),
      })

      const response = await fetch(`/api/catalog/products?${params}`)
      if (!response.ok) return []
      const json = await response.json()
      return json.items || []
    },
  })

  // Auto-populate cart with first 3 products when products load (for demo convenience)
  useEffect(() => {
    if (products.length > 0 && cart.length === 0) {
      const initialCart: CartItem[] = products.slice(0, 3).map((product: any) => ({
        id: product.id,
        name: product.title || product.display_name || 'Untitled Product',
        // Use resolved pricing from catalog pricing service (in USD)
        price: product.pricing?.unit_price_gross || product.pricing?.unit_price_net || 99.99,
        quantity: 1,
      }))
      setCart(initialCart)
    }
  }, [products, cart.length])

  // Exchange rates (USD base)
  const exchangeRates: Record<string, number> = {
    USD: 1,
    EUR: 0.92,
    GBP: 0.79,
    PLN: 4.02,
  }

  // Currency symbols
  const currencySymbols: Record<string, string> = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    PLN: 'zł',
  }

  // Cart management functions
  const addToCart = (product: Product) => {
    const existing = cart.find(item => item.id === product.id)
    if (existing) {
      setCart(cart.map(item =>
        item.id === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ))
    } else {
      setCart([...cart, {
        id: product.id,
        name: product.title,
        // Use resolved pricing from catalog pricing service (in USD)
        price: product.pricing?.unit_price_gross || product.pricing?.unit_price_net || 99.99,
        quantity: 1,
      }])
    }
  }

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      setCart(cart.filter(item => item.id !== productId))
    } else {
      setCart(cart.map(item =>
        item.id === productId ? { ...item, quantity } : item
      ))
    }
  }

  const removeFromCart = (productId: string) => {
    setCart(cart.filter(item => item.id !== productId))
  }

  // Convert prices to selected currency (cart items are in USD by default)
  const exchangeRate = exchangeRates[selectedCurrency] || 1
  const demoCart = cart.map(item => ({
    ...item,
    price: item.price * exchangeRate,
  }))

  const currencySymbol = currencySymbols[selectedCurrency] || selectedCurrency

  const subtotal = demoCart.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const tax = subtotal * 0.08 // 8% tax
  const shipping = 9.99 * exchangeRate
  const total = subtotal + tax + shipping

  // Workflow steps for UI - use dynamic definition or fallback
  const workflowSteps: StepInfo[] = workflowDefinition?.definition?.steps || [
    { stepId: 'start', stepName: 'Start', stepType: 'START', description: 'Workflow initiated' },
    { stepId: 'cart_validation', stepName: 'Cart Validation', stepType: 'AUTOMATED', description: 'Validate cart and reserve inventory' },
    { stepId: 'customer_info', stepName: 'Customer Information', stepType: 'USER_TASK', description: 'Collect customer shipping and contact information' },
    { stepId: 'payment_initiation', stepName: 'Initiate Payment', stepType: 'AUTOMATED', description: 'Send payment request to provider' },
    { stepId: 'wait_payment_confirmation', stepName: 'Wait for Payment Confirmation', stepType: 'WAIT_FOR_SIGNAL', description: 'Waiting for payment provider webhook' },
    { stepId: 'order_confirmation', stepName: 'Order Confirmation', stepType: 'AUTOMATED', description: 'Create order and send confirmation' },
    { stepId: 'end', stepName: 'Complete', stepType: 'END', description: 'Checkout completed' },
  ]

  // Update current step and available steps when result changes
  useEffect(() => {
    if (result?.currentStepId) {
      const current = workflowSteps.find(s => s.stepId === result.currentStepId)
      setCurrentStep(current || null)

      // Find next available steps (simple - just show next step)
      const currentIndex = workflowSteps.findIndex(s => s.stepId === result.currentStepId)
      if (currentIndex >= 0 && currentIndex < workflowSteps.length - 1) {
        setAvailableSteps([workflowSteps[currentIndex + 1]])
      } else {
        setAvailableSteps([])
      }
    }
  }, [result])

  // Add initial delay before polling for user tasks when workflow becomes PAUSED
  // This reduces race condition where API returns before background execution completes
  useEffect(() => {
    if (result?.status === 'PAUSED') {
      setEnableTaskPolling(false)

      const timer = setTimeout(() => {
        setEnableTaskPolling(true)
      }, 500)

      return () => clearTimeout(timer)
    } else {
      setEnableTaskPolling(false)
    }
  }, [result?.status])

  const handleCheckout = async () => {
    // Validate customer selection
    if (!selectedCustomerId) {
      setError('Please select a customer before starting checkout')
      return
    }

    // Validate cart has items
    if (cart.length === 0) {
      setError('Please add at least one product to your cart')
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      // Build the initial context
      const initialContext = {
        customerId: selectedCustomerId,
        cartId: `cart-${Date.now()}`,
        currency: selectedCurrency,
        cart: {
          id: `cart-${Date.now()}`,
          items: demoCart,
          orderLines: demoCart.map(item => ({
            quantity: item.quantity,
            currencyCode: selectedCurrency || 'USD', // Ensure currency is always set
            kind: 'product' as const,
            productId: item.id,
            lineDescription: item.name,
            unitPriceGross: item.price,
          })),
          itemCount: demoCart.reduce((sum, item) => sum + item.quantity, 0),
          subtotal: subtotal,
          tax: tax,
          shipping: shipping,
          total: total,
          currency: selectedCurrency,
        },
        customer: {
          id: selectedCustomerId,
          name: 'Demo Customer',
          email: 'demo@example.com',
        },
        payment: {
          id: `payment-${Date.now()}`,
          methodId: 'pm_demo_visa',
          method: 'Credit Card',
          last4: '4242',
        },
      }

      // Start the checkout workflow
      const response = await fetch('/api/workflows/instances', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflowId: 'checkout_simple_v1',
          version: 1,
          correlationKey: `DEMO-ORDER-${Date.now()}`,
          initialContext,
          metadata: {
            source: 'checkout-demo',
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString(),
          },
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        const errorMsg = errorData.error || 'Failed to start checkout workflow'

        if (response.status === 404 && errorMsg.includes('Workflow definition not found')) {
          throw new Error(
            'Workflow not found. Please ensure:\n' +
            '1. You have seeded the demo workflow (see instructions below)\n' +
            '2. You are logged in with the same tenant/organization used when seeding\n' +
            '3. The workflow is enabled in the database'
          )
        }

        if (response.status === 401) {
          throw new Error('Please log in to start a workflow')
        }

        if (response.status === 403) {
          throw new Error('You do not have permission to start workflows. Please contact your administrator.')
        }

        throw new Error(errorMsg)
      }

      const data = await response.json()

      setResult({
        instanceId: data.data.instance.id,
        status: data.data.instance.status,
        workflowId: data.data.instance.workflowId,
        currentStepId: data.data.instance.currentStepId,
        context: data.data.instance.context,
      })
    } catch (err) {
      console.error('Checkout error:', err)
      setError(err instanceof Error ? err.message : 'An error occurred during checkout')
    } finally {
      setLoading(false)
    }
  }

  const handleAdvance = async (toStepId?: string) => {
    if (!result?.instanceId) return

    setAdvancing(true)
    setError(null)

    try {
      const response = await fetch(`/api/workflows/instances/${result.instanceId}/advance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          toStepId,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to advance workflow')
      }

      const data = await response.json()

      // Update result with new state
      setResult({
        instanceId: data.data.instance.id,
        status: data.data.instance.status,
        workflowId: result.workflowId,
        currentStepId: data.data.instance.currentStepId,
        context: data.data.instance.context,
      })
    } catch (err) {
      console.error('Advance error:', err)
      setError(err instanceof Error ? err.message : 'Failed to advance workflow')
    } finally {
      setAdvancing(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'RUNNING':
        return 'text-blue-600 dark:text-blue-400 bg-blue-50'
      case 'WAITING_FOR_ACTIVITIES':
        return 'text-purple-600 bg-purple-50'
      case 'PAUSED':
        return 'text-yellow-600 bg-yellow-50'
      case 'COMPLETED':
        return 'text-green-600 bg-green-50'
      case 'FAILED':
        return 'text-red-600 bg-red-50'
      default:
        return 'text-muted-foreground bg-muted'
    }
  }

  const getStepStatus = (stepId: string) => {
    if (!result?.currentStepId) return 'pending'

    const currentIndex = workflowSteps.findIndex(s => s.stepId === result.currentStepId)
    const stepIndex = workflowSteps.findIndex(s => s.stepId === stepId)

    if (currentIndex === -1 || stepIndex === -1) return 'pending'

    if (stepIndex < currentIndex) return 'completed'
    if (stepIndex === currentIndex) {
      // If workflow is paused at this step, show it as paused
      return result.status === 'PAUSED' ? 'paused' : 'current'
    }
    return 'pending'
  }

  const getStepColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-600 border-green-300'
      case 'current':
        return 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 border-blue-300'
      case 'paused':
        return 'bg-yellow-100 text-yellow-600 border-yellow-300'
      default:
        return 'bg-muted text-muted-foreground border-border'
    }
  }

  const getEventTypeBadgeClass = (eventType: string) => {
    if (eventType.includes('STARTED')) return 'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200'
    if (eventType.includes('COMPLETED')) return 'bg-green-100 text-green-800'
    if (eventType.includes('FAILED') || eventType.includes('REJECTED')) return 'bg-red-100 text-red-800'
    if (eventType.includes('CANCELLED')) return 'bg-muted text-foreground'
    if (eventType.includes('ENTERED') || eventType.includes('EXITED')) return 'bg-purple-100 text-purple-800'
    return 'bg-muted text-foreground'
  }

  const formatEventType = (eventType: string) => {
    return eventType.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
  }

  const handleFieldChange = (fieldName: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [fieldName]: value,
    }))
  }

  const handleSendPaymentSignal = async () => {
    if (!result?.instanceId) {
      setSignalError('No workflow instance found')
      return
    }

    // Check if workflow is in the correct step
    if (result.currentStepId !== 'wait_payment_confirmation') {
      setSignalError(`Cannot send signal: workflow is at step "${result.currentStepId}", expected "wait_payment_confirmation"`)
      return
    }

    setSendingSignal(true)
    setSignalError(null)

    try {
      const signalUrl = `/api/workflows/instances/${result.instanceId}/signal`

      const requestPayload = {
        signalName: 'payment_confirmed',
        payload: {
          paymentStatus: 'success',
          transactionId: `txn_${Date.now()}`,
          confirmedAt: new Date().toISOString(),
          provider: 'StripeSimulator',
        },
      }

      const response = await fetch(signalUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
      })

      // Read response as text first to handle non-JSON responses
      const responseText = await response.text()

      if (!response.ok) {
        let errorData: any = {}
        let isJson = false

        try {
          errorData = JSON.parse(responseText)
          isJson = true
        } catch (parseError) {
          console.error('[Signal] Response is not JSON:', parseError)
          console.error('[Signal] Raw response:', responseText)
        }

        const errorMsg = isJson && errorData.error
          ? errorData.error
          : `HTTP ${response.status}: ${responseText.substring(0, 200) || 'Failed to send signal'}`
        throw new Error(errorMsg)
      }

      // Parse success response
      let data: any
      try {
        data = JSON.parse(responseText)
      } catch (parseError) {
        data = { success: true }
      }

      // Invalidate queries to force refresh
      await queryClient.invalidateQueries({ queryKey: ['workflow-instance', result?.instanceId] })
      await queryClient.invalidateQueries({ queryKey: ['workflow-events', result?.instanceId] })

      // Clear any previous errors
      setSignalError(null)
    } catch (err) {
      console.error('[Signal] Error:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to send payment confirmation'
      setSignalError(errorMessage)
    } finally {
      setSendingSignal(false)
    }
  }

  const handleTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!userTasks || userTasks.length === 0) return

    const task = userTasks[0]

    // Validate required fields
    if (task.formSchema?.required) {
      for (const requiredField of task.formSchema.required) {
        if (!formData[requiredField] || formData[requiredField] === '') {
          setTaskError(`Required field is missing: ${requiredField}`)
          return
        }
      }
    }

    setSubmittingTask(true)
    setTaskError(null)

    try {
      const response = await fetch(`/api/workflows/tasks/${task.id}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          formData,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to complete task')
      }

      // Reset form
      setFormData({})
      setTaskError(null)

      // Invalidate all workflow-related queries to force immediate refresh
      await queryClient.invalidateQueries({ queryKey: ['workflow-instance', result?.instanceId] })
      await queryClient.invalidateQueries({ queryKey: ['workflow-user-tasks', result?.instanceId] })
      await queryClient.invalidateQueries({ queryKey: ['workflow-events', result?.instanceId] })
    } catch (err) {
      console.error('Error completing task:', err)
      setTaskError(err instanceof Error ? err.message : 'Failed to complete task')
    } finally {
      setSubmittingTask(false)
    }
  }

  const renderFormField = (fieldName: string, fieldSchema: any, required: boolean) => {
    const fieldType = fieldSchema.type || 'string'
    const fieldTitle = fieldSchema.title || fieldName
    const fieldDescription = fieldSchema.description
    const enumValues = fieldSchema.enum

    const inputClasses = "w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-yellow-500 text-sm"
    const labelClasses = "block text-sm font-medium text-foreground mb-1"

    // Handle enum (select dropdown)
    if (enumValues && Array.isArray(enumValues)) {
      return (
        <div key={fieldName} className="space-y-1">
          <label htmlFor={fieldName} className={labelClasses}>
            {fieldTitle}
            {required && <span className="text-red-600 ml-1">*</span>}
          </label>
          {fieldDescription && (
            <p className="text-xs text-muted-foreground mb-1">{fieldDescription}</p>
          )}
          <select
            id={fieldName}
            value={formData[fieldName] || ''}
            onChange={(e) => handleFieldChange(fieldName, e.target.value)}
            required={required}
            className={inputClasses}
          >
            <option value="">-- Select an option --</option>
            {enumValues.map((value: any) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      )
    }

    // Handle different field types
    switch (fieldType) {
      case 'string':
        if (fieldSchema.format === 'email') {
          return (
            <div key={fieldName} className="space-y-1">
              <label htmlFor={fieldName} className={labelClasses}>
                {fieldTitle}
                {required && <span className="text-red-600 ml-1">*</span>}
              </label>
              {fieldDescription && (
                <p className="text-xs text-muted-foreground mb-1">{fieldDescription}</p>
              )}
              <input
                type="email"
                id={fieldName}
                value={formData[fieldName] || ''}
                onChange={(e) => handleFieldChange(fieldName, e.target.value)}
                required={required}
                className={inputClasses}
              />
            </div>
          )
        }
        if (fieldSchema.format === 'date') {
          return (
            <div key={fieldName} className="space-y-1">
              <label htmlFor={fieldName} className={labelClasses}>
                {fieldTitle}
                {required && <span className="text-red-600 ml-1">*</span>}
              </label>
              {fieldDescription && (
                <p className="text-xs text-muted-foreground mb-1">{fieldDescription}</p>
              )}
              <input
                type="date"
                id={fieldName}
                value={formData[fieldName] || ''}
                onChange={(e) => handleFieldChange(fieldName, e.target.value)}
                required={required}
                className={inputClasses}
              />
            </div>
          )
        }
        if (fieldSchema.maxLength && fieldSchema.maxLength > 200) {
          return (
            <div key={fieldName} className="space-y-1">
              <label htmlFor={fieldName} className={labelClasses}>
                {fieldTitle}
                {required && <span className="text-red-600 ml-1">*</span>}
              </label>
              {fieldDescription && (
                <p className="text-xs text-muted-foreground mb-1">{fieldDescription}</p>
              )}
              <textarea
                id={fieldName}
                value={formData[fieldName] || ''}
                onChange={(e) => handleFieldChange(fieldName, e.target.value)}
                required={required}
                rows={3}
                className={inputClasses}
              />
            </div>
          )
        }
        return (
          <div key={fieldName} className="space-y-1">
            <label htmlFor={fieldName} className={labelClasses}>
              {fieldTitle}
              {required && <span className="text-red-600 ml-1">*</span>}
            </label>
            {fieldDescription && (
              <p className="text-xs text-muted-foreground mb-1">{fieldDescription}</p>
            )}
            <input
              type="text"
              id={fieldName}
              value={formData[fieldName] || ''}
              onChange={(e) => handleFieldChange(fieldName, e.target.value)}
              required={required}
              className={inputClasses}
            />
          </div>
        )

      case 'number':
      case 'integer':
        return (
          <div key={fieldName} className="space-y-1">
            <label htmlFor={fieldName} className={labelClasses}>
              {fieldTitle}
              {required && <span className="text-red-600 ml-1">*</span>}
            </label>
            {fieldDescription && (
              <p className="text-xs text-muted-foreground mb-1">{fieldDescription}</p>
            )}
            <input
              type="number"
              id={fieldName}
              value={formData[fieldName] || ''}
              onChange={(e) => handleFieldChange(fieldName, e.target.value ? Number(e.target.value) : '')}
              required={required}
              step={fieldType === 'integer' ? 1 : 'any'}
              className={inputClasses}
            />
          </div>
        )

      case 'boolean':
        return (
          <div key={fieldName} className="space-y-1">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id={fieldName}
                checked={!!formData[fieldName]}
                onChange={(e) => handleFieldChange(fieldName, e.target.checked)}
                className="w-4 h-4 text-yellow-600 border-border rounded focus:ring-yellow-500"
              />
              <label htmlFor={fieldName} className="text-sm font-medium text-foreground">
                {fieldTitle}
                {required && <span className="text-red-600 ml-1">*</span>}
              </label>
            </div>
            {fieldDescription && (
              <p className="text-xs text-muted-foreground ml-6">{fieldDescription}</p>
            )}
          </div>
        )

      default:
        return (
          <div key={fieldName} className="space-y-1">
            <label htmlFor={fieldName} className={labelClasses}>
              {fieldTitle}
              {required && <span className="text-red-600 ml-1">*</span>}
            </label>
            {fieldDescription && (
              <p className="text-xs text-muted-foreground mb-1">{fieldDescription}</p>
            )}
            <input
              type="text"
              id={fieldName}
              value={formData[fieldName] || ''}
              onChange={(e) => handleFieldChange(fieldName, e.target.value)}
              required={required}
              className={inputClasses}
            />
          </div>
        )
    }
  }

  return (
    <div className="min-h-screen bg-muted py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Checkout Demo with Payment Webhooks</h1>
          <p className="text-muted-foreground">
            Interactive workflow demonstration featuring signal-based payment confirmation (WAIT_FOR_SIGNAL)
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Interactive Left Panel - Changes based on workflow step */}
          <div className="bg-card shadow rounded-lg p-6">
            {/* Initial State - Cart Summary */}
            {!result && (
              <>
                {/* Customer Selection */}
                <div className="mb-6 pb-6 border-b border-border">
                  <label htmlFor="customer-select" className="block text-sm font-medium text-foreground mb-2">
                    Select Customer <span className="text-red-600">*</span>
                  </label>
                  {customersLoading ? (
                    <div className="flex items-center justify-center py-3 text-sm text-muted-foreground">
                      <div className="inline-block w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mr-2"></div>
                      Loading customers...
                    </div>
                  ) : customers.length === 0 ? (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                      No customers found. Please create a customer first.
                    </div>
                  ) : (
                    <>
                      <select
                        id="customer-select"
                        value={selectedCustomerId}
                        onChange={(e) => setSelectedCustomerId(e.target.value)}
                        className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      >
                        <option value="">-- Select a customer --</option>
                        {customers.map((customer: any) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.display_name || customer.id}
                          </option>
                        ))}
                      </select>
                      <div className="mt-2">
                        <label htmlFor="currency-select" className="block text-xs font-medium text-muted-foreground mb-1">
                          Currency
                        </label>
                        <select
                          id="currency-select"
                          value={selectedCurrency}
                          onChange={(e) => setSelectedCurrency(e.target.value)}
                          className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        >
                          <option value="USD">USD - US Dollar</option>
                          <option value="EUR">EUR - Euro</option>
                          <option value="GBP">GBP - British Pound</option>
                          <option value="PLN">PLN - Polish Zloty</option>
                        </select>
                      </div>
                    </>
                  )}
                </div>

                {/* Product Selection */}
                <div className="mb-6 pb-6 border-b border-border">
                  <label htmlFor="product-select" className="block text-sm font-medium text-foreground mb-2">
                    Add Products to Cart
                  </label>
                  {productsLoading ? (
                    <div className="flex items-center justify-center py-3 text-sm text-muted-foreground">
                      <div className="inline-block w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mr-2"></div>
                      Loading products...
                    </div>
                  ) : products.length === 0 ? (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                      No products found. Please create products in the catalog first.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <select
                        id="product-select"
                        onChange={(e) => {
                          const product = products.find((p: any) => p.id === e.target.value)
                          if (product) {
                            addToCart({
                              id: product.id,
                              title: product.title || product.display_name || 'Untitled Product',
                              pricing: product.pricing || null,
                            })
                            e.target.value = '' // Reset selection
                          }
                        }}
                        className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        value=""
                      >
                        <option value="">-- Select a product to add --</option>
                        {products.map((product: any) => {
                          const basePrice = product.pricing?.unit_price_gross || product.pricing?.unit_price_net || 99.99
                          const displayPrice = (basePrice * exchangeRate).toFixed(2)
                          return (
                            <option key={product.id} value={product.id}>
                              {product.title || product.display_name || 'Untitled'} - {currencySymbol}{displayPrice}
                            </option>
                          )
                        })}
                      </select>
                      {cart.length === 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Select products from the dropdown to add them to your cart
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <h2 className="text-xl font-semibold text-foreground mb-4">Order Summary</h2>

                {/* Cart Items */}
                {cart.length === 0 ? (
                  <div className="bg-muted border border-border rounded-lg p-6 text-center mb-6">
                    <p className="text-muted-foreground text-sm">Your cart is empty</p>
                    <p className="text-muted-foreground text-xs mt-1">Add products from the dropdown above</p>
                  </div>
                ) : (
                  <div className="space-y-4 mb-6">
                    {demoCart.map((item) => (
                      <div key={item.id} className="flex justify-between items-center gap-4 pb-3 border-b border-border last:border-0">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground truncate">{item.name}</p>
                          <p className="text-xs text-muted-foreground">{currencySymbol}{item.price.toFixed(2)} each</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => updateQuantity(item.id, item.quantity - 1)}
                            className="w-7 h-7 flex items-center justify-center rounded border border-border hover:bg-muted text-muted-foreground"
                          >
                            -
                          </button>
                          <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.id, item.quantity + 1)}
                            className="w-7 h-7 flex items-center justify-center rounded border border-border hover:bg-muted text-muted-foreground"
                          >
                            +
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-foreground min-w-[80px] text-right">
                            {currencySymbol}{(item.price * item.quantity).toFixed(2)}
                          </p>
                          <button
                            onClick={() => removeFromCart(item.id)}
                            className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-50 text-red-600"
                            title="Remove from cart"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Totals */}
                <div className="border-t border-border pt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="text-foreground">{currencySymbol}{subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Tax (8%)</span>
                    <span className="text-foreground">{currencySymbol}{tax.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Shipping</span>
                    <span className="text-foreground">{currencySymbol}{shipping.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-lg pt-2 border-t border-border">
                    <span className="text-foreground">Total</span>
                    <span className="text-foreground">{currencySymbol}{total.toFixed(2)}</span>
                  </div>
                </div>

                {/* Checkout Button */}
                <Button
                  onClick={handleCheckout}
                  disabled={loading || result !== null || !selectedCustomerId || customers.length === 0 || cart.length === 0}
                  className="w-full mt-6"
                  size="lg"
                >
                  {loading ? 'Starting...' : result ? 'Workflow Started' : !selectedCustomerId ? 'Select Customer to Continue' : cart.length === 0 ? 'Add Products to Continue' : 'Start Checkout Workflow'}
                </Button>
                {(!selectedCustomerId || cart.length === 0) && customers.length > 0 && (
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    {!selectedCustomerId ? 'Please select a customer to continue' : 'Please add products to your cart to continue'}
                  </p>
                )}
              </>
            )}

            {/* Cart Validation Step */}
            {result && (result.currentStepId === 'start' || result.currentStepId === 'cart_validation') && (
              <>
                <h2 className="text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 bg-blue-600 rounded-full animate-pulse"></span>
                  Validating Cart
                </h2>
                <div className="space-y-4">
                  {result.status === 'WAITING_FOR_ACTIVITIES' ? (
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                      <p className="text-sm text-purple-800 font-medium">Processing background activities...</p>
                      <p className="text-xs text-purple-700 mt-1">The workflow is waiting for async tasks to complete before proceeding.</p>
                    </div>
                  ) : (
                    <div className="bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                      <p className="text-sm text-blue-800 dark:text-blue-200">Checking cart items and inventory availability...</p>
                    </div>
                  )}
                  {demoCart.map((item) => (
                    <div key={item.id} className="flex justify-between items-center border-b border-border pb-2">
                      <div className="flex-1">
                        <p className="font-medium text-foreground">{item.name}</p>
                        <p className="text-xs text-muted-foreground">Qty: {item.quantity}</p>
                      </div>
                      <span className="text-green-600 text-sm">✓ Available</span>
                    </div>
                  ))}
                  <div className="pt-2 border-t border-border">
                    <p className="text-sm font-medium text-foreground">Total: {currencySymbol}{total.toFixed(2)}</p>
                  </div>
                </div>
              </>
            )}

            {/* Customer Information Step - USER_TASK */}
            {result && result.currentStepId === 'customer_info' && (
              <>
                <h2 className="text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 bg-yellow-600 rounded-full animate-pulse"></span>
                  Customer Information Required
                </h2>
                <div className="space-y-4">
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <p className="text-sm text-yellow-800 font-medium mb-2">
                      Please provide your shipping information
                    </p>
                    <p className="text-xs text-yellow-700">
                      The workflow is paused waiting for customer details. Complete the form to continue checkout.
                    </p>
                  </div>

                  {tasksError ? (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <p className="text-sm text-red-800 font-medium mb-2">
                        Error loading task
                      </p>
                      <p className="text-xs text-red-700 mb-3">
                        {tasksError instanceof Error ? tasksError.message : 'Unknown error'}
                      </p>
                      <Button
                        onClick={() => refetchTasks()}
                        size="sm"
                        variant="outline"
                        className="w-full"
                      >
                        Retry
                      </Button>
                    </div>
                  ) : tasksLoading ? (
                    <div className="bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                      <div className="flex items-center justify-center py-4">
                        <div className="inline-block w-8 h-8 border-4 border-yellow-600 border-t-transparent rounded-full animate-spin"></div>
                        <p className="ml-3 text-sm text-muted-foreground">Loading task...</p>
                      </div>
                    </div>
                  ) : userTasks.length > 0 ? (
                    <form onSubmit={handleTaskSubmit} className="bg-card border border-border rounded-lg p-4 space-y-4">
                      {taskError && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                          <p className="text-sm text-red-800">{taskError}</p>
                        </div>
                      )}

                      {userTasks[0].formSchema?.properties && (
                        <div className="space-y-3">
                          {Object.keys(userTasks[0].formSchema.properties).map((fieldName) => {
                            const required = userTasks[0].formSchema.required?.includes(fieldName) || false
                            return renderFormField(fieldName, userTasks[0].formSchema.properties[fieldName], required)
                          })}
                        </div>
                      )}

                      <div className="pt-3 border-t border-border">
                        <Button
                          type="submit"
                          disabled={submittingTask}
                          className="w-full bg-yellow-600 hover:bg-yellow-700 text-white font-medium"
                        >
                          {submittingTask ? 'Submitting...' : 'Complete & Continue Checkout'}
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                      <p className="text-sm text-orange-800 font-medium mb-2">
                        No task found
                      </p>
                      <p className="text-xs text-orange-700 mb-3">
                        The user task may still be creating. This usually takes less than a second.
                      </p>
                      <Button
                        onClick={() => refetchTasks()}
                        size="sm"
                        variant="outline"
                        className="w-full"
                      >
                        Refresh
                      </Button>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Payment Initiation Step */}
            {result && result.currentStepId === 'payment_initiation' && (
              <>
                <h2 className="text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 bg-blue-600 rounded-full animate-pulse"></span>
                  Initiating Payment
                </h2>
                <div className="space-y-6">
                  <div className="bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <p className="text-sm text-blue-800 dark:text-blue-200 font-medium mb-2">Payment Details</p>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Method:</span>
                        <span className="text-foreground">Credit Card ****4242</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Amount:</span>
                        <span className="text-foreground font-semibold">{currencySymbol}{total.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-center py-8">
                    <div className="text-center">
                      <div className="inline-block w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                      <p className="text-sm text-muted-foreground">Sending payment request...</p>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Wait for Payment Confirmation Step - SIGNAL */}
            {result && result.currentStepId === 'wait_payment_confirmation' && (
              <>
                <h2 className="text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 bg-yellow-600 rounded-full animate-pulse"></span>
                  Waiting for Payment Confirmation
                </h2>
                <div className="space-y-4">
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <p className="text-sm text-yellow-800 font-medium mb-2">
                      Awaiting Payment Provider Webhook
                    </p>
                    <p className="text-xs text-yellow-700 mb-3">
                      The workflow is paused waiting for the payment provider to confirm the transaction via webhook.
                      In production, this would be sent automatically by Stripe, PayPal, etc.
                    </p>
                    <div className="space-y-2 text-xs text-yellow-700">
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-1.5 h-1.5 bg-yellow-600 rounded-full"></span>
                        <span>Status: <strong>{result.status}</strong></span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-1.5 h-1.5 bg-yellow-600 rounded-full"></span>
                        <span>Signal Name: <code className="bg-yellow-100 px-1 py-0.5 rounded">payment_confirmed</code></span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-1.5 h-1.5 bg-yellow-600 rounded-full"></span>
                        <span>Timeout: 5 minutes</span>
                      </div>
                    </div>
                  </div>

                  {signalError && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <div className="flex items-start">
                        <svg
                          className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                        <div className="ml-3">
                          <h3 className="text-sm font-medium text-red-800">Signal Error</h3>
                          <p className="text-sm text-red-700 mt-1 whitespace-pre-wrap">{signalError}</p>
                          <Button
                            onClick={() => setSignalError(null)}
                            variant="outline"
                            size="sm"
                            className="mt-2"
                          >
                            Dismiss
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {result.status === 'PAUSED' && (
                    <div className="bg-card border border-border rounded-lg p-4">
                      <p className="text-sm font-medium text-foreground mb-2">For Demo Testing:</p>
                      <p className="text-xs text-muted-foreground mb-3">
                        Click the button below to simulate a payment provider webhook confirming the transaction.
                      </p>
                      <Button
                        onClick={handleSendPaymentSignal}
                        disabled={sendingSignal || result.status !== 'PAUSED'}
                        className="w-full bg-yellow-600 hover:bg-yellow-700 text-white font-medium"
                      >
                        {sendingSignal ? 'Sending Signal...' : '🔔 Simulate Payment Webhook'}
                      </Button>
                      <p className="text-xs text-muted-foreground mt-2 text-center">
                        This sends a <code className="bg-muted px-1 py-0.5 rounded text-xs">SIGNAL_RECEIVED</code> event
                      </p>
                    </div>
                  )}

                  {result.status !== 'PAUSED' && (
                    <div className="bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                      <p className="text-sm text-blue-800 dark:text-blue-200">
                        <strong>Note:</strong> Workflow status is <strong>{result.status}</strong>.
                        The signal button will appear when the workflow is fully paused at this step.
                      </p>
                    </div>
                  )}

                  <div className="bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <p className="text-xs text-blue-800 dark:text-blue-200">
                      <strong>Real-world scenario:</strong> Your payment provider (Stripe, PayPal) would send a webhook
                      to your server endpoint (e.g., <code className="bg-blue-100 dark:bg-blue-900/50 px-1 py-0.5 rounded">/api/webhooks/payments</code>),
                      which would then call <code className="bg-blue-100 dark:bg-blue-900/50 px-1 py-0.5 rounded">POST /api/workflows/instances/[id]/signal</code>
                      to resume the workflow.
                    </p>
                  </div>
                </div>
              </>
            )}

            {/* Order Confirmation Step */}
            {result && result.currentStepId === 'order_confirmation' && (
              <>
                <h2 className="text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 bg-blue-600 rounded-full animate-pulse"></span>
                  Creating Order
                </h2>
                <div className="space-y-6">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <p className="text-sm text-green-800 font-medium mb-1">Payment Successful!</p>
                    <p className="text-xs text-green-700">Transaction ID: {result.instanceId.slice(0, 8)}...</p>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-green-600">✓</span>
                      <span className="text-foreground">Creating order record</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="inline-block w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></span>
                      <span className="text-foreground">Sending confirmation email</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">○</span>
                      <span className="text-muted-foreground">Updating inventory</span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Completed State */}
            {result && result.status === 'COMPLETED' && (
              <>
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                    <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold text-foreground mb-2">Order Confirmed!</h2>
                  <p className="text-sm text-muted-foreground">Order #{result.instanceId.slice(0, 8).toUpperCase()}</p>
                </div>

                <div className="space-y-4">
                  <div className="bg-muted rounded-lg p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Order Date:</span>
                      <span className="text-foreground">{new Date().toLocaleDateString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Payment Method:</span>
                      <span className="text-foreground">Credit Card ****4242</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total Paid:</span>
                      <span className="text-foreground font-semibold">{currencySymbol}{total.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="border-t border-border pt-4">
                    <p className="text-xs text-muted-foreground mb-3">Order Items:</p>
                    {demoCart.map((item) => (
                      <div key={item.id} className="flex justify-between text-sm mb-2">
                        <span className="text-foreground">{item.quantity}x {item.name}</span>
                        <span className="text-foreground">{currencySymbol}{(item.price * item.quantity).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <p className="text-xs text-blue-800 dark:text-blue-200">
                      ✉️ A confirmation email has been sent to demo@example.com
                    </p>
                  </div>

                  <Button
                    onClick={() => {
                      setResult(null)
                      setError(null)
                      setCurrentStep(null)
                      setAvailableSteps([])
                    }}
                    variant="outline"
                    className="w-full"
                  >
                    Start New Order
                  </Button>
                </div>
              </>
            )}

            {/* Failed State */}
            {result && result.status === 'FAILED' && (
              <>
                <h2 className="text-xl font-semibold text-red-900 mb-4">Order Failed</h2>
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm text-red-800">
                    Unfortunately, your order could not be processed. Please try again.
                  </p>
                </div>
                <Button
                  onClick={() => {
                    setResult(null)
                    setError(null)
                    setCurrentStep(null)
                    setAvailableSteps([])
                  }}
                  className="w-full mt-6"
                >
                  Try Again
                </Button>
              </>
            )}
          </div>

          {/* Workflow Status */}
          <div className="bg-card shadow rounded-lg p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">Workflow Progress</h2>

            {!result && !error && (
              <div className="text-center py-12">
                <svg
                  className="mx-auto h-12 w-12 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
                <p className="mt-4 text-muted-foreground">
                  Click "Start Checkout Workflow" to begin
                </p>
              </div>
            )}

            {loading && (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-4 text-muted-foreground">Starting workflow...</p>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-start">
                  <svg
                    className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div className="ml-3 flex-1">
                    <h3 className="text-sm font-medium text-red-800">Error</h3>
                    <p className="mt-1 text-sm text-red-700 whitespace-pre-wrap">{error}</p>
                    <Button
                      onClick={() => setError(null)}
                      variant="outline"
                      size="sm"
                      className="mt-3"
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {result && (
              <div className="space-y-6">
                {/* Status Badge */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Status
                  </label>
                  <span
                    className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(
                      result.status
                    )}`}
                  >
                    {result.status}
                  </span>
                </div>

                {/* Workflow Steps Visual */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-3">
                    Steps
                  </label>
                  <div className="space-y-2">
                    {workflowSteps.map((step, index) => {
                      const status = getStepStatus(step.stepId)
                      const isLastStep = step.stepType === 'END'
                      const isPaused = status === 'paused'

                      return (
                        <div
                          key={step.stepId}
                          className={`p-3 rounded-lg border-2 ${getStepColor(status)} transition-all duration-300 ${
                            (status === 'current' || isPaused) && !isLastStep ? 'animate-pulse' : ''
                          }`}
                        >
                          <div className="flex items-center">
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-card flex items-center justify-center font-bold text-sm">
                              {status === 'completed' ? '✓' : isPaused ? '⏸' : index + 1}
                            </div>
                            <div className="ml-3 flex-1">
                              <p className="font-medium">{step.stepName}</p>
                              {step.description && (
                                <p className="text-xs opacity-75 mt-0.5">{step.description}</p>
                              )}
                            </div>
                            {status === 'current' && !isLastStep && !isPaused && (
                              <span className="ml-2 text-xs font-medium flex items-center gap-1">
                                <span className="inline-block w-2 h-2 bg-current rounded-full animate-pulse"></span>
                                Processing...
                              </span>
                            )}
                            {isPaused && (
                              <span className="ml-2 text-xs font-medium flex items-center gap-1">
                                <span className="inline-block w-2 h-2 bg-current rounded-full"></span>
                                Waiting for input
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* User Task Required */}
                {result.status === 'PAUSED' && userTasks.length > 0 && (
                  <div className="border-t border-border pt-4">
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <div className="flex items-start mb-3">
                        <svg
                          className="h-5 w-5 text-yellow-600 mt-0.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                          />
                        </svg>
                        <div className="ml-3">
                          <h3 className="text-sm font-medium text-yellow-800">
                            User Action Required
                          </h3>
                          <p className="text-sm text-yellow-700 mt-1">
                            This workflow is paused waiting for user input. Please complete the task below to continue.
                          </p>
                        </div>
                      </div>

                      {userTasks.map((task: any) => (
                        <div key={task.id} className="mt-3 bg-card rounded-md p-3 border border-yellow-200">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <h4 className="text-sm font-semibold text-foreground">{task.taskName}</h4>
                              {task.description && (
                                <p className="text-sm text-muted-foreground mt-1">{task.description}</p>
                              )}
                              {task.dueDate && (
                                <p className="text-xs text-muted-foreground mt-2">
                                  Due: {new Date(task.dueDate).toLocaleString()}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="mt-3">
                            <a
                              href={`/backend/tasks/${task.id}`}
                              className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-yellow-600 hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500"
                            >
                              Complete Task →
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Manual Progression */}
                {result.status === 'RUNNING' && currentStep && currentStep.stepType !== 'END' && (
                  <div className="border-t border-border pt-4">
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Manual Progression
                    </label>
                    <p className="text-sm text-muted-foreground mb-3">
                      Manually advance to the next step for testing
                    </p>
                    <Button
                      onClick={() => handleAdvance()}
                      disabled={advancing || result.status !== 'RUNNING'}
                      className="w-full"
                    >
                      {advancing ? 'Advancing...' : 'Advance to Next Step →'}
                    </Button>
                  </div>
                )}

                {/* Completed State */}
                {result.status === 'COMPLETED' && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-start">
                      <svg
                        className="h-5 w-5 text-green-600 mt-0.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-green-800">
                          Workflow Completed!
                        </h3>
                        <p className="mt-1 text-sm text-green-700">
                          All steps executed successfully
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="border-t border-border pt-4 space-y-3">
                  <Link
                    href={`/backend/instances/${result.instanceId}`}
                    className="block w-full text-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    View in Admin
                  </Link>

                  <Button
                    onClick={() => {
                      setResult(null)
                      setError(null)
                      setCurrentStep(null)
                      setAvailableSteps([])
                    }}
                    variant="outline"
                    className="w-full"
                  >
                    Start New Checkout
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Workflow Events Timeline */}
        {result && events.length > 0 && (
          <div className="mt-8 bg-card shadow rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold text-foreground">
                  Workflow Events
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    ({events.length})
                  </span>
                </h2>
                {(result.status === 'RUNNING' || result.status === 'WAITING_FOR_ACTIVITIES') && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                    <span className="inline-block w-2 h-2 bg-red-600 rounded-full animate-pulse"></span>
                    Live
                  </span>
                )}
              </div>
              <Link
                href={`/backend/events?workflowInstanceId=${result.instanceId}`}
                className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:text-blue-200 hover:underline"
              >
                View all events →
              </Link>
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto">
              {events.map((event: WorkflowEvent) => (
                <div
                  key={event.id}
                  className="border border-border rounded-lg p-3 hover:bg-muted transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getEventTypeBadgeClass(
                            event.eventType
                          )}`}
                        >
                          {formatEventType(event.eventType)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(event.occurredAt).toLocaleTimeString()}
                        </span>
                      </div>
                      {event.eventData && Object.keys(event.eventData).length > 0 && (
                        <details className="mt-2">
                          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                            View event data
                          </summary>
                          <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-x-auto max-h-32 overflow-y-auto">
                            {JSON.stringify(event.eventData, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                    <Link
                      href={`/backend/events/${event.id}`}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:text-blue-200 hover:underline whitespace-nowrap"
                    >
                      Details
                    </Link>
                  </div>
                </div>
              ))}
            </div>

            {events.length > 10 && (
              <div className="mt-4 text-center">
                <Link
                  href={`/backend/events?workflowInstanceId=${result.instanceId}`}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:text-blue-200 hover:underline"
                >
                  View all {events.length} events →
                </Link>
              </div>
            )}
          </div>
        )}

        {/* Features Info */}
        <div className="mt-4 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex items-start">
            <svg
              className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200">Features</h3>
              <div className="mt-2 text-sm text-blue-700">
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>Signal-Based Payment Flow:</strong> Demonstrates real-world webhook pattern with WAIT_FOR_SIGNAL step type</li>
                  <li><strong>Interactive UI Changes:</strong> Left panel dynamically updates to show cart validation, payment initiation, webhook waiting, and order confirmation screens</li>
                  <li><strong>Real-time Progress Tracking:</strong> Watch the workflow progress through steps automatically with live status updates</li>
                  <li><strong>Webhook Simulation:</strong> Test signal-based workflow resumption with simulated payment provider webhook</li>
                  <li><strong>Live Event Timeline:</strong> New workflow events appear in real-time including SIGNAL_AWAITING and SIGNAL_RECEIVED</li>
                  <li><strong>Complete Order Flow:</strong> Experience the full checkout journey from cart to confirmation with async payment processing</li>
                  <li><strong>User Task Integration:</strong> Form-based user input with workflow pause/resume on task completion</li>
                  <li><strong>Business Rules Integration:</strong> Guard rules validate transitions with detailed failure information</li>
                </ul>
                <p className="mt-2">
                  <Link href="/backend/definitions" className="text-blue-800 dark:text-blue-200 hover:text-blue-900 underline">
                    View all workflows →
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
