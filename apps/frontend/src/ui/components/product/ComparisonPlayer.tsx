import { useCallback, useRef, useState } from 'react';
import { Maximize, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import {
  UPLOAD_STREAM_ENDPOINT,
  UPLOAD_STREAM_ORIGINAL_ENDPOINT
} from '@repo/consts/upload';
import type { JobPreview } from '@repo/schemas/jobs';
import { useGetJobResultQuery } from '@/store/api/upscale.api';
import { buildApiUrl } from '@/config/api';
import { usePreviewPlayback } from './use-preview-playback';

interface ComparisonPlayerProps {
  jobId: string;
  phase: 'processing' | 'completed';
  preview: JobPreview | null;
}

function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins)}:${String(secs).padStart(2, '0')}`;
}

const MEDIA_LAYER_CLASS = 'absolute inset-0 size-full object-contain';
const SYNC_DRIFT_SECONDS = 0.2;

/**
 * One player for the whole job lifecycle — no component swap on completion:
 * - processing: buffered "flipbook" playback of the sampled original/enhanced
 *   JPEG pairs (see `usePreviewPlayback`), split by a draggable divider, with
 *   a "Buffering preview…" hold before start and on underrun;
 * - completed: the H.264 enhanced video with custom controls (play/seek/
 *   volume/fullscreen), the original comparison video synced underneath.
 * Degrades to enhanced-only whenever an original layer is unavailable.
 */
export function ComparisonPlayer({ jobId, phase, preview }: ComparisonPlayerProps) {
  const [sliderPercent, setSliderPercent] = useState(50);
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

  const { currentFrame, isBuffering } = usePreviewPlayback({
    jobId,
    phase,
    preview
  });
  const stillOriginalUrl = currentFrame?.originalUrl ?? null;

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
    ? Boolean(stillOriginalUrl)
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

        {showStills && currentFrame && (
          <>
            {stillOriginalUrl && (
              <img
                src={stillOriginalUrl}
                alt="Original frame"
                draggable={false}
                className={MEDIA_LAYER_CLASS}
              />
            )}
            <img
              src={currentFrame.enhancedUrl}
              alt={`Enhanced preview, frame ${String(currentFrame.frameIndex)}`}
              draggable={false}
              className={MEDIA_LAYER_CLASS}
              style={clipStyle}
            />
          </>
        )}

        {showStills && !currentFrame && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Preparing first enhanced preview…
          </div>
        )}

        {phase === 'processing' && currentFrame && isBuffering && (
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-background/80 px-2 py-0.5 text-xs font-medium text-muted-foreground">
            Buffering preview…
          </span>
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

      {phase === 'processing' && currentFrame && (
        <p className="text-xs text-muted-foreground">
          Previewing enhanced frame: {currentFrame.frameIndex}
        </p>
      )}
    </div>
  );
}
