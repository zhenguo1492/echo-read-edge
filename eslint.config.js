import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // Generated artifacts and installed dependencies are never project lint inputs.
    ignores: ['node_modules/**', 'output/**', 'coverage/**', '*.zip']
  },

  // Use the maintained TypeScript rules without requiring type-aware linting during migration.
  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // Type-only imports make extension bundle boundaries easier to inspect.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          fixStyle: 'separate-type-imports',
          prefer: 'type-imports'
        }
      ]
    }
  },

  {
    files: ['src/content/**/*.{ts,tsx}', 'src/popup/**/*.{ts,tsx}'],
    languageOptions: {
      // Page-facing UI modules may use DOM and Chrome extension globals.
      globals: {
        ...globals.browser,
        ...globals.webextensions
      }
    }
  },

  {
    files: [
      'src/background/**/*.ts',
      'src/providers/**/*.ts',
      'src/storage/**/*.ts'
    ],
    languageOptions: {
      // Service-worker modules use worker APIs but must not depend on page globals.
      globals: {
        ...globals.worker,
        ...globals.serviceworker,
        ...globals.webextensions
      }
    }
  },

  {
    files: ['src/**/*.test.{ts,tsx}'],
    languageOptions: {
      // happy-dom provides browser APIs to retained selection and component tests.
      globals: {
        ...globals.browser,
        ...globals.webextensions
      }
    }
  },

  {
    files: ['vite.config.ts', 'vitest.config.ts'],
    languageOptions: {
      // Build configuration executes in Node rather than an extension context.
      globals: globals.node
    }
  },

  {
    files: ['eslint.config.js'],
    languageOptions: {
      globals: globals.node
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  }
)
