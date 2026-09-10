import { defineConfig } from 'vite';

// The arcade is the only game-facing app: one page, one trainer connection.
export default defineConfig({
  // Relative asset URLs, not root-absolute ones. GitHub Pages serves a project
  // site from `/<repo>/`, where `/assets/…` would 404; `./assets/…` resolves
  // against whatever directory the page is actually in. The same property also
  // lets the built `index.html` run straight off the filesystem, which is how
  // someone without a trainer can try it from a downloaded copy — though a real
  // trainer still needs a secure context, so Bluetooth wants the hosted URL or
  // localhost.
  base: './',
  server: { port: 5185, host: 'localhost' },
});
