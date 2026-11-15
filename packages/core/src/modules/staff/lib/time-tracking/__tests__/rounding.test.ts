import { roundMinutes } from '../rounding'
import type { RoundingDirection, RoundingUnitMinutes } from '../rounding'

const UNITS: RoundingUnitMinutes[] = [0, 5, 10, 15]
const DIRECTIONS: RoundingDirection[] = ['up', 'nearest']

describe('roundMinutes', () => {
  it('is the identity function when the unit is 0', () => {
    for (const direction of DIRECTIONS) {
      expect(roundMinutes(0, { unitMinutes: 0, direction })).toBe(0)
      expect(roundMinutes(1, { unitMinutes: 0, direction })).toBe(1)
      expect(roundMinutes(62, { unitMinutes: 0, direction })).toBe(62)
      expect(roundMinutes(1439, { unitMinutes: 0, direction })).toBe(1439)
    }
  })

  it('rounds up to the next 15-minute unit', () => {
    const settings = { unitMinutes: 15, direction: 'up' } as const
    expect(roundMinutes(62, settings)).toBe(75)
    expect(roundMinutes(76, settings)).toBe(90)
    expect(roundMinutes(3, settings)).toBe(15)
    expect(roundMinutes(120, settings)).toBe(120)
  })

  it('leaves exact multiples untouched in every unit and direction', () => {
    for (const unitMinutes of UNITS) {
      for (const direction of DIRECTIONS) {
        expect(roundMinutes(120, { unitMinutes, direction })).toBe(120)
        expect(roundMinutes(0, { unitMinutes, direction })).toBe(0)
      }
    }
  })

  it('rounds up for every unit', () => {
    expect(roundMinutes(1, { unitMinutes: 5, direction: 'up' })).toBe(5)
    expect(roundMinutes(6, { unitMinutes: 5, direction: 'up' })).toBe(10)
    expect(roundMinutes(1, { unitMinutes: 10, direction: 'up' })).toBe(10)
    expect(roundMinutes(11, { unitMinutes: 10, direction: 'up' })).toBe(20)
    expect(roundMinutes(1, { unitMinutes: 15, direction: 'up' })).toBe(15)
  })

  it('rounds to the nearest unit', () => {
    expect(roundMinutes(62, { unitMinutes: 15, direction: 'nearest' })).toBe(60)
    expect(roundMinutes(68, { unitMinutes: 15, direction: 'nearest' })).toBe(75)
    expect(roundMinutes(2, { unitMinutes: 5, direction: 'nearest' })).toBe(0)
    expect(roundMinutes(3, { unitMinutes: 5, direction: 'nearest' })).toBe(5)
    expect(roundMinutes(4, { unitMinutes: 10, direction: 'nearest' })).toBe(0)
    expect(roundMinutes(6, { unitMinutes: 10, direction: 'nearest' })).toBe(10)
  })

  it('breaks a nearest-direction tie away from zero', () => {
    expect(roundMinutes(7.5, { unitMinutes: 15, direction: 'nearest' })).toBe(15)
    expect(roundMinutes(2.5, { unitMinutes: 5, direction: 'nearest' })).toBe(5)
  })

  it('rounds away from zero for negative input', () => {
    expect(roundMinutes(-3, { unitMinutes: 15, direction: 'up' })).toBe(-15)
    expect(roundMinutes(-62, { unitMinutes: 15, direction: 'nearest' })).toBe(-60)
  })

  it('always returns a multiple of the unit', () => {
    for (const unitMinutes of UNITS.filter((unit) => unit !== 0)) {
      for (const direction of DIRECTIONS) {
        for (let raw = 0; raw <= 200; raw += 1) {
          expect(roundMinutes(raw, { unitMinutes, direction }) % unitMinutes).toBe(0)
        }
      }
    }
  })

  it('never rounds down when the direction is up', () => {
    for (const unitMinutes of UNITS.filter((unit) => unit !== 0)) {
      for (let raw = 0; raw <= 200; raw += 1) {
        expect(roundMinutes(raw, { unitMinutes, direction: 'up' })).toBeGreaterThanOrEqual(raw)
      }
    }
  })

  it('treats non-finite input as zero', () => {
    expect(roundMinutes(Number.NaN, { unitMinutes: 15, direction: 'up' })).toBe(0)
  })
})
