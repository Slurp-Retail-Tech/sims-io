const DEFAULT_COUNTRY_CODE = "60"

/**
 * Normalizes a lead's telephone number to WhatsApp international format.
 *
 * Lead phones are stored digits-only with no guaranteed country code (validated
 * as `^\d{8,15}$`). Malaysian numbers are commonly entered in local format
 * starting with `0` (e.g. `0123456789`); WhatsApp needs the international form
 * (`60123456789`). So when the number starts with `0` we drop it and prepend a
 * default country code (`LEAD_WHATSAPP_COUNTRY_CODE`, defaulting to `60`).
 * Numbers already in international form are used as-is.
 *
 * Returns null when there are no usable digits.
 */
export function normalizeWhatsappNumber(telephone: string): string | null {
  const digits = telephone.replace(/\D+/g, "")
  if (!digits) {
    return null
  }

  const countryCode = (
    process.env.LEAD_WHATSAPP_COUNTRY_CODE?.trim() || DEFAULT_COUNTRY_CODE
  ).replace(/\D+/g, "")

  if (digits.startsWith("0")) {
    return `${countryCode}${digits.slice(1)}`
  }
  return digits
}

/**
 * Builds a `https://wa.me/<number>` link for a lead's telephone, or null when
 * the number has no usable digits.
 */
export function buildLeadWhatsappUrl(telephone: string): string | null {
  const number = normalizeWhatsappNumber(telephone)
  return number ? `https://wa.me/${number}` : null
}
