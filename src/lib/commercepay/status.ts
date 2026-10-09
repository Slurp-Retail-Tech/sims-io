/**
 * CommercePay payment status codes, mapped to what SIMS does about them.
 *
 * The gateway's table has eighteen codes. SIMS cares about a handful of
 * outcomes: is the money in, is it still coming, or is this attempt over.
 * Everything else is detail that belongs in the audit row, not in a branch.
 *
 * Pure and runtime-free so it can be unit-tested under `node --test`.
 */

export type PaymentState =
  /** Not settled yet; keep waiting or querying. */
  | "pending"
  /** Funds confirmed. The only state that extends a licence. */
  | "paid"
  /** Card authorised but not captured. Treated as pending, never as paid. */
  | "authorized"
  /** The attempt failed for a reason the merchant can retry. */
  | "failed"
  /** The merchant or the gateway cancelled the attempt. */
  | "cancelled"
  /** The session or payment timed out. A new session is needed. */
  | "expired"
  /** Money went back. Never extends; flagged for a person. */
  | "refunded"
  /** A code this table has never seen. Recorded and flagged. */
  | "unknown"

/** Gateway code → SIMS state. From the Payment Status Code Table. */
const STATUS_BY_CODE: Record<number, PaymentState> = {
  0: "pending",
  1: "paid",
  2: "failed",
  3: "cancelled",
  4: "failed", // TransactionLimitExceeded
  5: "failed", // MinTransactionAmountNotMeet
  6: "failed", // InsufficientFunds
  7: "failed", // InvalidTransaction
  8: "cancelled", // UserCancelled
  9: "authorized",
  10: "expired",
  11: "refunded",
  12: "refunded", // ProcessingRefund
  13: "refunded", // FailedRefund: money movement was attempted; a person decides
  18: "cancelled", // Voided
}

export function mapPaymentStatus(code: number | null | undefined): PaymentState {
  if (code === null || code === undefined || !Number.isInteger(code)) {
    return "unknown"
  }
  return STATUS_BY_CODE[code] ?? "unknown"
}

/** True once the attempt cannot change any further on its own. */
export function isTerminalState(state: PaymentState): boolean {
  return state !== "pending" && state !== "authorized" && state !== "unknown"
}

/**
 * True when a session in this state may be replaced by a new attempt.
 *
 * A pending session is reused rather than replaced: CommercePay keeps it
 * alive for retries and reopening the same URL is the documented path.
 */
export function canStartNewSession(state: PaymentState | null): boolean {
  return state === null || state === "failed" || state === "cancelled" || state === "expired"
}
