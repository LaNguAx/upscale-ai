import { Link } from 'react-router';
import { Film, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/ui/shadcn/ui/card';
import { Progress } from '@/ui/shadcn/ui/progress';
import { StatusBadge } from '@/ui/components/StatusBadge';
import type { JobStatusResponse } from '@/types/upscale.types';

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function JobCard({ job }: { job: JobStatusResponse }) {
  return (
    <Link to={`/jobs/${job.id}`}>
      <Card className="group transition-all hover:border-primary/30 hover:shadow-md">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Film className="size-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-foreground truncate">{job.originalFilename}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(job.fileSize)} &middot; {job.upscaleFactor}x &middot;{' '}
                  {timeAgo(job.createdAt)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusBadge status={job.status} />
              <ArrowRight className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>
          {(job.status === 'processing' || job.status === 'queued') && (
            <div className="mt-3">
              <Progress value={job.progress} className="h-1.5" />
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
