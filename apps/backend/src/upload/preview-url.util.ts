const AI_PREVIEW_PATH_PATTERN =
  /^\/preview\/[A-Za-z0-9_-]{1,128}\/(latest|\d{1,9})(_in)?$/;

/**
 * Resolves an AI-provided preview download path against the AI service base
 * URL. Throws unless the result stays on the AI origin and matches the
 * expected `/preview/{jobId}/{frame}` shape — the path originates from the
 * AI's NDJSON stream and is untrusted (SSRF / URL-authority-injection
 * defense, mirroring the result-download check).
 */
export function resolveAiPreviewUrl(
  aiServiceUrl: string,
  downloadPath: string
): URL {
  const base = new URL(aiServiceUrl);
  let target: URL;
  try {
    target = new URL(downloadPath, base);
  } catch {
    throw new Error('AI returned an invalid preview download URL.');
  }
  if (
    target.origin !== base.origin ||
    !AI_PREVIEW_PATH_PATTERN.test(target.pathname)
  ) {
    throw new Error('Refusing to download preview from an unexpected URL.');
  }
  return target;
}
