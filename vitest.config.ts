import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const sourceRoot = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  resolve: {
    // Match the application alias so migrated tests exercise production imports.
    alias: {
      '@': sourceRoot
    }
  },
  test: {
    // The retained selection and text-mapping tests require Range and DOM APIs.
    environment: 'happy-dom',

    // Tests import Vitest APIs explicitly, which keeps globals out of extension code.
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],

    // Prevent mock state from leaking across Provider, Repository, and message tests.
    clearMocks: true,
    restoreMocks: true
  }
})
