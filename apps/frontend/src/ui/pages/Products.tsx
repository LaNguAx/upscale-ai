import { useState, useCallback } from 'react';
import { ZoomIn, RotateCcw } from 'lucide-react';
import type { JobPreview } from '@repo/schemas/jobs';
import { PageContainer } from '@/ui/components/PageContainer';
import { VideoUploadForm } from '@/ui/components/product/VideoUploadForm';
import { JobStatusPanel } from '@/ui/components/product/JobStatusPanel';
import { JobResultPanel } from '@/ui/components/product/JobResultPanel';
import { ComparisonPlayer } from '@/ui/components/product/ComparisonPlayer';
import { ProductErrorBoundary } from '@/ui/components/product/ProductErrorBoundary';
import { Alert, AlertDescription } from '@/ui/shadcn/ui/alert';
import { Button } from '@/ui/shadcn/ui/button';
import {
  useUploadVideoMutation,
  useCancelJobMutation
} from '@/store/api/upscale.api';
import { useAppDispatch } from '@/store/hooks';
import { addJob } from '@/store/slices/job.slice';

type PageState =
  | 'idle'
  | 'uploading'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

type UploadMutationError =
  | {
      error?: string;
      // The backend returns RFC 7807 ProblemDetails (`detail`/`title`); the
      // legacy `message` shape is kept as a fallback.
      data?: { detail?: string; title?: string; message?: string | string[] };
      status?: string | number;
    }
  | undefined;

function getApiErrorMessage(error: unknown): string | null {
  const typedError = error as UploadMutationError;
  if (!typedError) {
    return null;
  }

  if (typeof typedError.error === 'string' && typedError.error.length > 0) {
    return typedError.error;
  }

  const { detail, title, message } = typedError.data ?? {};
  if (typeof detail === 'string' && detail.length > 0) {
    return detail;
  }
  if (Array.isArray(message)) {
    return message.join(', ');
  }
  if (typeof message === 'string' && message.length > 0) {
    return message;
  }
  if (typeof title === 'string' && title.length > 0) {
    return title;
  }

  return null;
}

function getUploadErrorMessage(error: unknown): string {
  return (
    getApiErrorMessage(error) ??
    'Failed to upload video. Please check your connection and try again.'
  );
}

function getCancelErrorMessage(error: unknown): string {
  return (
    getApiErrorMessage(error) ?? 'Failed to stop upscaling. Please try again.'
  );
}

export function Products() {
  const [pageState, setPageState] = useState<PageState>('idle');
  const [jobId, setJobId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [uploadVideo] = useUploadVideoMutation();
  const [cancelJob] = useCancelJobMutation();
  const dispatch = useAppDispatch();

  const [preview, setPreview] = useState<JobPreview | null>(null);

  /** Keep the freshest frame: a slow poll can resolve after a newer SSE update. */
  const handlePreview = useCallback((incoming: JobPreview) => {
    setPreview((current) =>
      current && current.frameIndex > incoming.frameIndex ? current : incoming
    );
  }, []);

  const handleUpload = useCallback(
    async (file: File) => {
      setPreview(null);
      setPageState('uploading');
      setUploadProgress(0);
      setUploadError(null);
      setProcessingError(null);
      setIsStopping(false);

      try {
        const formData = new FormData();
        formData.append('video', file);

        const result = await uploadVideo({
          formData,
          onProgress: (p) => {
            setUploadProgress(p);
          }
        }).unwrap();

        setJobId(result.jobId);
        setPageState('processing');
        dispatch(
          addJob({
            jobId: result.jobId,
            filename: file.name,
            submittedAt: new Date().toISOString()
          })
        );
      } catch (error) {
        setUploadError(getUploadErrorMessage(error));
        setPageState('idle');
      }
    },
    [uploadVideo, dispatch]
  );

  const handleReset = useCallback(() => {
    setPageState('idle');
    setJobId(null);
    setUploadProgress(0);
    setUploadError(null);
    setProcessingError(null);
    setIsStopping(false);
    setPreview(null);
  }, []);

  const handleStopUpscaling = useCallback(async () => {
    if (!jobId) return;
    try {
      setIsStopping(true);
      await cancelJob(jobId).unwrap();
    } catch (error) {
      setProcessingError(getCancelErrorMessage(error));
      setPageState('failed');
      setIsStopping(false);
    }
  }, [cancelJob, jobId]);

  return (
    <section className="py-16 sm:py-20">
      <PageContainer className="max-w-2xl">
        <div className="mb-12 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ZoomIn className="size-7" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Video Upscaler
          </h1>
          <p className="mt-3 text-lg text-muted-foreground max-w-xl mx-auto">
            Increase video resolution 4x using our BasicVSR-based deep
            learning super-resolution model, recovering fine spatial detail
            lost in low-resolution recordings.
          </p>
        </div>

        {uploadError && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{uploadError}</AlertDescription>
          </Alert>
        )}

        <ProductErrorBoundary onReset={handleReset}>
          {(pageState === 'idle' || pageState === 'uploading') && (
            <VideoUploadForm
              onUpload={(file) => {
                void handleUpload(file);
              }}
              isUploading={pageState === 'uploading'}
              uploadProgress={uploadProgress}
            />
          )}

          {(pageState === 'processing' || pageState === 'completed') &&
            jobId && (
              <div className="space-y-4">
                {/* One player across processing → completed: no remount, no swap. */}
                <ComparisonPlayer
                  key={jobId}
                  jobId={jobId}
                  phase={pageState === 'completed' ? 'completed' : 'processing'}
                  preview={preview}
                />

                {pageState === 'processing' && (
                  <JobStatusPanel
                    jobId={jobId}
                    onPreview={handlePreview}
                    onCompleted={() => {
                      setPageState('completed');
                    }}
                    onCancelled={(reason) => {
                      setProcessingError(
                        reason ?? 'Upscaling cancelled by user.'
                      );
                      setPageState('cancelled');
                      setIsStopping(false);
                    }}
                    onFailed={(reason) => {
                      setProcessingError(
                        reason ?? 'AI inference failed. Please try again.'
                      );
                      setPageState('failed');
                      setIsStopping(false);
                    }}
                    onStop={() => {
                      void handleStopUpscaling();
                    }}
                    isStopping={isStopping}
                  />
                )}

                {pageState === 'completed' && (
                  <JobResultPanel jobId={jobId} onReset={handleReset} />
                )}
              </div>
            )}

          {pageState === 'failed' && (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertDescription>
                  {processingError ??
                    'Video processing failed. This may be due to an unsupported format or a server issue.'}
                </AlertDescription>
              </Alert>
              <Button
                variant="outline"
                onClick={handleReset}
                className="w-full"
              >
                <RotateCcw className="size-4" data-icon="inline-start" />
                Try Again
              </Button>
            </div>
          )}

          {pageState === 'cancelled' && (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>
                  {processingError ?? 'Upscaling cancelled successfully.'}
                </AlertDescription>
              </Alert>
              <Button
                variant="outline"
                onClick={handleReset}
                className="w-full"
              >
                <RotateCcw className="size-4" data-icon="inline-start" />
                Upload New Video
              </Button>
            </div>
          )}
        </ProductErrorBoundary>
      </PageContainer>
    </section>
  );
}
