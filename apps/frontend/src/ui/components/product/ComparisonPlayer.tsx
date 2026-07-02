import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import {
  UPLOAD_PREVIEW_FRAME_ENDPOINT,
  UPLOAD_PREVIEW_ORIGINAL_FRAME_ENDPOINT,
  UPLOAD_STREAM_ENDPOINT,
  UPLOAD_STREAM_ORIGINAL_ENDPOINT
} from '@repo/consts/upload';
import type { JobPreview } from '@repo/schemas/jobs';
import { useGetJobResultQuery } from '@/store/api/upscale.api';
import { buildApiUrl } from '@/config/api';

interface ComparisonPlayerProps {
  jobId: string;
  phase: 'processing' | 'completed';
  preview: JobPreview | null;
}

interface DisplayedPair {
  frameIndex: number;
  enhancedUrl: string;
  originalUrl: string | null;
}

function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins)}:${String(secs).padStart(2, '0')}`;
}

function loadImage(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve();
    };
    image.onerror = () => {
      reject(new Error(`Failed to load ${src}`));
    };
    image.src = src;
  });
}

const MEDIA_LAYER_CLASS = 'absolute inset-0 size-full object-contain';
const SYNC_DRIFT_SECONDS = 0.2;

/**
 * One player for the whole job lifecycle — no component swap on completion:
 * - processing: pixel-aligned original/enhanced JPEG pair (same frame index)
 *   split by a draggable divider, preloaded before swapping to avoid flicker;
 * - completed: the H.264 enhanced video with custom controls (play/seek/
 *   volume/fullscreen), the original comparison video synced underneath.
 * Degrades to enhanced-only whenever an original layer is unavailable.
 */
export function ComparisonPlayer({ jobId, phase, preview }: ComparisonPlayerProps) {
  const [sliderPercent, setSliderPercent] = useState(50);
  const [displayedPair, setDisplayedPair] = useState<DisplayedPair | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const enhancedRef = useRef<HTMLVideoElement>(null);
  const originalRef = useRef<HTMLVideoElement>(null);
  const draggingRef = useRef(false);

  const { data: result } = useGetJobResultQuery(jobId, {
    skip: phase !== 'completed'
  });
  const enhancedVideoUrl =
    phase === 'completed' ? buildApiUrl(UPLOAD_STREAM_ENDPOINT, { jobId }) : null;
  const originalVideoUrl =
    phase === 'completed' && result?.originalStreamUrl
      ? buildApiUrl(UPLOAD_STREAM_ORIGINAL_ENDPOINT, { jobId })
      : null;

  // Preload each sampled frame pair and swap only once both images decoded.
  useEffect(() => {
    if (!preview) return;
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
    const loads = [loadImage(enhancedUrl)];
    if (originalUrl) loads.push(loadImage(originalUrl));
    Promise.all(loads)
      .then(() => {
        if (!stale) {
          setDisplayedPair({
            frameIndex: preview.frameIndex,
            enhancedUrl,
            originalUrl
          });
        }
      })
      .catch(() => {
        // Keep the previous pair; the next sampled frame self-heals.
      });
    return () => {
      stale = true;
    };
  }, [preview, jobId]);

  const syncOriginal = useCallback(() => {
    const enhanced = enhancedRef.current;
    const original = originalRef.current;
    if (!enhanced || !original) return;
    if (Math.abs(original.currentTime - enhanced.currentTime) > SYNC_DRIFT_SECONDS) {
      original.currentTime = enhanced.currentTime;
    }
  }, []);

  const togglePlay = useCallback(() => {
    const enhanced = enhancedRef.current;
    if (!enhanced) return;
    if (enhanced.paused) {
      void enhanced.play().catch(() => undefined);
    } else {
      enhanced.pause();
    }
  }, []);

  const updateSliderFromPointer = useCallback((clientX: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const percent = ((clientX - rect.left) / rect.width) * 100;
    setSliderPercent(Math.min(100, Math.max(0, percent)));
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void container.requestFullscreen().catch(() => undefined);
    }
  }, []);

  const showStills = phase === 'processing' || !videoReady;
  const hasComparison = showStills
    ? Boolean(displayedPair?.originalUrl)
    : Boolean(originalVideoUrl);
  const clipStyle = hasComparison
    ? { clipPath: `inset(0 0 0 ${String(sliderPercent)}%)` }
    : undefined;

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="relative aspect-video w-full touch-none select-none overflow-hidden rounded-lg border border-border bg-black"
        onPointerDown={(e) => {
          if (!hasComparison) return;
          draggingRef.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          updateSliderFromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) updateSliderFromPointer(e.clientX);
        }}
        onPointerUp={(e) => {
          draggingRef.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
      >
        {enhancedVideoUrl && (
          <>
            {originalVideoUrl && (
              <video
                ref={originalRef}
                src={originalVideoUrl}
                muted
                playsInline
                preload="auto"
                className={MEDIA_LAYER_CLASS}
              />
            )}
            <video
              ref={enhancedRef}
              src={enhancedVideoUrl}
              playsInline
              preload="auto"
              className={MEDIA_LAYER_CLASS}
              style={videoReady ? clipStyle : undefined}
              onLoadedMetadata={(e) => {
                setDuration(e.currentTarget.duration);
              }}
              onLoadedData={() => {
                setVideoReady(true);
              }}
              onTimeUpdate={(e) => {
                setCurrentTime(e.currentTarget.currentTime);
                syncOriginal();
              }}
              onSeeked={syncOriginal}
              onPlay={() => {
                setPlaying(true);
                void originalRef.current?.play().catch(() => undefined);
              }}
              onPause={() => {
                setPlaying(false);
                originalRef.current?.pause();
              }}
              onEnded={() => {
                setPlaying(false);
                originalRef.current?.pause();
              }}
            />
          </>
        )}

        {showStills && displayedPair && (
          <>
            {displayedPair.originalUrl && (
              <img
                src={displayedPair.originalUrl}
                alt="Original frame"
                draggable={false}
                className={MEDIA_LAYER_CLASS}
              />
            )}
            <img
              src={displayedPair.enhancedUrl}
              alt={`Enhanced preview, frame ${String(displayedPair.frameIndex)}`}
              draggable={false}
              className={MEDIA_LAYER_CLASS}
              style={clipStyle}
            />
          </>
        )}

        {showStills && !displayedPair && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Preparing first enhanced preview…
          </div>
        )}

        {hasComparison && (
          <>
            <div
              className="absolute inset-y-0 w-0.5 -translate-x-1/2 cursor-ew-resize bg-primary shadow"
              style={{ left: `${String(sliderPercent)}%` }}
            >
              <div className="absolute top-1/2 left-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-background shadow" />
            </div>
            <span className="absolute top-2 left-2 rounded bg-background/80 px-2 py-0.5 text-xs font-medium text-foreground">
              Original
            </span>
            <span className="absolute top-2 right-2 rounded bg-background/80 px-2 py-0.5 text-xs font-medium text-foreground">
              Enhanced
            </span>
          </>
        )}

        {phase === 'completed' && (
          <div
            className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/80 to-transparent px-3 pt-6 pb-2"
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
          >
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.05}
              value={currentTime}
              aria-label="Seek"
              className="h-1 w-full cursor-pointer accent-primary"
              onChange={(e) => {
                const enhanced = enhancedRef.current;
                if (!enhanced) return;
                enhanced.currentTime = Number(e.target.value);
                syncOriginal();
              }}
            />
            <div className="flex items-center gap-3 text-white">
              <button
                type="button"
                aria-label={playing ? 'Pause' : 'Play'}
                className="rounded p-1 hover:bg-white/20"
                onClick={togglePlay}
              >
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              </button>
              <span className="text-xs tabular-nums">
                {formatTimecode(currentTime)} / {formatTimecode(duration)}
              </span>
              <div className="flex-1" />
              <button
                type="button"
                aria-label={muted ? 'Unmute' : 'Mute'}
                className="rounded p-1 hover:bg-white/20"
                onClick={() => {
                  const enhanced = enhancedRef.current;
                  if (!enhanced) return;
                  enhanced.muted = !muted;
                  setMuted(!muted);
                }}
              >
                {muted ? (
                  <VolumeX className="size-4" />
                ) : (
                  <Volume2 className="size-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                aria-label="Volume"
                className="h-1 w-20 cursor-pointer accent-primary"
                onChange={(e) => {
                  const nextVolume = Number(e.target.value);
                  const enhanced = enhancedRef.current;
                  if (!enhanced) return;
                  enhanced.volume = nextVolume;
                  enhanced.muted = nextVolume === 0;
                  setVolume(nextVolume);
                  setMuted(nextVolume === 0);
                }}
              />
              <button
                type="button"
                aria-label="Toggle fullscreen"
                className="rounded p-1 hover:bg-white/20"
                onClick={toggleFullscreen}
              >
                <Maximize className="size-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {phase === 'processing' && displayedPair && (
        <p className="text-xs text-muted-foreground">
          Latest enhanced frame: {displayedPair.frameIndex}
        </p>
      )}
    </div>
  );
}
