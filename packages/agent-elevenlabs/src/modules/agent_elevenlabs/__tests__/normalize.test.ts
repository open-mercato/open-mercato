import {
  ElevenLabsAudioOnlyCallbackError,
  ElevenLabsCallbackShapeError,
  normalizeElevenLabsCallback,
} from '../lib/normalize'
import { voiceCallResultSchema } from '../data/validators'

/**
 * A realistic `post_call_transcription` payload, shaped from the documented
 * webhook body: the agent asked whether the renewal is still on, the human
 * answered, and the ElevenLabs agent's data-collection schema extracted three
 * fields from that answer.
 */
const TRANSCRIPTION_PAYLOAD = {
  type: 'post_call_transcription',
  event_timestamp: 1_800_000_120,
  data: {
    agent_id: 'agent_abc123',
    agent_name: 'Renewal check-in',
    conversation_id: 'conv_9f2c',
    status: 'done',
    user_id: null,
    transcript: [
      { role: 'agent', message: 'Hi Anna, this is the ACME account desk.', time_in_call_secs: 0 },
      { role: 'user', message: 'Yes, hi.', time_in_call_secs: 4 },
      { role: 'agent', message: null, time_in_call_secs: 6 },
      {
        role: 'user',
        message: 'We do want to renew, but only after the security review lands next week.',
        time_in_call_secs: 12,
      },
    ],
    metadata: { call_duration_secs: 74, cost: 132 },
    analysis: {
      evaluation_criteria_results: {
        reached_decision_maker: { result: 'success', rationale: 'Anna confirmed her identity.' },
        stayed_on_script: { result: 'success', rationale: null },
      },
      data_collection_results: {
        owner_decision: { value: 'renew', rationale: 'She said they do want to renew.' },
        blocker: { value: 'security review', rationale: 'Named as the only blocker.' },
        callback_requested: { value: false, rationale: 'Not asked for.' },
        followup_window_days: { value: 7, rationale: 'Next week.' },
        raw_notes: { value: { source: 'call' }, rationale: 'structured extra' },
      },
      call_successful: 'success',
      transcript_summary: 'Anna confirmed the renewal is intended once the security review completes.',
    },
    conversation_initiation_client_data: {
      dynamic_variables: { brief: 'The ACME renewal deal has gone quiet.', om_callback_url: 'https://app/x' },
    },
    has_audio: true,
    has_user_audio: true,
    has_response_audio: true,
  },
}

describe('normalizeElevenLabsCallback — post_call_transcription', () => {
  it('produces a payload that satisfies the declared OUTCOME envelope', () => {
    const result = normalizeElevenLabsCallback(TRANSCRIPTION_PAYLOAD)
    expect(voiceCallResultSchema.safeParse(result).success).toBe(true)
    expect(result.kind).toBe('researcher')
  })

  it('flattens analysis.data_collection_results to key -> value', () => {
    const { data } = normalizeElevenLabsCallback(TRANSCRIPTION_PAYLOAD)
    expect(data.collected).toEqual({
      owner_decision: 'renew',
      blocker: 'security review',
      callback_requested: false,
      followup_window_days: 7,
      // A structured collected value is serialised rather than dropped.
      raw_notes: '{"source":"call"}',
    })
  })

  it('carries the summary, the provider verdict, the duration and the conversation id', () => {
    const { data } = normalizeElevenLabsCallback(TRANSCRIPTION_PAYLOAD)
    expect(data.conversationId).toBe('conv_9f2c')
    expect(data.status).toBe('done')
    expect(data.callSuccessful).toBe('success')
    expect(data.summary).toContain('security review')
    expect(data.durationSeconds).toBe(74)
    expect(data.failureReason).toBeNull()
  })

  it('carries evaluation criteria with their rationale', () => {
    const { data } = normalizeElevenLabsCallback(TRANSCRIPTION_PAYLOAD)
    expect(data.criteria.reached_decision_maker).toEqual({
      result: 'success',
      rationale: 'Anna confirmed her identity.',
    })
    expect(data.criteria.stayed_on_script.rationale).toBeNull()
  })

  it('keeps the transcript in order, including a turn with no spoken text', () => {
    const { data } = normalizeElevenLabsCallback(TRANSCRIPTION_PAYLOAD)
    expect(data.transcript).toHaveLength(4)
    expect(data.transcript[2]).toEqual({ role: 'agent', message: null, timeInCallSecs: 6 })
  })

  it('reports reached=true when a human actually spoke', () => {
    expect(normalizeElevenLabsCallback(TRANSCRIPTION_PAYLOAD).data.reached).toBe(true)
  })

  it('reports reached=false for a completed call with no user turn (voicemail)', () => {
    const voicemail = {
      ...TRANSCRIPTION_PAYLOAD,
      data: {
        ...TRANSCRIPTION_PAYLOAD.data,
        transcript: [{ role: 'agent', message: 'Please call us back.', time_in_call_secs: 0 }],
      },
    }
    const { data } = normalizeElevenLabsCallback(voicemail)
    expect(data.reached).toBe(false)
    expect(data.status).toBe('done')
  })

  it('tolerates a payload with no analysis block at all', () => {
    const bare = {
      type: 'post_call_transcription',
      data: { conversation_id: 'conv_bare', status: 'failed' },
    }
    const { data } = normalizeElevenLabsCallback(bare)
    expect(data).toMatchObject({
      conversationId: 'conv_bare',
      status: 'failed',
      reached: false,
      callSuccessful: 'unknown',
      summary: null,
      collected: {},
      criteria: {},
      transcript: [],
      durationSeconds: null,
    })
  })
})

describe('normalizeElevenLabsCallback — call_initiation_failure', () => {
  const payload = {
    type: 'call_initiation_failure',
    data: {
      agent_id: 'agent_abc123',
      conversation_id: 'conv_none',
      failure_reason: 'destination number is not reachable',
      metadata: {},
    },
  }

  it('maps to a valid researcher outcome rather than throwing', () => {
    const result = normalizeElevenLabsCallback(payload)
    expect(voiceCallResultSchema.safeParse(result).success).toBe(true)
  })

  it('reports reached=false with the provider reason, so the author can branch on it', () => {
    const { data } = normalizeElevenLabsCallback(payload)
    expect(data.reached).toBe(false)
    expect(data.status).toBe('initiation_failed')
    expect(data.callSuccessful).toBe('failure')
    expect(data.failureReason).toBe('destination number is not reachable')
    expect(data.collected).toEqual({})
  })
})

describe('normalizeElevenLabsCallback — post_call_audio and unknown types', () => {
  it('throws a typed error for an audio-only delivery', () => {
    expect(() =>
      normalizeElevenLabsCallback({
        type: 'post_call_audio',
        data: { agent_id: 'agent_abc123', conversation_id: 'conv_9f2c', full_audio: 'SUQzBA==' },
      }),
    ).toThrow(ElevenLabsAudioOnlyCallbackError)
  })

  it('throws for an unknown callback type', () => {
    expect(() => normalizeElevenLabsCallback({ type: 'post_call_telepathy' })).toThrow(
      ElevenLabsCallbackShapeError,
    )
  })

  it('throws when the payload has no type at all', () => {
    expect(() => normalizeElevenLabsCallback({ data: {} })).toThrow(ElevenLabsCallbackShapeError)
  })
})
