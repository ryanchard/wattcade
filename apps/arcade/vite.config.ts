import { defineConfig } from 'vite';
// The arcade is the only game-facing app: one page, one trainer connection.
export default defineConfig({ server: { port: 5185, host: 'localhost' } });
