"use client"

import { useEffect, useRef } from "react"
import { pullProjectUpdatesAction } from "@/app/actions"
import type { OverleafGitStatus } from "@/lib/tex-project/overleaf-git"

type Options = {
  project: string
  isBusy: () => boolean
  canPull: () => boolean
  check: () => Promise<OverleafGitStatus | undefined>
  onApplying: (applying: boolean) => void
  onApplied: () => Promise<void>
  onError: (message: string) => void
}

/** A single awaited check/pull loop per visible editor, with error backoff. */
export function useGitAutoSync(options: Options) {
  const latest = useRef(options)
  latest.current = options
  useEffect(() => {
    let stopped = false
    let running = false
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const visible = () => document.visibilityState === "visible"
    const reviewing = () => Boolean(document.querySelector("dialog[open]"))
    const schedule = (delay = Math.min(60_000, 5_000 * 2 ** failures)) => {
      if (timer) clearTimeout(timer)
      if (!stopped && visible()) timer = setTimeout(() => void tick(), delay)
    }
    const tick = async () => {
      if (stopped || running || !visible()) return
      if (latest.current.isBusy() || reviewing()) { schedule(); return }
      running = true
      try {
        const status = await latest.current.check()
        if (stopped) return
        if (!status || status.error) { failures += 1; return }
        if (!status.isGitRepo || !status.isOverleafRemote) { failures = 4; return }
        failures = 0
        if ((status.behind || 0) === 0 || (status.ahead || 0) > 0 || !status.isClean) return
        if (!visible() || reviewing() || !latest.current.canPull()) return
        // Enter the editing guard synchronously before starting the request.
        latest.current.onApplying(true)
        const result = await pullProjectUpdatesAction(options.project)
        if (stopped) return
        if (!result.ok) throw new Error(result.message)
        await latest.current.onApplied()
      } catch (error) {
        failures += 1
        if (!stopped) latest.current.onError(error instanceof Error ? error.message : "Automatic Git synchronization failed.")
      } finally {
        if (!stopped) latest.current.onApplying(false)
        running = false
        schedule()
      }
    }
    const onVisibility = () => {
      if (visible()) schedule(500)
      else if (timer) clearTimeout(timer)
    }
    schedule()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [options.project])
}
