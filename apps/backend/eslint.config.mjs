import { nodeConfig } from '@repo/eslint-config/node';
import globals from 'globals';

export default [
  ...nodeConfig,
  {
    files: ['src/**/*.module.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off'
    }
  },
  {
    languageOptions: {
      globals: {
        ...globals.jest
      },
      sourceType: 'commonjs'
    }
  }
];
