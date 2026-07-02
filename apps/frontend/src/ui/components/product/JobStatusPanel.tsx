import { useState, useEffect, useRef } from 'react';
import { Badge } from '@/ui/shadcn/ui/badge';
import { Progress } from '@/ui/shadcn/ui/progress';
import { Alert, AlertDescription } from '@/ui/shadcn/ui/alert';
import { Skeleton } from '@/ui/shadcn/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/ui/card';
import { Button } from '@/ui/shadcn/ui/button';
import { cn } from '@/ui/shadcn/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  CircleStop
} from 'lucide-react';
import {
  UPLOAD_EVENTS_ENDPOINT,
  UPLOAD_PREVIEW_FRAME_ENDPOINT,
  UPLOAD_STREAM_ENDPOINT
} from '@repo/consts/upload';
import { getJobStatusContract } from '@repo/contracts/upload';
import { jobUpdateSchema } from '@repo/schemas/jobs';
import type { JobPreview, JobState, JobUpdate } from '@repo/schemas/jobs';
import { buildApiUrl } from '@/config/api';
import { BeforeAfterPreviewSlider } from '@/ui/components/product/BeforeAfterPreviewSlider';

interface JobStatusPanelProps {
  jobId: string;
  originalSrc: string | null;
  onCompleted: () => void;
  onCancelled: (reason?: string) => void;
  onFailed: (reason?: string) => void;
  onStop: () => void;
  isStopping: boolean;
}

const STATUS_CONFIG: Record<
  JobState,
  {
    label: string;
    variant: 'default' | 'secondary' | 'destructive' | 'outline';
    icon: typeof Clock;
  }
> = {
  queued: { label: 'Queued', variant: 'outline', icon: Clock },
  processing: { label: 'Processing', variant: 'secondary', icon: Loader2 },
  completed: { label: 'Completed', variant: 'default', icon: CheckCircle2 },
  failed: { label: 'Failed', variant: 'destructive', icon: XCircle },
  cancelled: { label: 'Cancelled', variant: 'outline', icon: CircleStop }
};

export function JobStatusPanel({
  jobId,
  originalSrc,
  onCompleted,
  onCancelled,
  onFailed,
  onStop,
  isStopping
}: JobStatusPanelProps) {
  const [status, setStatus] = useState<JobUpdate | null>(null);
  const [preview, setPreview] = useState<JobPreview | null>(null);
  const onCompletedRef = useRef(onCompleted);
  const onCancelledRef = useRef(onCancelled);
  const onFailedRef = useRef(onFailed);
  const isStoppingRef = useRef(isStopping);
  const pollIdRef = useRef<number | null>(null);
  const pollingAttemptsRef = useRef(0);

  useEffect(() => {
    onCompletedRef.current = onCompleted;
    onCancelledRef.current = onCancelled;
    onFailedRef.current = onFailed;
    isStoppingRef.current = isStopping;
  });

  useEffect(() => {
    const url = buildApiUrl(UPLOAD_EVENTS_ENDPOINT, { jobId });
    const es = new EventSource(url);
    let isDisposed = false;

    const stopPolling = () => {
      if (pollIdRef.current !== null) {
        window.clearInterval(pollIdRef.current);
        pollIdRef.current = null;
      }
      pollingAttemptsRef.current = 0;
    };

    const handleTerminalState = (data: JobUpdate) => {
      if (data.state === 'completed') {
        onCompletedRef.current();
      } else if (data.state === 'cancelled') {
        onCancelledRef.current(data.error);
      } else if (data.state === 'failed') {
        onFailedRef.current(data.error);
      }
    };

    const startStatusPolling = () => {
      if (pollIdRef.current !== null) {
        return;
      }

      const handlePollingTimeout = () => {
        stopPolling();
        if (isStoppingRef.current) {
          onFailedRef.current(
            'Stop request was sent, but cancellation status could not be confirmed. Please refresh or try again.'
          );
          return;
        }
        onFailedRef.current(
          'Lost connection to live updates and could not recover job status.'
        );
      };

      pollIdRef.current = window.setInterval(async () => {
        if (isDisposed) {
          stopPolling();
          return;
        }

        try {
          const response = await fetch(
            buildApiUrl(getJobStatusContract.path, { jobId }),
            { credentials: 'include' }
          );
          if (!response.ok) {
            return;
          }

          const data = getJobStatusContract.responseSchema.parse(
            await response.json()
          );
          setStatus(data);
          if (data.preview) setPreview(data.preview);

          if (
            data.state === 'completed' ||
            data.state === 'cancelled' ||
            data.state === 'failed'
          ) {
            stopPolling();
            handleTerminalState(data);
            return;
          }

          pollingAttemptsRef.current += 1;
          if (pollingAttemptsRef.current >= 30) {
            handlePollingTimeout();
          }
        } catch {
          pollingAttemptsRef.current += 1;
          if (pollingAttemptsRef.current >= 30) {
            handlePollingTimeout();
          }
        }
      }, 1000);
    };

    es.onmessage = (event) => {
      let data: JobUpdate;
      try {
        data = jobUpdateSchema.parse(JSON.parse(event.data as string));
      } catch {
        es.close();
        startStatusPolling();
        return;
      }

      setStatus(data);
      if (data.preview) setPreview(data.preview);

      if (
        data.state === 'completed' ||
        data.state === 'cancelled' ||
        data.state === 'failed'
      ) {
        es.close();
        stopPolling();
        handleTerminalState(data);
      }
    };

    es.onerror = () => {
      es.close();
      startStatusPolling();
      if (isStoppingRef.current) {
        return;
      }
    };

    return () => {
      isDisposed = true;
      es.close();
      stopPolling();
    };
  }, [jobId]);

  if (!status) {
    return (
      <Card>
        <CardContent className="space-y-4 p-6">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-4 w-48" />
        </CardContent>
      </Card>
    );
  }

  const config = STATUS_CONFIG[status.state];
  const StatusIcon = config.icon;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Processing Video</CardTitle>
          <Badge variant={config.variant}>
            <StatusIcon
              className={cn(
                'mr-1 size-3',
                status.state === 'processing' && 'animate-spin'
              )}
            />
            {config.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Progress</span>
            <span className="font-medium">{status.progress}%</span>
          </div>
          <Progress value={status.progress} />
        </div>

        {status.state === 'processing' &&
          (preview ? (
            <BeforeAfterPreviewSlider
              originalSrc={
                originalSrc ?? buildApiUrl(UPLOAD_STREAM_ENDPOINT, { jobId })
              }
              previewImageUrl={buildApiUrl(UPLOAD_PREVIEW_FRAME_ENDPOINT, {
                jobId,
                frameIndex: String(preview.frameIndex)
              })}
              frameIndex={preview.frameIndex}
              progress={status.progress}
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-sm text-muted-foreground">
              Preparing first enhanced preview…
            </div>
          ))}

        <Button
          variant="destructive"
          className="w-full"
          onClick={onStop}
          disabled={isStopping || status.state !== 'processing'}
        >
          <CircleStop className="size-4" data-icon="inline-start" />
          {isStopping ? 'Stopping Upscaling...' : 'Stop Upscaling'}
        </Button>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Job ID: {jobId.slice(0, 8)}...</span>
          <span>
            Started{' '}
            {formatDistanceToNow(new Date(status.updatedAt), {
              addSuffix: true
            })}
          </span>
        </div>

        {status.state === 'failed' && status.error && (
          <Alert variant="destructive">
            <AlertDescription>{status.error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
