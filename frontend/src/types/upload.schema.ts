import { z } from 'zod/v4';

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
const ACCEPTED_VIDEO_TYPES = [
  'video/mp4',
  'video/x-msvideo',
  'video/x-matroska',
  'video/quicktime',
  'video/webm'
];

export const uploadSchema = z.object({
  video: z
    .instanceof(File, { error: 'Please select a video file' })
    .refine((file) => file.size <= MAX_FILE_SIZE, 'File size must be less than 500MB')
    .refine(
      (file) => ACCEPTED_VIDEO_TYPES.includes(file.type),
      'Only MP4, AVI, MKV, MOV, and WebM files are accepted'
    )
});

export type UploadFormData = z.infer<typeof uploadSchema>;
