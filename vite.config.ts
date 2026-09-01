import preact from '@preact/preset-vite'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import type { Plugin, UserConfig } from 'vite'

import { renderHelpDocument } from './src/lib/help-document'

const sourceRoot = fileURLToPath(new URL('./src', import.meta.url))
const backgroundEntry = fileURLToPath(new URL('./src/background/index.ts', import.meta.url))
const offscreenEntry = fileURLToPath(new URL('./src/offscreen/index.ts', import.meta.url))
const popupEntry = fileURLToPath(new URL('./src/popup/main.tsx', import.meta.url))
const contentEntry = fileURLToPath(new URL('./src/content/index.tsx', import.meta.url))
const helpSourcePath = fileURLToPath(new URL('./docs/HELP.md', import.meta.url))

/** Where the popup's help button sends the browser. */
const HELP_PAGE_FILE = 'help/index.html'

/**
 * Renders docs/HELP.md into the static page the popup's help button opens. That
 * document is written for someone running the extension, who has no copy of
 * this repository, which is why the page is not generated from README.md.
 * Emitting it through Rollup means a watch rebuild refreshes it as well.
 */
function createHelpPagePlugin(): Plugin {
  return {
    name: 'echo-read-help-page',
    async buildStart() {
      this.addWatchFile(helpSourcePath)

      try {
        const markdown = await readFile(helpSourcePath, 'utf8')
        this.emitFile({
          type: 'asset',
          fileName: HELP_PAGE_FILE,
          source: renderHelpDocument(markdown)
        })
      } catch (error) {
        this.error(`Could not build ${HELP_PAGE_FILE} from docs/HELP.md: ${String(error)}`)
      }
    }
  }
}

/**
 * Creates the build settings shared by extension pages and the content script.
 * The legacy backend alias is intentionally absent because the migrated extension
 * communicates only through local Provider, Repository, and runtime message contracts.
 */
function createSharedConfig(isDevelopment: boolean) {
  return {
    plugins: [preact()],
    resolve: {
      alias: {
        '@': sourceRoot
      }
    },
    build: {
      sourcemap: isDevelopment,
      minify: isDevelopment ? false : 'esbuild'
    }
  }
}

/**
 * Builds the MV3 service worker and the popup application before the content build.
 * Vite copies public assets here so the manifest, icons, popup shell, DNR rules, and
 * retained highlight worklet are emitted exactly once into the extension directory.
 */
function createMainConfig(isDevelopment: boolean): UserConfig {
  const shared = createSharedConfig(isDevelopment)

  return {
    ...shared,
    plugins: [...shared.plugins, createHelpPagePlugin()],
    publicDir: 'public',
    build: {
      ...shared.build,
      outDir: 'output',
      emptyOutDir: true,
      modulePreload: false,
      rollupOptions: {
        input: {
          background: backgroundEntry,
          offscreen: offscreenEntry,
          popup: popupEntry
        },
        output: {
          entryFileNames: (chunkInfo) => {
            if (chunkInfo.name === 'background') return 'background.js'
            if (chunkInfo.name === 'offscreen') return 'offscreen/offscreen.js'
            return 'popup/[name].js'
          },
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: (assetInfo) =>
            assetInfo.name?.endsWith('.css')
              ? 'popup/styles/popup.css'
              : 'assets/[name]-[hash][extname]'
        }
      }
    }
  }
}

/**
 * Builds the content script as a single IIFE because Manifest V3 content scripts do
 * not use the service worker's ES module loading model. This second build preserves
 * the output created by the main build and emits a stable CSS path for the manifest.
 */
function createContentConfig(isDevelopment: boolean): UserConfig {
  const shared = createSharedConfig(isDevelopment)

  return {
    ...shared,
    publicDir: false,
    build: {
      ...shared.build,
      outDir: 'output',
      emptyOutDir: false,
      sourcemap: isDevelopment ? 'inline' : false,
      lib: {
        entry: contentEntry,
        name: 'EchoReadContent',
        formats: ['iife'],
        fileName: () => 'content.js'
      },
      rollupOptions: {
        output: {
          assetFileNames: 'styles/content.[ext]'
        }
      }
    }
  }
}

export default defineConfig(({ mode }) => {
  const isDevelopment = mode === 'development'

  return process.env.BUILD_TARGET === 'content'
    ? createContentConfig(isDevelopment)
    : createMainConfig(isDevelopment)
})
