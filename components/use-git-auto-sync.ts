"use client"

import { useEffect, useRef } from "react"
import { pullBrowserProject, type PendingBrowserPull } from "@/lib/research/browser-git-sync"
import type { OverleafGitStatus } from "@/lib/tex-project/overleaf-git"

type Options = {
  project: string
  isBusy: () => boolean
  canPull: () => boolean
  canPush?: () => boolean
  push?: () => Promise<{ ok: boolean }>
  check: () => Promise<OverleafGitStatus | undefined>
  onApplying: (applying: boolean) => void
  onApplied: (pending: PendingBrowserPull) => Promise<void>
  onPullUncertain: (pending: PendingBrowserPull) => void
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
    let checkFailures = 0
    let lastTickAt = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const visible = () => document.visibilityState === "visible"
    const reviewing = () => Boolean(document.querySelector("[data-ob-modal]"))
    const schedule = (delay = Math.min(120_000, 30_000 * 2 ** failures)) => {
      if (timer) clearTimeout(timer)
      if (!stopped && visible()) timer = setTimeout(() => void tick(), delay)
    }
    const tick = async () => {
      if (stopped || running || !visible()) return
      if (latest.current.isBusy() || reviewing()) { schedule(); return }
      running = true
      lastTickAt = Date.now()
      let applying = false
      let checked = false
      try {
        const status = await latest.current.check()
        if (stopped) return
        if (!status) return
        if (status.error) { failures += 1; checkFailures += 1; if (checkFailures >= 3) latest.current.onError(status.error); return }
        if (!status.isGitRepo || !status.isOverleafRemote) { failures = 4; checkFailures = 0; return }
        if (!Number.isSafeInteger(status.ahead) || !Number.isSafeInteger(status.behind)
          || status.ahead! < 0 || status.behind! < 0 || typeof status.isClean !== "boolean") {
          failures += 1
          checkFailures += 1
          if (checkFailures >= 3) latest.current.onError("Git synchronization status could not be verified. Check the remote connection and try again.")
          return
        }
        checked = true
        checkFailures = 0
        if (status.behind === 0 && (status.ahead! > 0 || status.isClean === false)) {
          if (!visible() || reviewing() || !latest.current.canPush?.() || !latest.current.push) return
          const result = await latest.current.push()
          failures = result.ok ? 0 : failures + 1
          return
        }
        if (status.behind === 0 && status.ahead === 0 && status.isClean) failures = 0
        if ((status.behind || 0) === 0 || (status.ahead || 0) > 0 || !status.isClean) return
        if (!visible() || reviewing() || !latest.current.canPull()) return
        // Enter the editing guard synchronously before starting the request.
        applying = true
        latest.current.onApplying(true)
        const result = await pullBrowserProject(options.project, pending => { if (!stopped) latest.current.onPullUncertain(pending) })
        if (stopped) return
        if (!result.ok) throw new Error(result.message)
        await latest.current.onApplied(result)
        failures = 0
      } catch (error) {
        failures += 1
        if (!checked) checkFailures += 1
        if (!stopped && (applying || checked || checkFailures >= 3)) latest.current.onError(error instanceof Error ? error.message : "Automatic Git synchronization failed.")
      } finally {
        if (!stopped && applying) latest.current.onApplying(false)
        running = false
        schedule()
      }
    }
    const onVisibility = () => {
      if (!visible()) {
        if (timer) clearTimeout(timer)
        return
      }
      if (failures > 0) {
        if (!timer) schedule()
        return
      }
      if (Date.now() - lastTickAt >= 15_000) schedule(500)
    }
    schedule()
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("focus", onVisibility)
    window.addEventListener("online", onVisibility)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("focus", onVisibility)
      window.removeEventListener("online", onVisibility)
    }
  }, [options.project])
}
