"use client"

import type { ComponentProps, ReactNode } from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown } from "lucide-react"
import { FastTooltip } from "@/components/fast-tooltip"
import { cn } from "@/lib/utils"

export function Select({ label, tooltip, options, placeholder, className, ...props }: ComponentProps<typeof SelectPrimitive.Root> & {
  label: string
  tooltip?: string
  options: readonly { value: string, label: string, disabled?: boolean, icon?: ReactNode }[]
  placeholder?: string
  className?: string
}) {
  const trigger = (
    <SelectPrimitive.Trigger className={cn("ob-select", className)} aria-label={label}>
      <SelectPrimitive.Value placeholder={placeholder} /><SelectPrimitive.Icon><ChevronDown size={12} /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
  return <SelectPrimitive.Root {...props}>
    {tooltip ? <FastTooltip label={tooltip}>{trigger}</FastTooltip> : trigger}
    <SelectPrimitive.Portal><SelectPrimitive.Content className="p-menu ob-select-menu ob-pop" position="popper" sideOffset={6} collisionPadding={12}>
      <SelectPrimitive.Viewport>
        {options.map(option => <SelectPrimitive.Item key={option.value} value={option.value} textValue={option.label} disabled={option.disabled} className="ob-menu-item">
          <SelectPrimitive.ItemText>{option.icon ? <span className="inline-flex items-center gap-1.5">{option.icon}{option.label}</span> : option.label}</SelectPrimitive.ItemText>
          <SelectPrimitive.ItemIndicator><Check size={12} /></SelectPrimitive.ItemIndicator>
        </SelectPrimitive.Item>)}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content></SelectPrimitive.Portal>
  </SelectPrimitive.Root>
}
