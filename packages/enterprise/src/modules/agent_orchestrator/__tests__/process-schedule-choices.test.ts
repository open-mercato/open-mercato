import { readScheduleChoice, scheduleChoiceCron } from '../backend/processes/definitions/scheduleChoices'

test.each([
  ['15 9 * * *', 'daily', '09:15', '1'],
  ['0 7 * * 1-5', 'weekdays', '07:00', '1'],
  ['30 16 * * 0', 'weekly', '16:30', '0'],
])('round-trips a familiar schedule %s', (cron, frequency, time, weekday) => {
  const choice = readScheduleChoice(cron)
  expect(choice).toEqual({ frequency, time, weekday })
  expect(scheduleChoiceCron(choice)).toBe(cron)
})

test('custom schedules cannot be silently converted to daily schedules', () => {
  const choice = readScheduleChoice('*/15 8-18 * * 1,3,5')
  expect(choice.frequency).toBe('custom')
  expect(scheduleChoiceCron(choice)).toBeNull()
})

test('invalid or incomplete times cannot produce a cron schedule', () => {
  expect(scheduleChoiceCron({ frequency: 'daily', time: '25:90', weekday: '1' })).toBeNull()
  expect(scheduleChoiceCron({ frequency: 'weekly', time: '', weekday: '1' })).toBeNull()
})
