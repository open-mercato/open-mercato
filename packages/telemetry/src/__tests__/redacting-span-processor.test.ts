import { ROOT_CONTEXT } from '@opentelemetry/api'
import { BasicTracerProvider, type ReadableSpan, type SpanProcessor } from '@opentelemetry/sdk-trace-base'
import { createRedactingSpanProcessor } from '../provider/redacting-span-processor'

function recordingProcessor() {
  return {
    onStart: jest.fn(),
    onEnding: jest.fn(),
    onEnd: jest.fn<void, [ReadableSpan]>(),
    forceFlush: jest.fn(async () => {}),
    shutdown: jest.fn(async () => {}),
  } satisfies SpanProcessor
}

describe('redacting span processor', () => {
  it('preserves the lifecycle, readable metadata, and original span across multiple processors', async () => {
    const first = recordingProcessor()
    const second = recordingProcessor()
    const provider = new BasicTracerProvider({
      spanProcessors: [first, second].map(createRedactingSpanProcessor),
    })
    try {
      const span = provider.getTracer('url-regression').startSpan('GET /portal?token=private', {}, ROOT_CONTEXT)
      span.setAttributes({ 'http.target': '/portal?token=private', 'http.response.status_code': 200 })
      span.addEvent('request.finished')
      span.end()

      for (const processor of [first, second]) {
        expect(processor.onStart).toHaveBeenCalledWith(span, ROOT_CONTEXT)
        expect(processor.onEnding).toHaveBeenCalledWith(span)
        const cleaned = processor.onEnd.mock.calls[0][0]
        expect(cleaned.name).toBe('GET /portal?token=[redacted]')
        expect(cleaned.attributes).toEqual({
          'http.target': '/portal?token=[redacted]',
          'http.response.status_code': 200,
        })
        expect(cleaned.spanContext()).toEqual(span.spanContext())
        expect(cleaned).toMatchObject({
          ended: true,
          droppedAttributesCount: 0,
          droppedEventsCount: 0,
          droppedLinksCount: 0,
          instrumentationScope: { name: 'url-regression' },
          events: [expect.objectContaining({ name: 'request.finished' })],
        })
        expect(cleaned.duration).toHaveLength(2)
        expect(cleaned.resource).toBeDefined()
        const original = processor.onStart.mock.calls[0][0] as ReadableSpan
        expect(original.name).toBe('GET /portal?token=private')
        expect(original.attributes['http.target']).toBe('/portal?token=private')
      }
      await provider.forceFlush()
      expect(first.forceFlush).toHaveBeenCalledTimes(1)
      expect(second.forceFlush).toHaveBeenCalledTimes(1)
    } finally {
      await provider.shutdown()
    }
    expect(first.shutdown).toHaveBeenCalledTimes(1)
    expect(second.shutdown).toHaveBeenCalledTimes(1)
  })

  it('cleans string URL attribute arrays and supports processors without onEnding', async () => {
    const processor = recordingProcessor()
    const wrapper = createRedactingSpanProcessor({ ...processor, onEnding: undefined })
    const provider = new BasicTracerProvider({ spanProcessors: [wrapper] })
    try {
      const span = provider.getTracer('array-regression').startSpan('request')
      span.setAttributes({ 'url.full': ['https://example.com?code=private', null], 'retry.delays': [1, 2] })
      span.end()
      expect(processor.onEnd.mock.calls[0][0].attributes).toEqual({
        'url.full': ['https://example.com?code=[redacted]', null],
        'retry.delays': [1, 2],
      })
    } finally {
      await provider.shutdown()
    }
  })
})
