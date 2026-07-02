import { resolveAiPreviewUrl } from '@/upload/preview-url.util';

describe('resolveAiPreviewUrl', () => {
  const base = 'http://ai.internal:8000';

  it('accepts frame and latest preview paths on the AI origin', () => {
    expect(resolveAiPreviewUrl(base, '/preview/job-1/42').href).toBe(
      'http://ai.internal:8000/preview/job-1/42'
    );
    expect(resolveAiPreviewUrl(base, '/preview/job-1/latest').pathname).toBe(
      '/preview/job-1/latest'
    );
  });

  it('accepts the original (_in) frame variants', () => {
    expect(resolveAiPreviewUrl(base, '/preview/job-1/42_in').pathname).toBe(
      '/preview/job-1/42_in'
    );
    expect(resolveAiPreviewUrl(base, '/preview/job-1/latest_in').pathname).toBe(
      '/preview/job-1/latest_in'
    );
    expect(() => resolveAiPreviewUrl(base, '/preview/job-1/42_out')).toThrow();
    expect(() => resolveAiPreviewUrl(base, '/preview/job-1/_in')).toThrow();
  });

  it('rejects other origins and URL-authority injection', () => {
    expect(() =>
      resolveAiPreviewUrl(base, 'http://evil.test/preview/job-1/1')
    ).toThrow(/unexpected URL/);
    expect(() => resolveAiPreviewUrl(base, '//evil.test/preview/job-1/1')).toThrow(
      /unexpected URL/
    );
  });

  it('rejects non-preview and malformed paths', () => {
    expect(() => resolveAiPreviewUrl(base, '/result/job-1')).toThrow();
    expect(() => resolveAiPreviewUrl(base, '/preview/job-1/1.5')).toThrow();
    expect(() => resolveAiPreviewUrl(base, '/preview/../etc/1')).toThrow();
    expect(() => resolveAiPreviewUrl(base, '/preview/job-1/1/extra')).toThrow();
    expect(() => resolveAiPreviewUrl(base, '/preview/job-1/1234567890')).toThrow();
  });
});
