export const GENERIC_500_TITLE = 'Internal Server Error';
export const GENERIC_500_DETAIL = 'An unexpected error occurred.';
export const ZOD_SERIALIZATION_DEV_DETAIL =
  'Response failed server-side schema validation';
export const VALIDATION_FAILED_TITLE = 'Validation failed';
export const VALIDATION_FAILED_DEV_DETAIL = 'Request failed schema validation';
export const VALIDATION_FAILED_PROD_DETAIL = 'The request is invalid.';
export const UPLOAD_TOO_LARGE_DETAIL = (maxSizeMb: number): string =>
  `Video is larger than the ${String(maxSizeMb)} MB limit.`;
