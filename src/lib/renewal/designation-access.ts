/**
 * Who may change a renewal designation on a contact.
 *
 * Two keys, both required. Editing the contact directory (`/contacts`) and
 * deciding where a merchant's invoice is addressed
 * (`/renewal-retention/subscriptions/manage`) are separate authorities:
 * somebody who may tidy phone numbers is not thereby entitled to redirect a
 * renewal, and somebody who runs renewals is not thereby entitled to edit
 * contacts they cannot otherwise see.
 *
 * `evaluateApiAccess` ORs the paths it is given, so the AND has to be spelled
 * out as two evaluations. Pure, so the matrix is unit-tested.
 */

import { evaluateApiAccess } from "../api-access.ts"
import type { ApiAuthUser } from "../api-access.ts"

export const CONTACTS_PATH = "/contacts"
export const SUBSCRIPTIONS_MANAGE_PATH = "/renewal-retention/subscriptions/manage"

export type DesignationAccess =
  | { allowed: true }
  | { allowed: false; missing: "contacts" | "subscriptions_manage" }

export function evaluateDesignationAccess(
  user: Pick<ApiAuthUser, "role" | "pageAccess">
): DesignationAccess {
  if (!evaluateApiAccess(user, { allowedPaths: [SUBSCRIPTIONS_MANAGE_PATH] }).allowed) {
    return { allowed: false, missing: "subscriptions_manage" }
  }
  if (!evaluateApiAccess(user, { allowedPaths: [CONTACTS_PATH] }).allowed) {
    return { allowed: false, missing: "contacts" }
  }
  return { allowed: true }
}
