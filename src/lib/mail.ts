import "server-only"

import nodemailer from "nodemailer"

type SendMailInput = {
  to: string | string[]
  subject: string
  html: string
  text: string
}

let cachedTransporter: nodemailer.Transporter | null = null

function readRequiredEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is not configured.`)
  }

  return value
}

function resolveSmtpConfig() {
  const host = process.env.SMTP_HOST?.trim() || "smtp.gmail.com"
  const portRaw = process.env.SMTP_PORT?.trim() || "465"
  const secureRaw = process.env.SMTP_SECURE?.trim()?.toLowerCase() || "true"
  const port = Number.parseInt(portRaw, 10)

  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("SMTP_PORT must be a valid positive number.")
  }

  return {
    host,
    port,
    secure: secureRaw === "true",
    user: readRequiredEnv("SMTP_USER"),
    pass: readRequiredEnv("SMTP_PASS"),
    fromEmail: readRequiredEnv("SMTP_FROM_EMAIL"),
    fromName: process.env.SMTP_FROM_NAME?.trim() || "SIMS",
  }
}

function getTransporter() {
  if (cachedTransporter) {
    return cachedTransporter
  }

  const config = resolveSmtpConfig()
  cachedTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    // Without these nodemailer waits on the OS socket timeout, so an SMTP host
    // that accepts a connection and then stalls holds the request open for
    // minutes. The transporter is cached and shared, so it is pooled with a
    // small ceiling rather than opening a connection per send.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    pool: true,
    maxConnections: 3,
  })

  return cachedTransporter
}

function resolveFromAddress() {
  const { fromEmail, fromName } = resolveSmtpConfig()
  return fromName ? `${fromName} <${fromEmail}>` : fromEmail
}

export async function sendMail(input: SendMailInput) {
  const transporter = getTransporter()

  await transporter.sendMail({
    from: resolveFromAddress(),
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  })
}

