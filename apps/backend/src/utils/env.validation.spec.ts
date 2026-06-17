import { validateEnv } from '@/utils/env.validation';

describe('validateEnv — AI transfer mode', () => {
  it('defaults AI_TRANSFER_MODE to "path"', () => {
    const env = validateEnv({});
    expect(env.AI_TRANSFER_MODE).toBe('path');
  });

  it('accepts AI_TRANSFER_MODE=remote', () => {
    const env = validateEnv({ AI_TRANSFER_MODE: 'remote' });
    expect(env.AI_TRANSFER_MODE).toBe('remote');
  });

  it('accepts AI_TRANSFER_MODE=path', () => {
    const env = validateEnv({ AI_TRANSFER_MODE: 'path' });
    expect(env.AI_TRANSFER_MODE).toBe('path');
  });

  it('rejects an invalid AI_TRANSFER_MODE', () => {
    expect(() => validateEnv({ AI_TRANSFER_MODE: 'cloud' })).toThrow(
      /AI_TRANSFER_MODE/
    );
  });

  it('defaults AI_INTERNAL_TOKEN to an empty string', () => {
    const env = validateEnv({});
    expect(env.AI_INTERNAL_TOKEN).toBe('');
  });

  it('preserves a configured AI_INTERNAL_TOKEN', () => {
    const env = validateEnv({ AI_INTERNAL_TOKEN: 'secret-token' });
    expect(env.AI_INTERNAL_TOKEN).toBe('secret-token');
  });
});
