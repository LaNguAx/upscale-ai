import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/ui/shadcn/lib/utils';

interface BeforeAfterPreviewSliderProps {
  originalSrc: string;
  previewImageUrl: string;
  frameIndex: number;
  progress: number;
}

/**
 * Live before/after comparison shown while a job is processing: the original
 * video (muted, paused, roughly seeked to the enhanced frame's position via
 * the progress fraction) under the latest enhanced preview JPEG, split by a
 * draggable divider. Frame-indexed preview URLs are immutable, so images are
 * preloaded and swapped only once decoded to avoid flicker.
 */
export function BeforeAfterPreviewSlider({
  originalSrc,
  previewImageUrl,
  frameIndex,
  progress
}: BeforeAfterPreviewSliderProps) {
  const [sliderPercent, setSliderPercent] = useState(50);
  const [loadedPreviewUrl, setLoadedPreviewUrl] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const draggingRef = useRef(false);
  const progressRef = useRef(progress);

  useEffect(() => {
    progressRef.current = progress;
  });

  const seekToProgress = useCallback(() => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      return;
    }
    video.currentTime = (progressRef.current / 100) * video.duration;
  }, []);

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      setLoadedPreviewUrl(previewImageUrl);
      seekToProgress();
    };
    image.src = previewImageUrl;
    return () => {
      image.onload = null;
    };
  }, [previewImageUrl, seekToProgress]);

  const updateSliderFromPointer = useCallback((clientX: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const percent = ((clientX - rect.left) / rect.width) * 100;
    setSliderPercent(Math.min(100, Math.max(0, percent)));
  }, []);

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="relative aspect-video w-full cursor-ew-resize touch-none select-none overflow-hidden rounded-lg border border-border bg-muted/30"
        onPointerDown={(e) => {
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
        <video
          ref={videoRef}
          src={originalSrc}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={seekToProgress}
          className="absolute inset-0 size-full object-contain"
        />

        {loadedPreviewUrl && (
          <img
            src={loadedPreviewUrl}
            alt={`Enhanced preview, frame ${String(frameIndex)}`}
            draggable={false}
            className="absolute inset-0 size-full object-contain"
            style={{ clipPath: `inset(0 0 0 ${String(sliderPercent)}%)` }}
          />
        )}

        <div
          className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-primary shadow"
          style={{ left: `${String(sliderPercent)}%` }}
        >
          <div className="absolute top-1/2 left-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-background shadow" />
        </div>

        <span className="absolute top-2 left-2 rounded bg-background/80 px-2 py-0.5 text-xs font-medium text-foreground">
          Original
        </span>
        <span className="absolute top-2 right-2 rounded bg-background/80 px-2 py-0.5 text-xs font-medium text-foreground">
          Enhanced preview
        </span>

        <div
          className={cn(
            'absolute inset-0 flex items-center justify-center bg-muted/60 text-sm text-muted-foreground',
            loadedPreviewUrl && 'hidden'
          )}
        >
          Loading preview…
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Latest enhanced frame: {frameIndex} · {progress}%
      </p>
    </div>
  );
}
