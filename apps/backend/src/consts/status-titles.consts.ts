import { HttpStatus } from '@nestjs/common';

export const DEFAULT_STATUS_TITLE = 'Error';

export const STATUS_TITLES: ReadonlyMap<number, string> = new Map(
  Object.entries(HttpStatus)
    .filter(([, value]) => typeof value === 'number')
    .map(([name, value]) => [value as number, formatStatusName(name)] as const)
);

function formatStatusName(name: string): string {
  return name
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
