"use client"

import * as React from "react"
import { Mail, MessageCircle } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type Channel = "whatsapp" | "email"
type ChannelState = { channel: Channel; isEnabled: boolean }

const CHANNEL_LABELS: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
}

const CHANNEL_ICONS: Record<Channel, typeof Mail> = {
  whatsapp: MessageCircle,
  email: Mail,
}

type ContactChannelsCardProps = {
  contactId: string
  /** The contact's email, so an enabled email channel can be shown as unusable. */
  email: string | null
  hasPhone: boolean
  onError: (message: string) => void
}

/**
 * Which channels this contact is reachable on for renewals.
 *
 * Both may be enabled, and every renewal message goes to every enabled
 * channel. There is no fallback between them: a contact who wants both enables
 * both, and a failure on one is retried on that one rather than rerouted onto
 * a channel they did not ask for.
 *
 * An enabled channel with no phone number or no email address is called out
 * here, because the nightly run will otherwise report it as a gap nobody on
 * this screen could see.
 */
export function ContactChannelsCard({
  contactId,
  email,
  hasPhone,
  onError,
}: ContactChannelsCardProps) {
  const [channels, setChannels] = React.useState<ChannelState[]>([])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/contacts/${contactId}/channels`, {
        cache: "no-store",
      })
      if (response.ok) {
        const payload = (await response.json()) as { channels: ChannelState[] }
        setChannels(payload.channels ?? [])
      }
    } catch {
      // Left silent: a channel list that fails to load is not worth a toast on
      // a page whose main content loaded fine. The card shows its empty state.
    } finally {
      setLoading(false)
    }
  }, [contactId])

  React.useEffect(() => {
    void load()
  }, [load])

  const enabled = (channel: Channel) =>
    channels.some((entry) => entry.channel === channel && entry.isEnabled)

  async function toggle(channel: Channel) {
    const next: ChannelState[] = (["whatsapp", "email"] as const)
      .map((candidate) => ({
        channel: candidate,
        isEnabled:
          candidate === channel ? !enabled(candidate) : enabled(candidate),
      }))
      .filter((entry) => entry.isEnabled)

    setSaving(true)
    try {
      const response = await fetch(`/api/contacts/${contactId}/channels`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels: next }),
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string
        }
        onError(payload.error ?? "Unable to save channels.")
        return
      }
      const payload = (await response.json()) as { channels: ChannelState[] }
      setChannels(payload.channels ?? [])
    } catch {
      onError("Unable to reach the server. Try again.")
    } finally {
      setSaving(false)
    }
  }

  function missingField(channel: Channel): string | null {
    if (!enabled(channel)) {
      return null
    }
    if (channel === "whatsapp" && !hasPhone) {
      return "No phone number on this contact, so WhatsApp cannot be used."
    }
    if (channel === "email" && !email?.trim()) {
      return "No email address on this contact, so email cannot be used."
    }
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Renewal channels</CardTitle>
        <CardDescription>
          Renewal reminders and receipts go to every channel enabled here. There
          is no fallback between them.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {loading ? (
          <p className="text-muted-foreground text-sm">Loading channels…</p>
        ) : (
          (["whatsapp", "email"] as const).map((channel) => {
            const Icon = CHANNEL_ICONS[channel]
            const missing = missingField(channel)
            return (
              <div key={channel} className="flex flex-col gap-1">
                <label className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={enabled(channel)}
                    disabled={saving}
                    onChange={() => void toggle(channel)}
                  />
                  <Icon className="text-muted-foreground size-4" />
                  {CHANNEL_LABELS[channel]}
                </label>
                {missing ? (
                  <p className="text-destructive pl-10 text-xs">{missing}</p>
                ) : null}
              </div>
            )
          })
        )}
        {!loading && channels.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No channel enabled. This contact cannot be a renewal PIC until one
            is.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
