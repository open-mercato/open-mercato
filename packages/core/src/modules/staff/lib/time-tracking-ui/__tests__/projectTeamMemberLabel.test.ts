/**
 * The project form's Team chips are labelled from `/api/staff/team-members`,
 * which answers in snake_case. Reading only the camelCase key fell through every
 * fallback and printed the staff-member UUID on screen.
 */
import { __testing } from '../ProjectFormSections'

const { memberLabel } = __testing

describe('memberLabel', () => {
  it('reads the snake_case display_name the API actually returns', () => {
    expect(memberLabel({ id: '0f08892b-5b01-41d9-a355-ecde91147e59', display_name: 'Marta Lopez' }))
      .toBe('Marta Lopez')
  })

  it('still reads a camelCase displayName', () => {
    expect(memberLabel({ id: 'x', displayName: 'Alex Chen' })).toBe('Alex Chen')
  })

  it('never falls back to the id', () => {
    // A UUID on a chip reads as data corruption to anyone looking at the screen;
    // the caller filters empty labels out, so nothing is rendered instead.
    expect(memberLabel({ id: '0f08892b-5b01-41d9-a355-ecde91147e59' })).toBe('')
  })

  it('falls back to first and last name, then email', () => {
    expect(memberLabel({ id: 'x', first_name: 'Priya', last_name: 'Nair' })).toBe('Priya Nair')
    expect(memberLabel({ id: 'x', email: 'jordan@example.com' })).toBe('jordan@example.com')
  })
})
