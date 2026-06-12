const DEFAULT_API_BASE_URL = 'http://localhost:3000/api';

function normalizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export const API_BASE_URL = normalizeBaseUrl(
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
    DEFAULT_API_BASE_URL,
);
