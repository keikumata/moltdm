import { defineConfig } from 'tsup';

export default defineConfig([
  // Node.js builds (CJS + ESM + types)
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    splitting: false,
  },
  // Browser IIFE build (for script tag inclusion)
  {
    entry: { 'moltdm.browser': 'src/index.ts' },
    format: ['iife'],
    globalName: 'MoltDM',
    platform: 'browser',
    splitting: false,
    minify: true,
    outExtension: () => ({ js: '.js' }),
    // Externalize Node.js built-ins - they won't be used in browser
    external: ['fs', 'path', 'os'],
    noExternal: [/@noble/],
  },
]);
