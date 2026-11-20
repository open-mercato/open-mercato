export class ReservationNotActiveError extends Error {
  constructor() {
    super('[internal] Reservation is no longer active')
    this.name = 'ReservationNotActiveError'
  }
}
