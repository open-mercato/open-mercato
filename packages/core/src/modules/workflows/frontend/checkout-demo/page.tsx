'use client'

import { useState, useEffect } from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'

interface CartItem {
  id: string
  name: string
  price: number
  quantity: number
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
  const [loading, setLoading] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [result, setResult] = useState<WorkflowResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState<StepInfo | null>(null)
  const [availableSteps, setAvailableSteps] = useState<StepInfo[]>([])

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
    refetchInterval: result?.status === 'RUNNING' ? 500 : false, // Poll every 500ms while running
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
    refetchInterval: result?.status === 'RUNNING' ? 1000 : false,
  })

  // Demo cart data
  const demoCart: CartItem[] = [
    { id: 'prod-1', name: 'Wireless Mouse', price: 29.99, quantity: 2 },
    { id: 'prod-2', name: 'USB-C Cable', price: 14.99, quantity: 3 },
    { id: 'prod-3', name: 'Laptop Stand', price: 49.99, quantity: 1 },
  ]

  const subtotal = demoCart.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const tax = subtotal * 0.08 // 8% tax
  const shipping = 9.99
  const total = subtotal + tax + shipping

  // Workflow steps for UI
  const workflowSteps: StepInfo[] = [
    { stepId: 'start', stepName: 'Start', stepType: 'START', description: 'Workflow initiated' },
    { stepId: 'cart_validation', stepName: 'Cart Validation', stepType: 'AUTOMATED', description: 'Validate cart and reserve inventory' },
    { stepId: 'payment_processing', stepName: 'Payment Processing', stepType: 'AUTOMATED', description: 'Process payment' },
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

  const handleCheckout = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
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
          initialContext: {
            cart: {
              id: `cart-${Date.now()}`,
              items: demoCart,
              itemCount: demoCart.reduce((sum, item) => sum + item.quantity, 0),
              subtotal: subtotal,
              tax: tax,
              shipping: shipping,
              total: total,
              currency: 'USD',
            },
            customer: {
              id: 'demo-customer-1',
              name: 'Demo Customer',
              email: 'demo@example.com',
              shippingAddress: {
                street: '123 Demo Street',
                city: 'Demo City',
                state: 'DC',
                zip: '12345',
                country: 'USA',
              },
            },
            payment: {
              id: `payment-${Date.now()}`,
              methodId: 'pm_demo_visa',
              method: 'Credit Card',
              last4: '4242',
            },
          },
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
        return 'text-blue-600 bg-blue-50'
      case 'COMPLETED':
        return 'text-green-600 bg-green-50'
      case 'FAILED':
        return 'text-red-600 bg-red-50'
      default:
        return 'text-gray-600 bg-gray-50'
    }
  }

  const getStepStatus = (stepId: string) => {
    if (!result?.currentStepId) return 'pending'

    const currentIndex = workflowSteps.findIndex(s => s.stepId === result.currentStepId)
    const stepIndex = workflowSteps.findIndex(s => s.stepId === stepId)

    if (stepIndex < currentIndex) return 'completed'
    if (stepIndex === currentIndex) return 'current'
    return 'pending'
  }

  const getStepColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-600 border-green-300'
      case 'current':
        return 'bg-blue-100 text-blue-600 border-blue-300'
      default:
        return 'bg-gray-100 text-gray-600 border-gray-300'
    }
  }

  const getEventTypeBadgeClass = (eventType: string) => {
    if (eventType.includes('STARTED')) return 'bg-blue-100 text-blue-800'
    if (eventType.includes('COMPLETED')) return 'bg-green-100 text-green-800'
    if (eventType.includes('FAILED') || eventType.includes('REJECTED')) return 'bg-red-100 text-red-800'
    if (eventType.includes('CANCELLED')) return 'bg-gray-100 text-gray-800'
    if (eventType.includes('ENTERED') || eventType.includes('EXITED')) return 'bg-purple-100 text-purple-800'
    return 'bg-gray-100 text-gray-800'
  }

  const formatEventType = (eventType: string) => {
    return eventType.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Checkout Demo</h1>
          <p className="text-gray-600">
            Interactive workflow demonstration with manual step progression
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Interactive Left Panel - Changes based on workflow step */}
          <div className="bg-white shadow rounded-lg p-6">
            {/* Initial State - Cart Summary */}
            {!result && (
              <>
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Order Summary</h2>

                {/* Cart Items */}
                <div className="space-y-4 mb-6">
                  {demoCart.map((item) => (
                    <div key={item.id} className="flex justify-between items-start">
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{item.name}</p>
                        <p className="text-sm text-gray-500">Quantity: {item.quantity}</p>
                      </div>
                      <p className="font-medium text-gray-900">
                        ${(item.price * item.quantity).toFixed(2)}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Totals */}
                <div className="border-t border-gray-200 pt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Subtotal</span>
                    <span className="text-gray-900">${subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Tax (8%)</span>
                    <span className="text-gray-900">${tax.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Shipping</span>
                    <span className="text-gray-900">${shipping.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-lg pt-2 border-t border-gray-200">
                    <span className="text-gray-900">Total</span>
                    <span className="text-gray-900">${total.toFixed(2)}</span>
                  </div>
                </div>

                {/* Checkout Button */}
                <Button
                  onClick={handleCheckout}
                  disabled={loading || result !== null}
                  className="w-full mt-6"
                  size="lg"
                >
                  {loading ? 'Starting...' : result ? 'Workflow Started' : 'Start Checkout Workflow'}
                </Button>
              </>
            )}

            {/* Cart Validation Step */}
            {result && (result.currentStepId === 'start' || result.currentStepId === 'cart_validation') && (
              <>
                <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 bg-blue-600 rounded-full animate-pulse"></span>
                  Validating Cart
                </h2>
                <div className="space-y-4">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <p className="text-sm text-blue-800">Checking cart items and inventory availability...</p>
                  </div>
                  {demoCart.map((item) => (
                    <div key={item.id} className="flex justify-between items-center border-b border-gray-200 pb-2">
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{item.name}</p>
                        <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
                      </div>
                      <span className="text-green-600 text-sm">✓ Available</span>
                    </div>
                  ))}
                  <div className="pt-2 border-t border-gray-200">
                    <p className="text-sm font-medium text-gray-900">Total: ${total.toFixed(2)}</p>
                  </div>
                </div>
              </>
            )}

            {/* Payment Processing Step */}
            {result && result.currentStepId === 'payment_processing' && (
              <>
                <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 bg-blue-600 rounded-full animate-pulse"></span>
                  Processing Payment
                </h2>
                <div className="space-y-6">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <p className="text-sm text-blue-800 font-medium mb-2">Payment Details</p>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Method:</span>
                        <span className="text-gray-900">Credit Card ****4242</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Amount:</span>
                        <span className="text-gray-900 font-semibold">${total.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-center py-8">
                    <div className="text-center">
                      <div className="inline-block w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                      <p className="text-sm text-gray-600">Contacting payment provider...</p>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Order Confirmation Step */}
            {result && result.currentStepId === 'order_confirmation' && (
              <>
                <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
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
                      <span className="text-gray-700">Creating order record</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="inline-block w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></span>
                      <span className="text-gray-700">Sending confirmation email</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-gray-400">○</span>
                      <span className="text-gray-500">Updating inventory</span>
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
                  <h2 className="text-2xl font-bold text-gray-900 mb-2">Order Confirmed!</h2>
                  <p className="text-sm text-gray-600">Order #{result.instanceId.slice(0, 8).toUpperCase()}</p>
                </div>

                <div className="space-y-4">
                  <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Order Date:</span>
                      <span className="text-gray-900">{new Date().toLocaleDateString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Payment Method:</span>
                      <span className="text-gray-900">Credit Card ****4242</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Total Paid:</span>
                      <span className="text-gray-900 font-semibold">${total.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="border-t border-gray-200 pt-4">
                    <p className="text-xs text-gray-600 mb-3">Order Items:</p>
                    {demoCart.map((item) => (
                      <div key={item.id} className="flex justify-between text-sm mb-2">
                        <span className="text-gray-700">{item.quantity}x {item.name}</span>
                        <span className="text-gray-900">${(item.price * item.quantity).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <p className="text-xs text-blue-800">
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
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Workflow Progress</h2>

            {!result && !error && (
              <div className="text-center py-12">
                <svg
                  className="mx-auto h-12 w-12 text-gray-400"
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
                <p className="mt-4 text-gray-600">
                  Click "Start Checkout Workflow" to begin
                </p>
              </div>
            )}

            {loading && (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">Starting workflow...</p>
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
                  <label className="block text-sm font-medium text-gray-700 mb-2">
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
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Steps
                  </label>
                  <div className="space-y-2">
                    {workflowSteps.map((step, index) => {
                      const status = getStepStatus(step.stepId)
                      const isLastStep = step.stepType === 'END'
                      return (
                        <div
                          key={step.stepId}
                          className={`p-3 rounded-lg border-2 ${getStepColor(status)} transition-all duration-300 ${
                            status === 'current' && !isLastStep ? 'animate-pulse' : ''
                          }`}
                        >
                          <div className="flex items-center">
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white flex items-center justify-center font-bold text-sm">
                              {status === 'completed' ? '✓' : index + 1}
                            </div>
                            <div className="ml-3 flex-1">
                              <p className="font-medium">{step.stepName}</p>
                              {step.description && (
                                <p className="text-xs opacity-75 mt-0.5">{step.description}</p>
                              )}
                            </div>
                            {status === 'current' && !isLastStep && (
                              <span className="ml-2 text-xs font-medium flex items-center gap-1">
                                <span className="inline-block w-2 h-2 bg-current rounded-full animate-pulse"></span>
                                Processing...
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Manual Progression */}
                {result.status === 'RUNNING' && currentStep && currentStep.stepType !== 'END' && (
                  <div className="border-t border-gray-200 pt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Manual Progression
                    </label>
                    <p className="text-sm text-gray-600 mb-3">
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
                <div className="border-t border-gray-200 pt-4 space-y-3">
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
          <div className="mt-8 bg-white shadow rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold text-gray-900">
                  Workflow Events
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    ({events.length})
                  </span>
                </h2>
                {result.status === 'RUNNING' && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                    <span className="inline-block w-2 h-2 bg-red-600 rounded-full animate-pulse"></span>
                    Live
                  </span>
                )}
              </div>
              <Link
                href={`/backend/events?workflowInstanceId=${result.instanceId}`}
                className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
              >
                View all events →
              </Link>
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto">
              {events.slice(0, 10).map((event: WorkflowEvent) => (
                <div
                  key={event.id}
                  className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50 transition-colors"
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
                        <span className="text-xs text-gray-500">
                          {new Date(event.occurredAt).toLocaleTimeString()}
                        </span>
                      </div>
                      {event.eventData && Object.keys(event.eventData).length > 0 && (
                        <details className="mt-2">
                          <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-900">
                            View event data
                          </summary>
                          <pre className="mt-2 text-xs bg-gray-100 p-2 rounded overflow-x-auto max-h-32 overflow-y-auto">
                            {JSON.stringify(event.eventData, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                    <Link
                      href={`/backend/events/${event.id}`}
                      className="text-xs text-blue-600 hover:text-blue-800 hover:underline whitespace-nowrap"
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
                  className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                >
                  View all {events.length} events →
                </Link>
              </div>
            )}
          </div>
        )}

        {/* Setup Instructions Banner */}
        <div className="mt-8 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start">
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
              <h3 className="text-sm font-medium text-yellow-800">Setup Required</h3>
              <div className="mt-2 text-sm text-yellow-700">
                <p className="font-semibold mb-2">Before using this demo:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Get your tenant and organization IDs:
                    <pre className="mt-1 bg-yellow-100 p-2 rounded text-xs overflow-x-auto">
                      ./packages/core/src/modules/workflows/scripts/get-tenant-org-ids.sh
                    </pre>
                  </li>
                  <li>Seed the demo workflow:
                    <pre className="mt-1 bg-yellow-100 p-2 rounded text-xs overflow-x-auto">
                      yarn mercato workflows seed-demo -t TENANT_ID -o ORG_ID
                    </pre>
                  </li>
                  <li>Log in with a user from that tenant (e.g., admin@acme.com)</li>
                </ol>
              </div>
            </div>
          </div>
        </div>

        {/* Features Info */}
        <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start">
            <svg
              className="h-5 w-5 text-blue-600 mt-0.5"
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
              <h3 className="text-sm font-medium text-blue-800">Features</h3>
              <div className="mt-2 text-sm text-blue-700">
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>Interactive UI Changes:</strong> Left panel dynamically updates to show cart validation, payment processing, and order confirmation screens</li>
                  <li><strong>Real-time Progress Tracking:</strong> Watch the workflow progress through steps automatically with live status updates</li>
                  <li><strong>Step-by-Step Visualization:</strong> Pulsing indicators and progress bars show current processing state</li>
                  <li><strong>Live Event Timeline:</strong> New workflow events appear in real-time with event count and "Live" indicator</li>
                  <li><strong>Complete Order Flow:</strong> Experience the full checkout journey from cart to confirmation</li>
                  <li><strong>Business Rules Integration:</strong> Guard rules validate transitions with detailed failure information</li>
                  <li><strong>Manual Step Control:</strong> Optional manual advancement for step-by-step testing</li>
                </ul>
                <p className="mt-2">
                  <Link href="/backend/definitions" className="text-blue-800 hover:text-blue-900 underline">
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
