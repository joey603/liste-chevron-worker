import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import { copyFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(
  readFileSync(path.join(rootDir, 'package.json'), 'utf-8'),
) as { version: string }

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          plugins: [
            {
              name: 'copy-whatsapp-preload',
              closeBundle() {
                copyFileSync(
                  path.join(rootDir, 'electron/whatsapp-preload.js'),
                  path.join(rootDir, 'dist-electron/whatsapp-preload.js'),
                )
              },
            },
          ],
          build: {
            rollupOptions: {
              external: ['electron', 'electron-updater'],
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            rollupOptions: {
              external: ['electron', 'electron-updater'],
            },
          },
        },
      },
      renderer: {},
    }),
  ],
  server: {
    port: 5173,
  },
})
