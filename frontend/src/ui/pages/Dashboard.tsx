import { useState } from 'react';
import { Link } from 'react-router';
import { Upload, Inbox } from 'lucide-react';
import { Button } from '@/ui/shadcn/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/ui/tabs';
import { JobCard } from '@/ui/components/JobCard';
import { useGetAllJobsQuery } from '@/store/api/upscale.api';
import type { JobStatus } from '@/types/upscale.types';

type FilterTab = 'all' | JobStatus;

export function Dashboard() {
  const [filter, setFilter] = useState<FilterTab>('all');
  const { data: jobs = [], isLoading, isError } = useGetAllJobsQuery(undefined, {
    pollingInterval: 5000
  });

  const filtered = filter === 'all' ? jobs : jobs.filter((j) => j.status === filter);
  const counts = {
    all: jobs.length,
    processing: jobs.filter((j) => j.status === 'processing' || j.status === 'queued').length,
    completed: jobs.filter((j) => j.status === 'completed').length,
    failed: jobs.filter((j) => j.status === 'failed').length
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
          <p className="mt-1 text-muted-foreground">
            {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'} total
          </p>
        </div>
        <Button asChild className="gap-2">
          <Link to="/upload">
            <Upload className="size-4" />
            New Upload
          </Link>
        </Button>
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterTab)} className="mb-6">
        <TabsList>
          <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
          <TabsTrigger value="processing">Active ({counts.processing})</TabsTrigger>
          <TabsTrigger value="completed">Completed ({counts.completed})</TabsTrigger>
          <TabsTrigger value="failed">Failed ({counts.failed})</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          Loading jobs...
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive text-center">
          Failed to load jobs. Make sure the backend is running.
        </div>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-muted mb-4">
            <Inbox className="size-7 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium text-foreground">
            {filter === 'all' ? 'No jobs yet' : `No ${filter} jobs`}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {filter === 'all'
              ? 'Upload a video to get started with AI enhancement.'
              : 'Try a different filter or upload a new video.'}
          </p>
          {filter === 'all' && (
            <Button asChild className="mt-6 gap-2">
              <Link to="/upload">
                <Upload className="size-4" />
                Upload Video
              </Link>
            </Button>
          )}
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
