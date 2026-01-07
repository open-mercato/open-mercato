'use client'

import { WorkflowGraph } from '../../../components/WorkflowGraph'
import { Node, Edge } from '@xyflow/react'
import { useState } from 'react'

/**
 * GraphTestPage - Test page for WorkflowGraph component
 *
 * Demonstrates:
 * - Basic graph rendering
 * - Different node types
 * - Edge connections
 * - Pan and zoom controls
 * - Edit vs read-only modes
 */
export default function GraphTestPage() {
  const [editable, setEditable] = useState(false)

  // Sample workflow nodes - simple checkout flow with enhanced design
  const initialNodes: Node[] = [
    {
      id: 'start',
      type: 'start',
      position: { x: 250, y: 50 },
      data: {
        label: 'Checkout Started',
        description: 'Customer initiated checkout process',
        status: 'completed',
        badge: 'Start',
      },
    },
    {
      id: 'cart_validation',
      type: 'automated',
      position: { x: 250, y: 250 },
      data: {
        label: 'Validate Cart',
        description: 'Check inventory availability and pricing',
        status: 'completed',
        stepNumber: 1,
        badge: 'Automated',
      },
    },
    {
      id: 'customer_info',
      type: 'userTask',
      position: { x: 250, y: 500 },
      data: {
        label: 'Collect Customer Info',
        description: 'Customer provides shipping and billing details',
        status: 'running',
        stepNumber: 2,
        badge: 'User Task',
        assignedToRoles: ['Customer'],
      },
    },
    {
      id: 'payment_processing',
      type: 'automated',
      position: { x: 250, y: 750 },
      data: {
        label: 'Process Payment',
        description: 'Charge payment method via payment gateway',
        status: 'pending',
        stepNumber: 3,
        badge: 'Automated',
      },
    },
    {
      id: 'order_confirmation',
      type: 'automated',
      position: { x: 250, y: 1000 },
      data: {
        label: 'Send Confirmation',
        description: 'Email order details and receipt to customer',
        status: 'pending',
        stepNumber: 4,
        badge: 'Automated',
      },
    },
    {
      id: 'end',
      type: 'end',
      position: { x: 250, y: 1250 },
      data: {
        label: 'Order Complete',
        description: 'Workflow completed successfully',
        status: 'pending',
        badge: 'End',
      },
    },
  ]

  // Sample edges - workflow transitions
  const initialEdges: Edge[] = [
    {
      id: 'e-start-cart',
      source: 'start',
      target: 'cart_validation',
      animated: false,
      label: 'Initialize',
      labelStyle: { fontSize: 12, fontWeight: 500 },
      labelBgStyle: { fill: '#f3f4f6', opacity: 0.9 },
    },
    {
      id: 'e-cart-customer',
      source: 'cart_validation',
      target: 'customer_info',
      animated: false,
      label: 'Cart valid',
      labelStyle: { fontSize: 12, fontWeight: 500 },
      labelBgStyle: { fill: '#f3f4f6', opacity: 0.9 },
    },
    {
      id: 'e-customer-payment',
      source: 'customer_info',
      target: 'payment_processing',
      animated: false,
      label: 'Info submitted',
      labelStyle: { fontSize: 12, fontWeight: 500 },
      labelBgStyle: { fill: '#f3f4f6', opacity: 0.9 },
    },
    {
      id: 'e-payment-confirmation',
      source: 'payment_processing',
      target: 'order_confirmation',
      animated: false,
      label: 'Payment successful',
      labelStyle: { fontSize: 12, fontWeight: 500 },
      labelBgStyle: { fill: '#f3f4f6', opacity: 0.9 },
    },
    {
      id: 'e-confirmation-end',
      source: 'order_confirmation',
      target: 'end',
      animated: false,
      label: 'Finalize',
      labelStyle: { fontSize: 12, fontWeight: 500 },
      labelBgStyle: { fill: '#f3f4f6', opacity: 0.9 },
    },
  ]

  const [nodes, setNodes] = useState(initialNodes)
  const [edges, setEdges] = useState(initialEdges)

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Workflow Graph Test
          </h1>
          <p className="text-gray-600">
            Testing ReactFlow integration with sample checkout workflow
          </p>
        </div>

        {/* Controls */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Graph Controls
          </h2>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editable}
                onChange={(e) => setEditable(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">
                Enable Edit Mode
              </span>
            </label>

            <div className="flex-1"></div>

            <button
              onClick={() => {
                setNodes(initialNodes)
                setEdges(initialEdges)
              }}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium"
            >
              Reset Graph
            </button>
          </div>

          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              <strong>Features to test:</strong>
            </p>
            <ul className="mt-2 text-sm text-blue-700 space-y-1 list-disc list-inside">
              <li>Pan: Click and drag the background</li>
              <li>Zoom: Use mouse wheel or controls (top-right)</li>
              <li>Fit View: Click the "fit" button to center all nodes</li>
              <li>Mini-map: Navigate large workflows (bottom-left)</li>
              <li>Edit Mode: Enable to drag nodes around</li>
            </ul>
          </div>
        </div>

        {/* Graph */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Checkout Workflow Visualization
          </h2>

          <WorkflowGraph
            initialNodes={nodes}
            initialEdges={edges}
            onNodesChange={(updatedNodes) => {
              console.log('Nodes changed:', updatedNodes)
              setNodes(updatedNodes)
            }}
            onEdgesChange={(updatedEdges) => {
              console.log('Edges changed:', updatedEdges)
              setEdges(updatedEdges)
            }}
            editable={editable}
            height="800px"
          />
        </div>

        {/* Info */}
        <div className="mt-6 bg-green-50 border border-green-200 rounded-lg p-6">
          <h3 className="text-sm font-semibold text-green-800 mb-2">
            ✓ Enhanced Design Applied: Professional Workflow Visualization
          </h3>
          <div className="text-sm text-green-700 space-y-1">
            <p>
              <strong>Design Updates:</strong>
            </p>
            <ul className="list-disc list-inside ml-4 space-y-1">
              <li>White backgrounds for all nodes (cleaner, professional look)</li>
              <li>4px colored left border for type differentiation (emerald, gray, amber)</li>
              <li>Status indicators with visual states (pending, running, completed, error)</li>
              <li>Enhanced badges with semantic colors</li>
              <li>Step numbers and improved typography</li>
              <li>Selection state with purple glow shadow</li>
              <li>Hover effects with subtle shadow transitions</li>
            </ul>
            <p className="mt-3">
              <strong>Based on:</strong> WORKFLOW_VISUALIZATION_DESIGN_GUIDE.md
            </p>
            <p className="mt-2">
              <strong>Next Steps (Step 7.3):</strong> Visual definition editor
              with drag-and-drop node palette, edge customization, and node editing
            </p>
          </div>
        </div>

        {/* Node Info */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Node Types (Enhanced Design)
            </h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-lg flex-shrink-0 border border-l-4 bg-white"
                  style={{
                    borderColor: '#E5E7EB',
                    borderLeftColor: '#10B981',
                    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                  }}
                ></div>
                <div>
                  <div className="font-medium text-gray-900">START</div>
                  <div className="text-sm text-gray-500">
                    White bg • Emerald accent (#10B981)
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-lg flex-shrink-0 border border-l-4 bg-white"
                  style={{
                    borderColor: '#E5E7EB',
                    borderLeftColor: '#6B7280',
                    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                  }}
                ></div>
                <div>
                  <div className="font-medium text-gray-900">AUTOMATED</div>
                  <div className="text-sm text-gray-500">
                    White bg • Gray accent (#6B7280)
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-lg flex-shrink-0 border border-l-4 bg-white"
                  style={{
                    borderColor: '#E5E7EB',
                    borderLeftColor: '#F59E0B',
                    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                  }}
                ></div>
                <div>
                  <div className="font-medium text-gray-900">USER_TASK</div>
                  <div className="text-sm text-gray-500">
                    White bg • Amber accent (#F59E0B)
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-lg flex-shrink-0 border border-l-4 bg-white"
                  style={{
                    borderColor: '#E5E7EB',
                    borderLeftColor: '#374151',
                    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                  }}
                ></div>
                <div>
                  <div className="font-medium text-gray-900">END</div>
                  <div className="text-sm text-gray-500">
                    White bg • Gray accent (#374151)
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-100">
              <h4 className="text-sm font-semibold text-gray-900 mb-2">Status Indicators</h4>
              <div className="space-y-2 text-xs text-gray-600">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full border-2 border-gray-300"></div>
                  <span>Pending (empty circle)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-blue-500 text-white flex items-center justify-center text-[8px]">⟳</div>
                  <span>Running (blue, spinning)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[8px]">✓</div>
                  <span>Completed (emerald, check)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center text-[8px]">!</div>
                  <span>Error (red, exclamation)</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Current Graph Stats
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Total Nodes:</span>
                <span className="font-medium text-gray-900">{nodes.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Total Edges:</span>
                <span className="font-medium text-gray-900">{edges.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Mode:</span>
                <span className="font-medium text-gray-900">
                  {editable ? 'Editable' : 'Read-only'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
