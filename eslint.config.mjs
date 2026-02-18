import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'

export default defineConfig([
  { files: ['src/**/*.{ts}', 'tests/**/*.{ts}'] },
  {
    files: ['src/**/*.{ts}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },
  {
    files: ['src/**/*.ts'],
    plugins: {
      import: importPlugin,
    },
    rules: {
      // assert relative imports always have .ts extension
      'import/extensions': [
        'error',
        'ignorePackages',
        {
          ts: 'always',
          tsx: 'never',
          js: 'never',
          jsx: 'never',
          mjs: 'never',
          cjs: 'never',
        },
      ],
    },
  },
])
