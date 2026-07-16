import { useEffect, useRef, useState } from 'react';
import {
  UPLOAD_PREVIEW_FRAME_ENDPOINT,
  UPLOAD_PREVIEW_ORIGINAL_FRAME_ENDPOINT
} from '@repo/consts/upload';
import type { JobPreview } from '@repo/schemas/jobs';
import { buildApiUrl } from '@/config/api';

/**
 * Seconds of playable runway required before starting/resuming playback.
 * Together with SAFETY_LAG_SECONDS this sets the minimum content length that
 * can play *during* processing (~3 s) — shorter clips simply drain their
 * buffered frames at completion, right before the video handoff.
 */
const BUFFER_TARGET_SECONDS = 2;
/** Never play closer than this to the newest announced frame. */
const SAFETY_LAG_SECONDS = 1;
/** Maximum concurrent frame-pair downloads. */
const PREFETCH_CONCURRENCY = 3;
/** How far ahead of the playhead to prefetch — keeps delivery self-pacing. */
const PREFETCH_AHEAD_SECONDS = 5;
/** Drop decoded frames this far behind the playhead (memory bound). */
const EVICT_BEHIND_SECONDS = 1;
/** Clamp rAF gaps (tab switches) so playback pauses instead of jumping. */
const MAX_TICK_SECONDS = 0.25;

export interface PreviewPlaybackFrame {
  frameIndex: number;
  enhancedUrl: string;
  originalUrl: string | null;
}

interface BufferedSlot {
  frame: PreviewPlaybackFrame;
  /** Kept referenced so the decoded bitmaps stay warm until eviction. */
  images: HTMLImageElement[];
}

/**
 * All playback bookkeeping lives here, outside React state — only the
 * displayed frame and the buffering flag trigger renders. "Slots" index the
 * deterministic sampled-frame sequence (frame 1, then every `stride`th
 * frame), so any slot up to the newest announced frame is fetchable even if
 * its own SSE announcement was missed (e.g. on the 1 Hz polling fallback).
 */
interface PlaybackEngine {
  fps: number;
  stride: number;
  hasOriginal: boolean;
  buffer: Map<number, BufferedSlot>;
  failed: Set<number>;
  inFlight: Set<number>;
  latestSlot: number;
  playbackTime: number;
  playing: boolean;
  displayedSlot: number;
  /** Last good original-frame URL — substituted when one frame's original failed. */
  lastOriginalUrl: string | null;
}

function slotToFrame(slot: number, stride: number): number {
  if (stride === 1) return slot + 1;
  return slot === 0 ? 1 : slot * stride;
}

function frameToSlot(frame: number, stride: number): number {
  if (stride === 1) return frame - 1;
  return frame <= 1 ? 0 : Math.floor(frame / stride);
}

function slotTime(slot: number, engine: PlaybackEngine): number {
  return (slotToFrame(slot, engine.stride) - 1) / engine.fps;
}

/** Loads AND decodes an image so swapping `src` can never flicker. */
function loadFrameImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = src;
  return image.decode().then(() => image);
}

function createEngine(fps: number, stride: number): PlaybackEngine {
  return {
    fps,
    stride,
    hasOriginal: false,
    buffer: new Map(),
    failed: new Set(),
    inFlight: new Set(),
    latestSlot: -1,
    playbackTime: 0,
    playing: false,
    displayedSlot: -1,
    lastOriginalUrl: null
  };
}

/**
 * Time of the last buffered slot reachable from the playhead without a gap.
 * Failed slots count as filled (a single bad frame must not stall playback)
 * but cannot extend the runway themselves.
 */
function contiguousEndTime(engine: PlaybackEngine): number {
  let slot = Math.max(engine.displayedSlot, 0);
  let lastBuffered = -1;
  while (
    slot <= engine.latestSlot &&
    (engine.buffer.has(slot) || engine.failed.has(slot))
  ) {
    if (engine.buffer.has(slot)) lastBuffered = slot;
    slot += 1;
  }
  return lastBuffered >= 0
    ? slotTime(lastBuffered, engine)
    : Number.NEGATIVE_INFINITY;
}

/** Advances the clock, clamping at the buffered/safety-lag ceiling. */
function step(
  engine: PlaybackEngine,
  delta: number,
  phase: 'processing' | 'completed'
): void {
  const announcedCeiling =
    phase === 'processing'
      ? slotTime(engine.latestSlot, engine) - SAFETY_LAG_SECONDS
      : Number.POSITIVE_INFINITY;
  const ceiling = Math.min(contiguousEndTime(engine), announcedCeiling);

  if (engine.playing) {
    engine.playbackTime += delta;
    if (engine.playbackTime >= ceiling) {
      engine.playbackTime = Math.max(ceiling, engine.playbackTime - delta);
      engine.playing = false; // underrun / caught up — hold on the last frame
    }
    return;
  }

  const runway = ceiling - engine.playbackTime;
  // While processing, wait for a full buffer target; once completed there is
  // nothing more to wait for — drain whatever remains buffered.
  if (phase === 'processing' ? runway >= BUFFER_TARGET_SECONDS : runway > 0) {
    engine.playing = true;
  }
}

/** Shows the newest buffered slot at/behind the playhead; evicts old ones. */
function updateDisplay(engine: PlaybackEngine): void {
  let slot = Math.max(engine.displayedSlot, 0);
  let best = engine.displayedSlot;
  while (
    slot <= engine.latestSlot &&
    slotTime(slot, engine) <= engine.playbackTime
  ) {
    if (engine.buffer.has(slot)) best = slot;
    slot += 1;
  }
  engine.displayedSlot = best;

  for (const buffered of engine.buffer.keys()) {
    if (
      buffered < engine.displayedSlot &&
      slotTime(buffered, engine) < engine.playbackTime - EVICT_BEHIND_SECONDS
    ) {
      engine.buffer.delete(buffered);
    }
  }
}

async function fetchSlot(
  engine: PlaybackEngine,
  jobId: string,
  slot: number
): Promise<void> {
  engine.inFlight.add(slot);
  const frameIndex = slotToFrame(slot, engine.stride);
  const frame = String(frameIndex);
  const enhancedUrl = buildApiUrl(UPLOAD_PREVIEW_FRAME_ENDPOINT, {
    jobId,
    frameIndex: frame
  });
  const originalUrl = engine.hasOriginal
    ? buildApiUrl(UPLOAD_PREVIEW_ORIGINAL_FRAME_ENDPOINT, {
        jobId,
        frameIndex: frame
      })
    : null;

  try {
    const [enhanced, original] = await Promise.all([
      loadFrameImage(enhancedUrl),
      // The original half is best-effort — the divider degrades gracefully.
      originalUrl
        ? loadFrameImage(originalUrl).catch(() => null)
        : Promise.resolve<HTMLImageElement | null>(null)
    ]);
    engine.buffer.set(slot, {
      frame: {
        frameIndex,
        enhancedUrl,
        originalUrl: original ? originalUrl : null
      },
      images: original ? [enhanced, original] : [enhanced]
    });
  } catch {
    engine.failed.add(slot); // skippable — playback steps over it
  } finally {
    engine.inFlight.delete(slot);
  }
}

/** Fills the in-flight pool with the next missing slots inside the horizon. */
function pumpPrefetch(
  engine: PlaybackEngine,
  jobId: string,
  phase: 'processing' | 'completed'
): void {
  // After completion the server-side caches are being deleted — stop issuing
  // new fetches and let the already-buffered tail play out.
  if (phase !== 'processing') return;

  const horizon = engine.playbackTime + PREFETCH_AHEAD_SECONDS;
  let slot = Math.max(engine.displayedSlot, 0);
  while (
    engine.inFlight.size < PREFETCH_CONCURRENCY &&
    slot <= engine.latestSlot &&
    slotTime(slot, engine) <= horizon
  ) {
    if (
      !engine.buffer.has(slot) &&
      !engine.failed.has(slot) &&
      !engine.inFlight.has(slot)
    ) {
      void fetchSlot(engine, jobId, slot);
    }
    slot += 1;
  }
}

/**
 * Buffered "flipbook" playback of the sampled preview frames: prefetches
 * decoded frame pairs a few seconds ahead, starts once BUFFER_TARGET_SECONDS
 * of runway exist, advances on a rAF clock at the source pace while staying
 * SAFETY_LAG_SECONDS behind the newest announced frame, and holds (buffering)
 * on underrun. Without `fps`/`stride` metadata (older AI/backend) it falls
 * back to the legacy latest-still behavior.
 */
export function usePreviewPlayback(args: {
  jobId: string;
  phase: 'processing' | 'completed';
  preview: JobPreview | null;
}): { currentFrame: PreviewPlaybackFrame | null; isBuffering: boolean } {
  const { jobId, phase, preview } = args;
  const [currentFrame, setCurrentFrame] = useState<PreviewPlaybackFrame | null>(
    null
  );
  const [isBuffering, setIsBuffering] = useState(true);

  const engineRef = useRef<PlaybackEngine | null>(null);
  const ctxRef = useRef({ jobId, phase });
  ctxRef.current = { jobId, phase };
  const publishedRef = useRef({ slot: -1, buffering: true });

  const flipbook =
    preview !== null &&
    preview.fps !== undefined &&
    preview.stride !== undefined;

  // Feed announcements into the engine (created on the first one).
  useEffect(() => {
    if (!preview || preview.fps === undefined || preview.stride === undefined) {
      return;
    }
    engineRef.current ??= createEngine(preview.fps, preview.stride);
    const engine = engineRef.current;
    engine.latestSlot = Math.max(
      engine.latestSlot,
      frameToSlot(preview.frameIndex, engine.stride)
    );
    if (preview.originalImageUrl !== undefined) engine.hasOriginal = true;
  }, [preview]);

  // Legacy fallback: no pacing metadata — behave like the old latest-still.
  useEffect(() => {
    if (!preview || flipbook) return;
    const frame = String(preview.frameIndex);
    const enhancedUrl = buildApiUrl(UPLOAD_PREVIEW_FRAME_ENDPOINT, {
      jobId,
      frameIndex: frame
    });
    const originalUrl = preview.originalImageUrl
      ? buildApiUrl(UPLOAD_PREVIEW_ORIGINAL_FRAME_ENDPOINT, {
          jobId,
          frameIndex: frame
        })
      : null;

    let stale = false;
    Promise.all([
      loadFrameImage(enhancedUrl),
      originalUrl ? loadFrameImage(originalUrl) : Promise.resolve(null)
    ])
      .then(() => {
        if (stale) return;
        setCurrentFrame({
          frameIndex: preview.frameIndex,
          enhancedUrl,
          originalUrl
        });
        setIsBuffering(false);
      })
      .catch(() => {
        // Keep the previous pair; the next sampled frame self-heals.
      });
    return () => {
      stale = true;
    };
  }, [preview, flipbook, jobId]);

  // The playback clock: one rAF loop for stepping, prefetch, and publish.
  useEffect(() => {
    let rafId = 0;
    let disposed = false;
    let last = performance.now();

    const tick = (now: number): void => {
      if (disposed) return;
      const delta = Math.min((now - last) / 1000, MAX_TICK_SECONDS);
      last = now;

      const engine = engineRef.current;
      if (engine) {
        const { jobId: currentJobId, phase: currentPhase } = ctxRef.current;
        step(engine, delta, currentPhase);
        updateDisplay(engine);
        pumpPrefetch(engine, currentJobId, currentPhase);

        const published = publishedRef.current;
        const buffered =
          engine.displayedSlot >= 0
            ? engine.buffer.get(engine.displayedSlot)
            : undefined;
        if (buffered && published.slot !== engine.displayedSlot) {
          published.slot = engine.displayedSlot;
          const frame = buffered.frame;
          if (frame.originalUrl) {
            engine.lastOriginalUrl = frame.originalUrl;
            setCurrentFrame(frame);
          } else {
            // Keep the last good original layer under the divider instead of
            // flickering to enhanced-only for a single failed original frame.
            setCurrentFrame({ ...frame, originalUrl: engine.lastOriginalUrl });
          }
        }
        if (published.buffering !== !engine.playing) {
          published.buffering = !engine.playing;
          setIsBuffering(!engine.playing);
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
    };
  }, []);

  return { currentFrame, isBuffering };
}
