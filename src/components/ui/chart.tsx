"use client"

import * as React from "react"
import * as RechartsPrimitive from "recharts"

import { cn } from "@/lib/utils"

export type ChartConfig = {
  [k: string]: {
    label?: React.ReactNode
    icon?: React.ComponentType
    color?: string
  }
}

type ChartContextProps = {
  config: ChartConfig
}

const ChartContext = React.createContext<ChartContextProps | null>(null)

function useChart() {
  const context = React.useContext(ChartContext)
  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />")
  }
  return context
}

const VALID_CSS_KEY = /^[a-zA-Z0-9_-]+$/
const VALID_CSS_COLOR = /^(#[0-9a-fA-F]{3,8}|rgb\(|hsl\(|var\(--)/
const CSS_COLOR_SAFE = /^[a-zA-Z0-9#(),.\s%+-]+$/
function safeCssColor(value: string): string {
  return CSS_COLOR_SAFE.test(value) ? value : "transparent"
}

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const colorConfig = Object.entries(config).filter(
    ([key, cfg]) =>
      cfg.color &&
      VALID_CSS_KEY.test(key) &&
      VALID_CSS_COLOR.test(cfg.color)
  )

  if (!colorConfig.length) {
    return null
  }

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
${colorConfig
  .map(([key, cfg]) => {
    return `[data-chart=${id}] { --color-${key}: ${safeCssColor(cfg.color!)}; }`
  })
  .join("\n")}
`,
      }}
    />
  )
}

export function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig
  children: React.ComponentProps<
    typeof RechartsPrimitive.ResponsiveContainer
  >["children"]
}) {
  const uniqueId = React.useId().replace(/:/g, "")
  const chartId = `chart-${id ?? uniqueId}`

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart={chartId}
        className={cn(
          "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-legend-item-text]:text-foreground [&_.recharts-tooltip-cursor]:stroke-border [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border w-full min-w-0 text-xs",
          className
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <div className="h-full w-full min-w-0">
          <RechartsPrimitive.ResponsiveContainer width="100%" height="100%">
            {children}
          </RechartsPrimitive.ResponsiveContainer>
        </div>
      </div>
    </ChartContext.Provider>
  )
}

export const ChartTooltip = RechartsPrimitive.Tooltip

type TooltipPayloadItem = {
  dataKey?: string | number
  name?: string | number
  value?: unknown
  color?: string
  payload?: {
    fill?: string
    [key: string]: unknown
  }
}

type ChartTooltipContentProps = {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: unknown
  className?: string
  labelKey?: string
  labelFormatter?: (label: unknown, payload: TooltipPayloadItem[]) => React.ReactNode
  formatter?: (
    value: unknown,
    name: string | number | undefined,
    item: TooltipPayloadItem,
    index: number
  ) => React.ReactNode
  hideLabel?: boolean
  hideIndicator?: boolean
  indicator?: "line" | "dot" | "dashed"
}

function toTooltipDisplayValue(value: unknown) {
  if (typeof value === "string" || typeof value === "number") {
    return value
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }
  if (value === null || value === undefined) {
    return "--"
  }
  return String(value)
}

export function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = "dot",
  hideLabel = false,
  hideIndicator = false,
  label,
  labelKey,
  labelFormatter,
  formatter,
}: ChartTooltipContentProps) {
  const { config } = useChart()

  if (!active || !payload?.length) {
    return null
  }

  const tooltipLabel = (() => {
    if (hideLabel) {
      return null
    }

    const [item] = payload
    const key = `${item.dataKey ?? item.name ?? "value"}`
    const itemConfig = config[labelKey ?? key]
    const value =
      labelFormatter?.(label, payload) ??
      itemConfig?.label ??
      (typeof label === "string" ? label : null)

    if (value === null || value === undefined) {
      return null
    }

    return <div className="font-medium">{value}</div>
  })()

  return (
    <div
      className={cn(
        "bg-background/95 border-border grid min-w-[10rem] gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl",
        className
      )}
    >
      {tooltipLabel}
      <div className="grid gap-1">
        {payload.map((item, index) => {
          const key = `${item.dataKey ?? item.name ?? index}`
          const itemConfig = config[key]
          const indicatorColor = item.color ?? item.payload?.fill ?? `var(--color-${key})`

          return (
            <div
              key={key}
              className="flex w-full items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2">
                {!hideIndicator ? (
                  <span
                    className={cn("shrink-0 rounded-[2px]", {
                      "h-2 w-2 rounded-full": indicator === "dot",
                      "h-3 w-0.5": indicator === "line",
                      "h-0.5 w-3 border border-dashed bg-transparent":
                        indicator === "dashed",
                    })}
                    style={{
                      backgroundColor:
                        indicator === "dashed" ? "transparent" : indicatorColor,
                      borderColor: indicatorColor,
                    }}
                  />
                ) : null}
                <span className="text-muted-foreground">
                  {itemConfig?.label ?? item.name}
                </span>
              </div>
              <span className="font-mono font-medium tabular-nums">
                {formatter
                  ? formatter(item.value, item.name, item, index)
                  : toTooltipDisplayValue(item.value)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export const ChartLegend = RechartsPrimitive.Legend

type LegendPayloadItem = {
  dataKey?: string | number
  color?: string
  value?: React.ReactNode
}

type ChartLegendContentProps = React.ComponentProps<"div"> & {
  payload?: LegendPayloadItem[]
  verticalAlign?: "top" | "bottom" | "middle"
  hideIcon?: boolean
}

export function ChartLegendContent({
  className,
  payload,
  verticalAlign = "bottom",
  hideIcon = false,
}: ChartLegendContentProps) {
  const { config } = useChart()

  if (!payload?.length) {
    return null
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-4",
        verticalAlign === "top" ? "pb-3" : "pt-3",
        className
      )}
    >
      {payload.map((item) => {
        const key = `${item.dataKey ?? "value"}`
        const itemConfig = config[key]

        return (
          <div key={key} className="flex items-center gap-1.5">
            {hideIcon ? null : (
              <span
                className="h-2 w-2 rounded-[2px]"
                style={{
                  backgroundColor: item.color ?? `var(--color-${key})`,
                }}
              />
            )}
            <span className="text-muted-foreground">{itemConfig?.label ?? item.value}</span>
          </div>
        )
      })}
    </div>
  )
}
