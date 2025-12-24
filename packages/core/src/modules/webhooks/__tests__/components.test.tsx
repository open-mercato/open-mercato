/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

// Mock the UI primitives
jest.mock('@open-mercato/ui/primitives/input', () => ({
  Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    function Input(props, ref) {
      return <input ref={ref} {...props} />
    }
  ),
}))

jest.mock('@open-mercato/ui/primitives/textarea', () => ({
  Textarea: React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
    function Textarea(props, ref) {
      return <textarea ref={ref} {...props} />
    }
  ),
}))

// Import components after mocks
import { EventsMultiSelect, ALL_WEBHOOK_EVENTS } from '../components/EventsMultiSelect'
import { WebhookConfigFields } from '../components/WebhookConfigFields'

describe('EventsMultiSelect', () => {
  it('renders all available event groups', () => {
    render(<EventsMultiSelect value={[]} onChange={() => {}} />)

    expect(screen.getByText('Product Events')).toBeInTheDocument()
  })

  it('shows all events within a group', () => {
    render(<EventsMultiSelect value={[]} onChange={() => {}} />)

    expect(screen.getByText('Product Created')).toBeInTheDocument()
    expect(screen.getByText('Product Updated')).toBeInTheDocument()
    expect(screen.getByText('Product Deleted')).toBeInTheDocument()
  })

  it('calls onChange when an event is toggled', () => {
    const handleChange = jest.fn()
    render(<EventsMultiSelect value={[]} onChange={handleChange} />)

    fireEvent.click(screen.getByText('Product Created'))

    expect(handleChange).toHaveBeenCalledWith(['catalog.product.created'])
  })

  it('removes event from selection when clicking selected event', () => {
    const handleChange = jest.fn()
    render(<EventsMultiSelect value={['catalog.product.created']} onChange={handleChange} />)

    fireEvent.click(screen.getByText('Product Created'))

    expect(handleChange).toHaveBeenCalledWith([])
  })

  it('selects all events in group when clicking group All checkbox', () => {
    const handleChange = jest.fn()
    render(<EventsMultiSelect value={[]} onChange={handleChange} />)

    // Click the "All" checkbox for the Product group
    const allCheckbox = screen.getByLabelText('All')
    fireEvent.click(allCheckbox)

    expect(handleChange).toHaveBeenCalledWith(
      expect.arrayContaining(['catalog.product.created', 'catalog.product.updated', 'catalog.product.deleted'])
    )
  })

  it('deselects all events in group when all are selected and All checkbox is clicked', () => {
    const handleChange = jest.fn()
    render(
      <EventsMultiSelect
        value={['catalog.product.created', 'catalog.product.updated', 'catalog.product.deleted']}
        onChange={handleChange}
      />
    )

    // Click the "All" checkbox to deselect all
    const allCheckbox = screen.getByLabelText('All')
    fireEvent.click(allCheckbox)

    expect(handleChange).toHaveBeenCalledWith([])
  })

  it('shows All checkbox as checked when all events in group are selected', () => {
    render(
      <EventsMultiSelect
        value={['catalog.product.created', 'catalog.product.updated', 'catalog.product.deleted']}
        onChange={() => {}}
      />
    )

    const allCheckbox = screen.getByLabelText('All') as HTMLInputElement
    expect(allCheckbox.checked).toBe(true)
  })

  it('exports all available events', () => {
    expect(ALL_WEBHOOK_EVENTS).toContain('catalog.product.created')
    expect(ALL_WEBHOOK_EVENTS).toContain('catalog.product.updated')
    expect(ALL_WEBHOOK_EVENTS).toContain('catalog.product.deleted')
  })

  it('disables interactions when disabled prop is true', () => {
    const handleChange = jest.fn()
    render(<EventsMultiSelect value={[]} onChange={handleChange} disabled />)

    fireEvent.click(screen.getByText('Product Created'))

    expect(handleChange).not.toHaveBeenCalled()
  })
})

describe('WebhookConfigFields', () => {
  describe('HTTP delivery type', () => {
    it('renders URL input field', () => {
      render(
        <WebhookConfigFields
          deliveryType="http"
          config={{}}
          onChange={() => {}}
        />
      )

      expect(screen.getByPlaceholderText('https://api.example.com/webhooks')).toBeInTheDocument()
    })

    it('renders HTTP method buttons', () => {
      render(
        <WebhookConfigFields
          deliveryType="http"
          config={{}}
          onChange={() => {}}
        />
      )

      expect(screen.getByText('POST')).toBeInTheDocument()
      expect(screen.getByText('PUT')).toBeInTheDocument()
    })

    it('calls onChange when URL is updated', () => {
      const handleChange = jest.fn()
      render(
        <WebhookConfigFields
          deliveryType="http"
          config={{}}
          onChange={handleChange}
        />
      )

      const urlInput = screen.getByPlaceholderText('https://api.example.com/webhooks')
      fireEvent.change(urlInput, { target: { value: 'https://test.com/webhook' } })

      expect(handleChange).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://test.com/webhook' })
      )
    })

    it('calls onChange when method is changed', () => {
      const handleChange = jest.fn()
      render(
        <WebhookConfigFields
          deliveryType="http"
          config={{ url: 'https://test.com', method: 'POST' }}
          onChange={handleChange}
        />
      )

      fireEvent.click(screen.getByText('PUT'))

      expect(handleChange).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'PUT' })
      )
    })

    it('shows error message for URL field', () => {
      render(
        <WebhookConfigFields
          deliveryType="http"
          config={{}}
          onChange={() => {}}
          errors={{ url: 'URL is required' }}
        />
      )

      expect(screen.getByText('URL is required')).toBeInTheDocument()
    })
  })

  describe('SQS delivery type', () => {
    it('renders SQS configuration fields', () => {
      render(
        <WebhookConfigFields
          deliveryType="sqs"
          config={{}}
          onChange={() => {}}
        />
      )

      expect(screen.getByPlaceholderText('https://sqs.us-east-1.amazonaws.com/123456789012/my-queue')).toBeInTheDocument()
      expect(screen.getByText('AWS SQS')).toBeInTheDocument()
    })

    it('renders region dropdown', () => {
      render(
        <WebhookConfigFields
          deliveryType="sqs"
          config={{}}
          onChange={() => {}}
        />
      )

      expect(screen.getByText('Select a region...')).toBeInTheDocument()
    })

    it('renders optional AWS credentials fields', () => {
      render(
        <WebhookConfigFields
          deliveryType="sqs"
          config={{}}
          onChange={() => {}}
        />
      )

      expect(screen.getByPlaceholderText('AKIA...')).toBeInTheDocument()
    })
  })

  describe('SNS delivery type', () => {
    it('renders SNS configuration fields', () => {
      render(
        <WebhookConfigFields
          deliveryType="sns"
          config={{}}
          onChange={() => {}}
        />
      )

      expect(screen.getByPlaceholderText('arn:aws:sns:us-east-1:123456789012:my-topic')).toBeInTheDocument()
      expect(screen.getByText('AWS SNS')).toBeInTheDocument()
    })

    it('shows error message for topic ARN field', () => {
      render(
        <WebhookConfigFields
          deliveryType="sns"
          config={{}}
          onChange={() => {}}
          errors={{ topicArn: 'Topic ARN is required' }}
        />
      )

      expect(screen.getByText('Topic ARN is required')).toBeInTheDocument()
    })
  })

  describe('disabled state', () => {
    it('disables all inputs when disabled prop is true', () => {
      render(
        <WebhookConfigFields
          deliveryType="http"
          config={{}}
          onChange={() => {}}
          disabled
        />
      )

      const urlInput = screen.getByPlaceholderText('https://api.example.com/webhooks')
      expect(urlInput).toBeDisabled()
    })
  })
})
