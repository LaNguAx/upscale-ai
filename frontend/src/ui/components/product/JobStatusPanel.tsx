import { useState, useEffect, useRef } from 'react';
import { Badge } from '@/ui/shadcn/ui/badge';
import { Progress } from '@/ui/shadcn/ui/progress';
import { Alert, AlertDescription } from '@/ui/shadcn/ui/alert';
import { Skeleton } from '@/ui/shadcn/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/ui/card';
import { cn } from '@/ui/shadcn/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import type { JobState } from '@/types/job.types';

interface JobStatusPanelProps {
  jobId: string;
  onCompleted: () => void;
  onFailed: () => void;
}

interface SSEUpdate {
  jobId: string;
  state: JobState;
  progress: number;
  updatedAt: string;
  error?: string;
}

const STATUS_CONFIG: Record<
  JobState,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof Clock }
> = {
  queued: { label: 'Queued', variant: 'outline', icon: Clock },
  processing: { label: 'Processing', variant: 'secondary', icon: Loader2 },
  completed: { label: 'Completed', variant: 'default', icon: CheckCircle2 },
  failed: { label: 'Failed', variant: 'destructive', icon: XCircle }
};

export function JobStatusPanel({ jobId, onCompleted, onFailed }: JobStatusPanelProps) {
  const [status, setStatus] = useState<SSEUpdate | null>(null);
  const [error, setError] = useState(false);
  const onCompletedRef = useRef(onCompleted);
  const onFailedRef = useRef(onFailed);

  onCompletedRef.current = onCompleted;
  onFailedRef.current = onFailed;

  useEffect(() => {
    const url = `${import.meta.env.VITE_API_BASE_URL}/upload/events/${jobId}`;
    const es = new EventSource(url);

    es.onmessage = (event) => {
      const data = JSON.parse(event.data as string) as SSEUpdate;
      setStatus(data);

      if (data.state === 'completed') {
        es.close();
        onCompletedRef.current();
      } else if (data.state === 'failed') {
        es.close();
        onFailedRef.current();
      }
    };

    es.onerror = () => {
      es.close();
      setError(true);
    };

    return () => es.close();
  }, [jobId]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Lost connection to the server. Please try again.
        </AlertDescription>
      </Alert>
    );
  }

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
              className={cn('mr-1 size-3', status.state === 'processing' && 'animate-spin')}
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

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Job ID: {jobId.slice(0, 8)}...</span>
          <span>Started {formatDistanceToNow(new Date(status.updatedAt), { addSuffix: true })}</span>
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
