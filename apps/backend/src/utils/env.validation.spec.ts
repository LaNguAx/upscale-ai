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

describe('validateEnv preview vars', () => {
  it('defaults PREVIEW_ENABLED to true and PREVIEW_DIR to the shared storage dir', () => {
    const env = validateEnv({});
    expect(env.PREVIEW_ENABLED).toBe(true);
    expect(env.PREVIEW_DIR).toBe('../../storage/previews');
  });

  it('parses PREVIEW_ENABLED=false as boolean false', () => {
    expect(validateEnv({ PREVIEW_ENABLED: 'false' }).PREVIEW_ENABLED).toBe(false);
  });

  it('rejects non-boolean PREVIEW_ENABLED values', () => {
    expect(() => validateEnv({ PREVIEW_ENABLED: 'banana' })).toThrow(
      /PREVIEW_ENABLED/
    );
  });
});
