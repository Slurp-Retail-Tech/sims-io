import { hashOpaqueToken, resolveAppBaseUrl } from "@/lib/auth"
import { sendMail } from "@/lib/mail"

type AuthEmailInput = {
  email: string
  name: string
  token: string
  origin?: string
}

type AuthEmailTemplateInput = {
  preheader: string
  eyebrow: string
  title: string
  intro: string
  actionLabel: string
  actionUrl: string
  expiryLabel: string
  supportCopy: string
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

async function sendEmail(input: {
  to: string
  subject: string
  html: string
  text: string
}) {
  await sendMail(input)
}

function buildActivationUrl(token: string, origin?: string) {
  return `${resolveAppBaseUrl(origin)}/activate?token=${encodeURIComponent(token)}`
}

function buildResetUrl(token: string, origin?: string) {
  return `${resolveAppBaseUrl(origin)}/reset-password?token=${encodeURIComponent(token)}`
}

function buildAuthEmailHtml(name: string, input: AuthEmailTemplateInput) {
  const safeName = escapeHtml(name)
  const safeUrl = escapeHtml(input.actionUrl)

  return `
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      ${escapeHtml(input.preheader)}
    </div>
    <div style="margin:0;padding:32px 16px;background:linear-gradient(180deg,#f3f4f6 0%,#e5e7eb 100%);font-family:Arial,sans-serif;color:#111827;">
      <div style="max-width:640px;margin:0 auto;">
        <div style="margin-bottom:16px;text-align:center;font-size:12px;letter-spacing:0.24em;text-transform:uppercase;color:#6b7280;">
          SIMS
        </div>
        <div style="overflow:hidden;border:1px solid #e5e7eb;border-radius:24px;background:#ffffff;box-shadow:0 18px 50px rgba(15,23,42,0.08);">
          <div style="padding:32px;background:linear-gradient(135deg,#111827 0%,#1f2937 60%,#0f766e 100%);color:#ffffff;">
            <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;opacity:0.8;">
              ${escapeHtml(input.eyebrow)}
            </div>
            <div style="margin-top:12px;font-size:30px;font-weight:700;line-height:1.15;">
              ${escapeHtml(input.title)}
            </div>
            <div style="margin-top:12px;font-size:15px;line-height:1.7;color:rgba(255,255,255,0.84);">
              Hello ${safeName},
            </div>
          </div>
          <div style="padding:32px 32px 20px;">
            <p style="margin:0;font-size:15px;line-height:1.8;color:#374151;">
              ${escapeHtml(input.intro)}
            </p>
            <div style="margin-top:28px;margin-bottom:28px;text-align:center;">
              <a
                href="${safeUrl}"
                style="display:inline-block;border-radius:999px;background:#0f766e;padding:14px 24px;font-size:14px;font-weight:700;letter-spacing:0.02em;color:#ffffff;text-decoration:none;"
              >
                ${escapeHtml(input.actionLabel)}
              </a>
            </div>
            <div style="border-radius:18px;background:#f9fafb;padding:18px 20px;">
              <div style="font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#6b7280;">
                Secure Link
              </div>
              <div style="margin-top:10px;font-size:14px;line-height:1.7;word-break:break-word;color:#111827;">
                <a href="${safeUrl}" style="color:#0f766e;text-decoration:none;">${safeUrl}</a>
              </div>
            </div>
            <div style="margin-top:24px;font-size:14px;line-height:1.8;color:#4b5563;">
              <strong style="color:#111827;">Expiry:</strong> ${escapeHtml(input.expiryLabel)}
            </div>
            <div style="margin-top:8px;font-size:14px;line-height:1.8;color:#4b5563;">
              ${escapeHtml(input.supportCopy)}
            </div>
          </div>
          <div style="border-top:1px solid #e5e7eb;padding:18px 32px;background:#f9fafb;font-size:12px;line-height:1.7;color:#6b7280;">
            Sent by SIMS account security.
          </div>
        </div>
      </div>
    </div>
  `
}

export async function sendActivationEmail(input: AuthEmailInput) {
  const url = buildActivationUrl(input.token, input.origin)
  await sendEmail({
    to: input.email,
    subject: "Activate your SIMS account",
    html: buildAuthEmailHtml(input.name, {
      preheader: "Activate your SIMS account and set your password.",
      eyebrow: "Account Activation",
      title: "Your account is ready",
      intro: "Activate your SIMS account and set your password using the secure link below.",
      actionLabel: "Activate account",
      actionUrl: url,
      expiryLabel: "This activation link expires in 24 hours.",
      supportCopy: "If you were not expecting this email, you can ignore it.",
    }),
    text: `Hello ${input.name},\n\nYour SIMS account is ready. Activate it and set your password here:\n${url}\n\nThis link expires in 24 hours.`,
  })
}

export async function sendResetPasswordEmail(input: AuthEmailInput) {
  const url = buildResetUrl(input.token, input.origin)
  await sendEmail({
    to: input.email,
    subject: "Reset your SIMS password",
    html: buildAuthEmailHtml(input.name, {
      preheader: "Reset your SIMS password securely.",
      eyebrow: "Password Reset",
      title: "Reset your password",
      intro: "We received a request to reset your SIMS password. Use the secure link below to choose a new password.",
      actionLabel: "Reset password",
      actionUrl: url,
      expiryLabel: "This password reset link expires in 1 hour.",
      supportCopy: "If you did not request this, you can ignore this email and your password will remain unchanged.",
    }),
    text: `Hello ${input.name},\n\nWe received a password reset request for your SIMS account. Reset your password here:\n${url}\n\nThis link expires in 1 hour. If you did not request this, you can ignore this email.`,
  })
}

export async function createStoredTokenRecord(input: {
  connection: {
    query: (sql: string, values?: unknown[]) => Promise<unknown>
  }
  userId: string
  type: "activation" | "password_reset"
  token: string
  expiresAt: Date
}) {
  await input.connection.query(
    `
      INSERT INTO auth_tokens (user_id, type, token_hash, expires_at)
      VALUES (?, ?, ?, ?)
    `,
    [input.userId, input.type, hashOpaqueToken(input.token), input.expiresAt]
  )
}
