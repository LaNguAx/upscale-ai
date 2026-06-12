import { config as reactInternalConfig } from '@repo/eslint-config/react-internal';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import reactRefresh from 'eslint-plugin-react-refresh';

export default defineConfig([
  globalIgnores(['dist']),
  ...reactInternalConfig,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactRefresh.configs.vite.rules
    }
  },
  {
    files: ['vite.config.{js,mjs,cjs,ts,mts,cts}'],
    languageOptions: {
      globals: globals.node
    }
  },
  {
    // Generated shadcn/radix primitives follow upstream patterns; keep the
    // strictest type-checked rules from blocking vendored code.
    files: ['src/ui/shadcn/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      'react-refresh/only-export-components': 'off'
    }
  }
]);
