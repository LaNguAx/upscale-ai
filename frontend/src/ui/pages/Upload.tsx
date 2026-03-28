import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/ui/shadcn/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/ui/card';
import { VideoDropzone } from '@/ui/components/VideoDropzone';
import { useUploadVideoMutation } from '@/store/api/upscale.api';

const UPSCALE_OPTIONS = [
  { value: 2, label: '2x', desc: 'Recommended' },
  { value: 3, label: '3x', desc: 'High quality' },
  { value: 4, label: '4x', desc: 'Maximum' }
];

export function Upload() {
  const navigate = useNavigate();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [upscaleFactor, setUpscaleFactor] = useState(2);
  const [uploadVideo, { isLoading, error }] = useUploadVideoMutation();

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;

    const formData = new FormData();
    formData.append('video', selectedFile);
    formData.append('upscaleFactor', String(upscaleFactor));

    try {
      const result = await uploadVideo(formData).unwrap();
      navigate(`/jobs/${result.jobId}`);
    } catch {
      // Error is handled via the `error` state from the mutation
    }
  }, [selectedFile, upscaleFactor, uploadVideo, navigate]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-foreground">Upload Video</h1>
        <p className="mt-2 text-muted-foreground">
          Select a video to enhance with AI-powered super resolution
        </p>
      </div>

      <div className="space-y-6">
        <VideoDropzone
          onFileSelected={setSelectedFile}
          selectedFile={selectedFile}
          onClear={() => setSelectedFile(null)}
          disabled={isLoading}
        />

        {selectedFile && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Enhancement Settings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <label className="text-sm font-medium text-foreground">Upscale Factor</label>
                <div className="flex gap-3">
                  {UPSCALE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setUpscaleFactor(opt.value)}
                      className={`flex-1 rounded-lg border p-3 text-center transition-all ${
                        upscaleFactor === opt.value
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-border hover:border-primary/30'
                      }`}
                    >
                      <span className="block text-lg font-bold text-foreground">{opt.label}</span>
                      <span className="block text-xs text-muted-foreground">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
            {'data' in error && typeof error.data === 'object' && error.data !== null && 'message' in error.data
              ? String((error.data as { message: string }).message)
              : 'Upload failed. Please check that the AI service is running and try again.'}
          </div>
        )}

        {selectedFile && (
          <Button
            size="lg"
            className="w-full gap-2 text-base"
            onClick={handleUpload}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Sparkles className="size-4" />
                Start Enhancement
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
