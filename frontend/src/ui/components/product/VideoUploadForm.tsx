import { useState, useRef, useCallback } from 'react';
import type { DragEvent, ChangeEvent } from 'react';
import { Upload, FileVideo, X } from 'lucide-react';
import { cn } from '@/ui/shadcn/lib/utils';
import { Button } from '@/ui/shadcn/ui/button';
import { formatFileSize } from '@/utils/format';

const ACCEPTED_TYPES = ['video/mp4', 'video/x-msvideo', 'video/x-matroska', 'video/quicktime', 'video/webm'];
const MAX_SIZE = 500 * 1024 * 1024;

interface VideoUploadFormProps {
  onUpload: (file: File) => void;
  isUploading: boolean;
}

export function VideoUploadForm({ onUpload, isUploading }: VideoUploadFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validate = useCallback((f: File): string | null => {
    if (!ACCEPTED_TYPES.includes(f.type)) {
      return 'Only MP4, AVI, MKV, MOV, and WebM files are accepted.';
    }
    if (f.size > MAX_SIZE) {
      return 'File size must be less than 500 MB.';
    }
    return null;
  }, []);

  const handleFile = useCallback(
    (f: File) => {
      const err = validate(f);
      if (err) {
        setError(err);
        setFile(null);
      } else {
        setError(null);
        setFile(f);
      }
    },
    [validate]
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) handleFile(droppedFile);
    },
    [handleFile]
  );

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0];
      if (selected) handleFile(selected);
    },
    [handleFile]
  );

  const clearFile = useCallback(() => {
    setFile(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const handleSubmit = useCallback(() => {
    if (file) onUpload(file);
  }, [file, onUpload]);

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !file && inputRef.current?.click()}
        className={cn(
          'relative flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-colors',
          dragOver
            ? 'border-primary bg-primary/5'
            : file
              ? 'border-primary/40 bg-primary/5 cursor-default'
              : 'border-border hover:border-primary/40 hover:bg-muted/50'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          onChange={handleChange}
          className="hidden"
        />

        {file ? (
          <div className="flex items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileVideo className="size-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
              <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => {
                e.stopPropagation();
                clearFile();
              }}
            >
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Upload className="size-5" />
            </div>
            <p className="text-sm font-medium text-foreground">
              Drag &amp; drop your video here
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              or click to browse &middot; MP4, AVI, MKV, MOV, WebM &middot; up to 500 MB
            </p>
          </>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button
        onClick={handleSubmit}
        disabled={!file || isUploading}
        className="w-full"
        size="lg"
      >
        {isUploading ? (
          <>
            <span className="mr-2 inline-block size-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
            Uploading...
          </>
        ) : (
          <>
            <Upload className="size-4" data-icon="inline-start" />
            Upload &amp; Process
          </>
        )}
      </Button>
    </div>
  );
}
