import { defineConfig } from 'vite';

// `base: './'` makes every asset URL in the built index.html relative (e.g.
// `./assets/main-abc123.js`) instead of absolute (`/assets/main-abc123.js`).
// This is what lets the same `dist/` output work on GitHub Pages project
// sites (`https://<user>.github.io/<repo>/`), user sites (`https://<user>.github.io/`),
// custom domains, and any subfolder you drop it into - no rebuild needed.
export default defineConfig({
  base: './',
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: 'dist',
  },
});
