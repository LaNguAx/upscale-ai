import { Badge } from '@/ui/shadcn/ui/badge';
import type { JobStatus } from '@/types/upscale.types';

const statusConfig: Record<JobStatus, { label: string; className: string }> = {
  queued: {
    label: 'Queued',
    className: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
  },
  processing: {
    label: 'Processing',
    className: 'bg-blue-500/10 text-blue-500 border-blue-500/20'
  },
  completed: {
    label: 'Completed',
    className: 'bg-green-500/10 text-green-500 border-green-500/20'
  },
  failed: {
    label: 'Failed',
    className: 'bg-red-500/10 text-red-500 border-red-500/20'
  }
};

export function StatusBadge({ status }: { status: JobStatus }) {
  const config = statusConfig[status];

  return (
    <Badge variant="outline" className={config.className}>
      {status === 'processing' && (
        <span className="mr-1.5 size-1.5 rounded-full bg-blue-500 animate-pulse" />
      )}
      {config.label}
    </Badge>
  );
}
