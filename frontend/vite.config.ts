import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxy = {
    '/api': {
      target: env.API_TARGET || 'http://127.0.0.1:3000',
      rewrite: (path: string) => path.replace(/^\/api/, ''),
    },
  };
  return {
    // GitHub Pages project sites are served from /<repository>/.
    base: env.BASE_PATH || '/',
    plugins: [svelte()],
    server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy },
  };
});
