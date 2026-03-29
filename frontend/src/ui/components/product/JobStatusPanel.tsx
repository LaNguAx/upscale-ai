import { useGetJobStatusQuery } from '@/store/api/upscale.api';
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
  const { data: status, isLoading, error } = useGetJobStatusQuery(jobId, {
    pollingInterval: 3000,
    skipPollingIfUnfocused: true
  });

  if (status?.state === 'completed') {
    setTimeout(onCompleted, 0);
  }
  if (status?.state === 'failed') {
    setTimeout(onFailed, 0);
  }

  if (isLoading) {
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

  if (error || !status) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Unable to fetch job status. The server may be unavailable. Please try again later.
        </AlertDescription>
      </Alert>
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
          <span>Started {formatDistanceToNow(new Date(status.createdAt), { addSuffix: true })}</span>
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
