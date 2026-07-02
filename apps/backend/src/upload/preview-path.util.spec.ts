import * as path from 'node:path';
import { resolvePreviewFilePath } from '@/upload/preview-path.util';

describe('resolvePreviewFilePath', () => {
  const base = path.resolve('previews');

  it('resolves a frame-indexed preview inside the preview dir', () => {
    expect(resolvePreviewFilePath('previews', 'job-1', '42')).toBe(
      path.join(base, 'job-1', '42.jpg')
    );
  });

  it('resolves latest.jpg', () => {
    expect(resolvePreviewFilePath('previews', 'job-1', 'latest')).toBe(
      path.join(base, 'job-1', 'latest.jpg')
    );
  });

  it('rejects traversal and malformed input', () => {
    expect(resolvePreviewFilePath('previews', '../evil', '1')).toBeNull();
    expect(resolvePreviewFilePath('previews', 'a/b', 'latest')).toBeNull();
    expect(resolvePreviewFilePath('previews', 'job.1', 'latest')).toBeNull();
    expect(resolvePreviewFilePath('previews', 'job-1', '..')).toBeNull();
    expect(resolvePreviewFilePath('previews', 'job-1', '-1')).toBeNull();
    expect(resolvePreviewFilePath('previews', 'job-1', '1.5')).toBeNull();
    expect(resolvePreviewFilePath('previews', 'job-1', '1234567890')).toBeNull();
    expect(resolvePreviewFilePath('previews', 'job-1', '')).toBeNull();
  });
});
