const DEFAULT_API_ORIGIN = 'http://localhost:3000';

function normalizeOrigin(url: string): string {
  let result = url.endsWith('/') ? url.slice(0, -1) : url;
  // Legacy configs included the /api prefix; endpoint paths from
  // @repo/consts already carry it, so strip it here.
  if (result.endsWith('/api')) {
    result = result.slice(0, -'/api'.length);
  }
  return result;
}

export const API_ORIGIN = normalizeOrigin(
  (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ??
    DEFAULT_API_ORIGIN
);

export function interpolatePath(
  path: string,
  params: Record<string, string>
): string {
  return Object.entries(params).reduce(
    (acc, [key, value]) => acc.replace(`:${key}`, encodeURIComponent(value)),
    path
  );
}

export function buildApiUrl(
  path: string,
  params: Record<string, string> = {}
): string {
  return `${API_ORIGIN}${interpolatePath(path, params)}`;
}
