import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier';
import turboPlugin from 'eslint-plugin-turbo';
import tseslint from 'typescript-eslint';

const typedLintFiles = [
  '**/src/**/*.{ts,tsx}',
  '**/test/**/*.{ts,tsx}',
  '**/*.spec.{ts,tsx}',
  '**/*.test.{ts,tsx}',
  '**/*.e2e-spec.ts'
];

/**
 * A shared ESLint configuration for the repository.
 */
export const config = defineConfig(
  {
    ignores: ['dist/**']
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' }
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error'
    }
  },
  {
    plugins: {
      turbo: turboPlugin
    },
    rules: {
      'turbo/no-undeclared-env-vars': 'error'
    }
  },
  {
    files: typedLintFiles,
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true
      }
    },
    rules: {
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error'
    }
  },
  eslintConfigPrettier
);
