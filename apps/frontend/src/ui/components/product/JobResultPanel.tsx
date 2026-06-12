import { UPLOAD_STREAM_ENDPOINT } from '@repo/consts/upload';
import { useGetJobResultQuery } from '@/store/api/upscale.api';
import { Button } from '@/ui/shadcn/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/ui/card';
import { Skeleton } from '@/ui/shadcn/ui/skeleton';
import { Alert, AlertDescription } from '@/ui/shadcn/ui/alert';
import { Download, RotateCcw } from 'lucide-react';
import { buildApiUrl } from '@/config/api';

function downloadFile(url: string, filename: string) {
  fetch(url)
    .then((res) => res.blob())
    .then((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch(() => {
      // Best-effort download; the inline player still works if this fails.
    });
}

interface JobResultPanelProps {
  jobId: string;
  onReset: () => void;
}

export function JobResultPanel({ jobId, onReset }: JobResultPanelProps) {
  const { data: result, isLoading, error } = useGetJobResultQuery(jobId);
  const streamUrl = buildApiUrl(UPLOAD_STREAM_ENDPOINT, { jobId });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="space-y-4 p-6">
          <Skeleton className="aspect-video w-full rounded-lg" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !result) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>Unable to load the enhanced video. Please try again.</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={onReset} className="w-full">
          <RotateCcw className="size-4" data-icon="inline-start" />
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Enhancement Complete</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
          <video
            src={streamUrl}
            controls
            className="aspect-video w-full"
          />
        </div>

        <div className="flex gap-3">
          <Button
            className="flex-1"
            onClick={() => { downloadFile(streamUrl, result.outputFilename); }}
          >
            <Download className="size-4" data-icon="inline-start" />
            Download Enhanced Video
          </Button>
          <Button variant="outline" onClick={onReset}>
            <RotateCcw className="size-4" data-icon="inline-start" />
            New Video
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
