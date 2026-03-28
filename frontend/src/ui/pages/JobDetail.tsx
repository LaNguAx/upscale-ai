import { useParams, Link } from 'react-router';
import { ArrowLeft, Download, AlertCircle, Film } from 'lucide-react';
import { Button } from '@/ui/shadcn/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/ui/card';
import { Separator } from '@/ui/shadcn/ui/separator';
import { StatusBadge } from '@/ui/components/StatusBadge';
import { ProgressSection } from '@/ui/components/ProgressSection';
import { VideoPlayer } from '@/ui/components/VideoPlayer';
import { useGetJobStatusQuery } from '@/store/api/upscale.api';

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

export function JobDetail() {
  const { jobId } = useParams<{ jobId: string }>();

  const { data: job, isLoading, isError } = useGetJobStatusQuery(jobId!, {
    skip: !jobId,
    pollingInterval: 2000
  });

  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api';
  const downloadUrl = `${apiBaseUrl}/result/${jobId}`;

  if (!jobId) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center text-muted-foreground">
        Invalid job ID
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center text-muted-foreground">
        Loading job details...
      </div>
    );
  }

  if (isError || !job) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="text-center">
          <AlertCircle className="mx-auto size-12 text-destructive mb-4" />
          <h2 className="text-xl font-bold text-foreground">Job Not Found</h2>
          <p className="mt-2 text-muted-foreground">
            This job may have been removed or the backend is not running.
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link to="/dashboard">Back to Dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      {/* Back link */}
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft className="size-4" />
        Back to Dashboard
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Film className="size-6 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground truncate">{job.originalFilename}</h1>
            <p className="text-sm text-muted-foreground">
              {formatFileSize(job.fileSize)} &middot; {job.upscaleFactor}x upscale
            </p>
          </div>
        </div>
        <StatusBadge status={job.status} />
      </div>

      {/* Progress */}
      {(job.status === 'queued' || job.status === 'processing') && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Processing Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <ProgressSection progress={job.progress} status={job.status} />
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {job.status === 'failed' && job.error && (
        <div className="mb-6 rounded-lg border border-destructive/50 bg-destructive/5 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Processing Failed</p>
              <p className="mt-1 text-sm text-destructive/80">{job.error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Completed: Preview + Download */}
      {job.status === 'completed' && (
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Enhanced Video Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <VideoPlayer src={downloadUrl} />
            </CardContent>
          </Card>

          <Button asChild size="lg" className="w-full gap-2 text-base">
            <a href={downloadUrl} download>
              <Download className="size-4" />
              Download Enhanced Video
            </a>
          </Button>
        </div>
      )}

      {/* Job Details */}
      <Separator className="my-8" />
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-muted-foreground">Job ID</p>
          <p className="font-mono text-foreground text-xs mt-0.5 break-all">{job.id}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Upscale Factor</p>
          <p className="font-medium text-foreground mt-0.5">{job.upscaleFactor}x</p>
        </div>
        <div>
          <p className="text-muted-foreground">Created</p>
          <p className="font-medium text-foreground mt-0.5">{formatDate(job.createdAt)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Last Updated</p>
          <p className="font-medium text-foreground mt-0.5">{formatDate(job.updatedAt)}</p>
        </div>
      </div>
    </div>
  );
}
