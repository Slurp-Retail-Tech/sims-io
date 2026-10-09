/**
 * Today's date in the application's timezone, as `YYYY-MM-DD`.
 *
 * The pool runs at UTC and the server may run anywhere. Every "is this due /
 * lapsed / inside the grace window" decision has to agree on which day it is,
 * and that day is the one in Kuala Lumpur, where the merchants are.
 */
export const APP_TIME_ZONE = "Asia/Kuala_Lumpur"

export function todayInAppZone(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}
