import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json' with { type: 'json' };
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';

/**
 * Post-build plugin: inline the service worker bundle into the loader file.
 * CRXJS generates a service-worker-loader.js that uses `import './assets/...'`
 * which can fail in Chrome extension context. This plugin replaces the loader
 * with the actual bundled code.
 */
function inlineServiceWorker() {
  return {
    name: 'inline-service-worker',
    closeBundle() {
      const distDir = 'dist';
      const manifestPath = join(distDir, 'manifest.json');

      if (!existsSync(manifestPath)) return;

      const distManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const swPath = distManifest?.background?.service_worker;
      if (!swPath) return;

      const loaderFullPath = join(distDir, swPath);
      if (!existsSync(loaderFullPath)) return;

      const loaderContent = readFileSync(loaderFullPath, 'utf8');
      const importMatch = loaderContent.match(/import\s+['"](.+?)['"]/);

      if (importMatch) {
        const importedRelPath = importMatch[1];
        const importedFullPath = join(dirname(loaderFullPath), importedRelPath);

        if (existsSync(importedFullPath)) {
          const bundledCode = readFileSync(importedFullPath, 'utf8');
          // Replace loader with actual bundled code
          writeFileSync(loaderFullPath, bundledCode);
          console.log(`✅ Inlined service worker: ${importedRelPath} → ${swPath}`);
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [
    crx({ manifest }),
    inlineServiceWorker(),
  ],
  base: '',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173,
    },
  },
});
