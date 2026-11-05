"use client"

import type { ComponentProps } from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

export function Select({ label, options, placeholder, className, ...props }: ComponentProps<typeof SelectPrimitive.Root> & {
  label: string
  options: readonly { value: string, label: string, disabled?: boolean }[]
  placeholder?: string
  className?: string
}) {
  return <SelectPrimitive.Root {...props}>
    <SelectPrimitive.Trigger className={cn("ob-select", className)} aria-label={label}>
      <SelectPrimitive.Value placeholder={placeholder} /><SelectPrimitive.Icon><ChevronDown size={12} /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal><SelectPrimitive.Content className="p-menu ob-select-menu ob-pop" position="popper" sideOffset={6} collisionPadding={12}>
      <SelectPrimitive.Viewport>
        {options.map(option => <SelectPrimitive.Item key={option.value} value={option.value} disabled={option.disabled} className="ob-menu-item">
          <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
          <SelectPrimitive.ItemIndicator><Check size={12} /></SelectPrimitive.ItemIndicator>
        </SelectPrimitive.Item>)}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content></SelectPrimitive.Portal>
  </SelectPrimitive.Root>
}
