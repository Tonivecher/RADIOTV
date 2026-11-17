"use client"

import React, { useEffect, useRef, useState } from "react"

// ─────────────────────────────────────────────────────────────
// THE CITY OPENS — locked scroll-scrub video hero
// The page cannot move while this is active — body is pinned
// with position:fixed (the same bulletproof technique modal
// libraries use; plain overflow:hidden alone isn't reliable
// across browsers). Wheel/touch input is captured and used
// purely to drive video.currentTime, forward and backward.
// Adapted with optional custom canvas/portal hooks so genre
// transitions reuse one single scroll-lock and scrub engine.
// ─────────────────────────────────────────────────────────────

export interface MetroHeroFrameContext {
  video: HTMLVideoElement
  section: HTMLDivElement
  progress: number
  timeSec: number
  reducedMotion: boolean
}

export interface MetroHeroProps {
  videoSrc?: string
  posterSrc?: string
  eyebrow?: string
  title?: string
  scrollHint?: string
  tagline?: string
  skipLabel?: string
  signature?: { name: string; url: string } | false
  /** Total input distance (px) needed to scrub the full video. Tune to taste. */
  scrubDistance?: number
  maxScale?: number
  taglineRange?: [number, number]
  completionThreshold?: number
  accentColor?: string
  progressGradient?: string
  titleFontFamily?: string
  bodyFontFamily?: string
  exiting?: boolean
  dialogRole?: boolean
  backdropSlot?: React.ReactNode
  onRenderFrame?: (ctx: MetroHeroFrameContext) => void
  onComplete?: () => void
  onSkip?: () => void
  className?: string
  style?: React.CSSProperties
}

const DEFAULT_VIDEO =
  "https://cdn.21st.dev/assets/mirror/21/21a77eac28eacbb7e142016eefeaa0b4a766619e51113629a3bc6df6af066c0f.mp4"
const DEFAULT_SIGNATURE = {
  name: "guglielmogiannattasio.exe",
  url: "https://www.guglielmogiannattasio.it",
}
const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

const COL_BG = "#05070d"
const COL_TEXT = "#dfd3c0"

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

export default function MetroHero({
  videoSrc = DEFAULT_VIDEO,
  posterSrc,
  eyebrow,
  title = "THE CITY OPENS",
  scrollHint = "SCROLL",
  tagline = "Every door in the city is already open.",
  skipLabel,
  signature = DEFAULT_SIGNATURE,
  scrubDistance = 3200,
  maxScale = 0.06,
  taglineRange = [0.82, 1],
  completionThreshold,
  accentColor = "rgba(223,211,192,0.78)",
  progressGradient = "linear-gradient(90deg, rgba(223,211,192,0.45), rgba(223,211,192,0.88))",
  titleFontFamily = SANS,
  bodyFontFamily = SANS,
  exiting = false,
  dialogRole = false,
  backdropSlot,
  onRenderFrame,
  onComplete,
  onSkip,
  className,
  style,
}: MetroHeroProps) {
  const sectionRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const titleRef = useRef<HTMLDivElement>(null)
  const hintRef = useRef<HTMLDivElement>(null)
  const taglineRef = useRef<HTMLDivElement>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)
  const skipButtonRef = useRef<HTMLButtonElement>(null)
  const [ready, setReady] = useState(false)

  const onRenderFrameRef = useRef(onRenderFrame)
  onRenderFrameRef.current = onRenderFrame
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const onSkipRef = useRef(onSkip)
  onSkipRef.current = onSkip
  const exitingRef = useRef(exiting)
  exitingRef.current = exiting
  const releaseLockRef = useRef<() => void>(() => {})

  const taglineStart = taglineRange[0]
  const taglineSpan = Math.max(0.05, taglineRange[1] - taglineRange[0])

  useEffect(() => {
    if (exiting) {
      releaseLockRef.current()
    }
  }, [exiting])

  useEffect(() => {
    const video = videoRef.current
    const section = sectionRef.current
    if (!video || !section) return

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

    let duration = Number.isFinite(video.duration) ? video.duration : 0
    let rafId = 0
    let targetProgress = 0
    let currentProgress = 0
    let hasStartedScrolling = false
    let isSeeking = false
    let pendingTime: number | null = null
    let locked = false
    let lockedScrollY = 0
    let touchStartY = 0
    let completed = false

    const engageLock = () => {
      if (locked || reduceMotion || exitingRef.current || typeof document === "undefined") return
      locked = true
      lockedScrollY = window.scrollY
      const b = document.body.style
      b.position = "fixed"
      b.top = `-${lockedScrollY}px`
      b.left = "0"
      b.right = "0"
      b.width = "100%"
      b.height = "100%"
      b.overscrollBehavior = "none"
    }

    const releaseLock = () => {
      if (!locked || typeof document === "undefined") return
      locked = false
      const y = lockedScrollY
      const b = document.body.style
      b.position = ""
      b.top = ""
      b.left = ""
      b.right = ""
      b.width = ""
      b.height = ""
      b.overscrollBehavior = ""
      const html = document.documentElement
      const prevScrollBehavior = html.style.scrollBehavior
      html.style.scrollBehavior = "auto"
      window.scrollTo(0, y)
      html.style.scrollBehavior = prevScrollBehavior
    }
    releaseLockRef.current = releaseLock

    engageLock()

    if (skipLabel && onSkipRef.current) {
      requestAnimationFrame(() => skipButtonRef.current?.focus({ preventScroll: true }))
    }

    const seekTo = (t: number) => {
      if (isSeeking) {
        pendingTime = t
        return
      }
      isSeeking = true
      try {
        video.currentTime = t
      } catch {
        isSeeking = false
      }
    }

    const onLoadedData = () => {
      duration = Number.isFinite(video.duration) ? video.duration : 0
      setReady(true)
      if (reduceMotion && duration > 0) {
        seekTo(duration * 0.92)
      }
      if (onRenderFrameRef.current) {
        onRenderFrameRef.current({
          video,
          section,
          progress: reduceMotion ? 1 : currentProgress,
          timeSec: performance.now() * 0.001,
          reducedMotion: Boolean(reduceMotion),
        })
      }
    }

    const onSeeked = () => {
      isSeeking = false
      if (pendingTime !== null) {
        const t = pendingTime
        pendingTime = null
        isSeeking = true
        try {
          video.currentTime = t
        } catch {
          isSeeking = false
        }
      }
    }

    video.addEventListener("loadeddata", onLoadedData)
    video.addEventListener("seeked", onSeeked)
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      onLoadedData()
    }

    // Silent play-then-pause kickstart so iOS Safari buffers frames before scrubbing.
    const kickstartLoad = () => {
      const p = video.play()
      if (p && typeof p.then === "function") {
        p.then(() => video.pause()).catch(() => {})
      } else {
        video.pause()
      }
    }
    kickstartLoad()

    const addDelta = (deltaY: number) => {
      if (completed || exitingRef.current) return false
      const next = clamp(targetProgress + deltaY / scrubDistance, 0, 1)
      targetProgress = next
      if (targetProgress > 0.001) hasStartedScrolling = true
      return true
    }

    const onWheel = (e: WheelEvent) => {
      if (exitingRef.current) return
      addDelta(e.deltaY)
      e.preventDefault()
    }

    const onTouchStart = (e: TouchEvent) => {
      if (exitingRef.current) return
      touchStartY = e.touches[0]?.clientY ?? 0
    }
    const onTouchMove = (e: TouchEvent) => {
      if (exitingRef.current) return
      const y = e.touches[0]?.clientY ?? touchStartY
      const deltaY = touchStartY - y
      touchStartY = y
      addDelta(deltaY)
      e.preventDefault()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (exitingRef.current) return
      if (e.key === "Escape" && (onSkipRef.current || onCompleteRef.current)) {
        e.preventDefault()
        releaseLock()
        ;(onSkipRef.current || onCompleteRef.current)?.()
      } else if (reduceMotion) {
        if (
          (e.key === "ArrowDown" || e.key === "PageDown") &&
          (onSkipRef.current || onCompleteRef.current)
        ) {
          e.preventDefault()
          ;(onSkipRef.current || onCompleteRef.current)?.()
        }
      } else if (e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault()
        addDelta(240)
      } else if (e.key === " ") {
        const target = e.target
        if (
          target instanceof HTMLElement &&
          target.closest("button, a, input, [role='button']")
        ) {
          return
        }
        e.preventDefault()
        addDelta(240)
      } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault()
        addDelta(-240)
      }
    }

    if (!reduceMotion) {
      window.addEventListener("wheel", onWheel, { passive: false })
      window.addEventListener("touchstart", onTouchStart, { passive: true })
      window.addEventListener("touchmove", onTouchMove, { passive: false })
      section.addEventListener("touchstart", onTouchStart, { passive: true, capture: true })
      section.addEventListener("touchmove", onTouchMove, { passive: false, capture: true })
    }
    window.addEventListener("keydown", onKeyDown)

    const frame = (nowMs: number) => {
      if (exitingRef.current) return
      currentProgress += (targetProgress - currentProgress) * 0.18

      if (duration > 0) {
        const safeTime = currentProgress * Math.max(0, duration - 0.06)
        if (Math.abs(video.currentTime - safeTime) > 0.025) {
          seekTo(safeTime)
        }
      }

      if (onRenderFrameRef.current) {
        onRenderFrameRef.current({
          video,
          section,
          progress: currentProgress,
          timeSec: nowMs * 0.001,
          reducedMotion: Boolean(reduceMotion),
        })
      } else if (videoRef.current) {
        const scale = 1 + currentProgress * maxScale
        videoRef.current.style.transform = `scale(${scale})`
      }

      if (titleRef.current) {
        const t = 1 - clamp(currentProgress / 0.35, 0, 1)
        titleRef.current.style.opacity = String(t)
        titleRef.current.style.transform = `translateY(${(1 - t) * -24}px) scale(${0.96 + t * 0.04})`
        titleRef.current.style.filter = `blur(${(1 - t) * 10}px)`
      }
      if (hintRef.current) {
        hintRef.current.style.opacity = hasStartedScrolling ? "0" : "1"
      }
      if (taglineRef.current) {
        const t = clamp((currentProgress - taglineStart) / taglineSpan, 0, 1)
        taglineRef.current.style.opacity = String(t)
        taglineRef.current.style.transform = `translateY(${(1 - t) * 20}px) scale(${0.97 + t * 0.03})`
        taglineRef.current.style.filter = `blur(${(1 - t) * 8}px)`
      }
      if (progressBarRef.current) {
        progressBarRef.current.style.transform = `scaleX(${currentProgress})`
      }

      if (
        !completed &&
        completionThreshold !== undefined &&
        onCompleteRef.current &&
        targetProgress >= completionThreshold &&
        currentProgress >= completionThreshold - 0.015
      ) {
        completed = true
        releaseLock()
        onCompleteRef.current()
        return
      }

      rafId = requestAnimationFrame(frame)
    }

    if (reduceMotion) {
      if (onRenderFrameRef.current) {
        onRenderFrameRef.current({
          video,
          section,
          progress: 1,
          timeSec: performance.now() * 0.001,
          reducedMotion: true,
        })
      }
    } else {
      rafId = requestAnimationFrame(frame)
    }

    return () => {
      video.removeEventListener("loadeddata", onLoadedData)
      video.removeEventListener("seeked", onSeeked)
      window.removeEventListener("wheel", onWheel)
      window.removeEventListener("touchstart", onTouchStart)
      window.removeEventListener("touchmove", onTouchMove)
      section.removeEventListener("touchstart", onTouchStart, true)
      section.removeEventListener("touchmove", onTouchMove, true)
      window.removeEventListener("keydown", onKeyDown)
      cancelAnimationFrame(rafId)
      releaseLockRef.current = () => {}
      releaseLock()
    }
  }, [scrubDistance, videoSrc, maxScale, taglineStart, taglineSpan, completionThreshold, skipLabel])

  const usesCustomBackdrop = Boolean(backdropSlot || onRenderFrame)

  return (
    <div
      ref={sectionRef}
      className={`${className || ""}${exiting ? " is-exiting" : ""}`.trim()}
      role={dialogRole ? "dialog" : undefined}
      aria-modal={dialogRole ? true : undefined}
      aria-labelledby={dialogRole ? "metro-hero-title" : undefined}
      aria-describedby={dialogRole && tagline ? "metro-hero-tagline" : undefined}
      style={{
        position: "relative",
        height: "100dvh",
        width: "100%",
        overflow: "hidden",
        background: COL_BG,
        touchAction: "none",
        ...style,
      }}
    >
      <video
        ref={videoRef}
        src={videoSrc}
        poster={posterSrc}
        muted
        playsInline
        preload="auto"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: usesCustomBackdrop ? 0 : ready ? 1 : 0,
          transformOrigin: "center center",
          willChange: "transform",
          transition: "opacity 0.6s ease",
          touchAction: "none",
          pointerEvents: "none",
        }}
      />

      {backdropSlot}

      <div
        className="metro-hero__vignette"
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(5,7,13,0.12), rgba(5,7,13,0) 32%, rgba(5,7,13,0.06) 72%, rgba(5,7,13,0.22))",
          pointerEvents: "none",
        }}
      />

      <div
        ref={titleRef}
        className="metro-hero__center"
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 6%",
          textAlign: "center",
          pointerEvents: "none",
        }}
      >
        {eyebrow && (
          <span
            className="metro-hero__eyebrow"
            style={{
              fontFamily: bodyFontFamily,
              color: accentColor,
            }}
          >
            {eyebrow}
          </span>
        )}
        <h2
          id="metro-hero-title"
          className="metro-hero__title"
          style={{
            margin: 0,
            fontFamily: titleFontFamily,
            fontWeight: 800,
            fontSize: "clamp(34px, 8vw, 112px)",
            lineHeight: 0.98,
            letterSpacing: "-0.025em",
            color: "var(--portal-text, #dfd3c0)",
            textShadow: "0 2px 18px rgba(0,0,0,0.85), 0 1px 3px rgba(0,0,0,0.92)",
            display: "inline-block",
            willChange: "transform, filter, opacity",
          }}
        >
          {title}
        </h2>
      </div>

      {tagline && (
        <div
          ref={taglineRef}
          id="metro-hero-tagline"
          className="metro-hero__tagline"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 8%",
            textAlign: "center",
            opacity: 0,
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              fontFamily: titleFontFamily,
              fontWeight: 700,
              fontSize: "clamp(20px, 3.4vw, 40px)",
              lineHeight: 1.2,
              letterSpacing: "-0.01em",
              color: "var(--portal-text, #dfd3c0)",
              textShadow: "0 2px 18px rgba(0,0,0,0.85), 0 1px 3px rgba(0,0,0,0.92)",
            }}
          >
            {tagline}
          </span>
        </div>
      )}

      {scrollHint && (
        <div
          ref={hintRef}
          className="metro-hero__hint"
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "50%",
            bottom: skipLabel ? "clamp(72px, 11vh, 104px)" : "clamp(20px, 6vh, 48px)",
            transform: "translateX(-50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            color: accentColor,
            fontFamily: bodyFontFamily,
            fontSize: "clamp(10px, 1.4vw, 12px)",
            fontWeight: 600,
            letterSpacing: "0.3em",
            transition: "opacity 0.4s ease",
            pointerEvents: "none",
          }}
        >
          <span>{scrollHint}</span>
          <svg
            width="14"
            height="18"
            viewBox="0 0 14 18"
            style={{ animation: "metro-hero-bounce 1.6s ease-in-out infinite" }}
          >
            <style>{`
              @keyframes metro-hero-bounce {
                0%, 100% { transform: translateY(0); opacity: 0.5; }
                50% { transform: translateY(5px); opacity: 1; }
              }
            `}</style>
            <path
              d="M7 1 L7 17 M2 12 L7 17 L12 12"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}

      {skipLabel && onSkip && (
        <button
          ref={skipButtonRef}
          type="button"
          className="channel-portal__skip"
          onClick={() => {
            releaseLockRef.current()
            onSkip()
          }}
        >
          <span>{skipLabel}</span>
          <span aria-hidden="true">↗</span>
        </button>
      )}

      {/* Thin progress line — fills as the video and ASCII morph advance. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 3,
          background: "rgba(223,211,192,0.14)",
          zIndex: 4,
        }}
      >
        <div
          ref={progressBarRef}
          style={{
            height: "100%",
            width: "100%",
            background: progressGradient,
            transform: "scaleX(0)",
            transformOrigin: "left center",
          }}
        />
      </div>

      {signature && (
        <span
          style={{
            position: "absolute",
            right: "clamp(12px, 2.5vw, 24px)",
            bottom: "clamp(10px, 2vw, 18px)",
            fontFamily: SANS,
            fontWeight: 500,
            fontSize: "clamp(11px, 1.4vw, 13px)",
            letterSpacing: "0.01em",
            color: "rgba(223,211,192,0.62)",
            zIndex: 2,
          }}
        >
          by{" "}
          <a
            href={signature.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "rgba(223,211,192,0.62)",
              textDecoration: "none",
              transition: "color 0.2s ease",
            }}
            onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
              e.currentTarget.style.color = COL_TEXT
            }}
            onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
              e.currentTarget.style.color = "rgba(223,211,192,0.62)"
            }}
          >
            {signature.name}
          </a>
        </span>
      )}
    </div>
  )
}
