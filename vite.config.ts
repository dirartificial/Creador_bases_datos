import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const securityHeaders = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self' https://generativelanguage.googleapis.com https://openrouter.ai; img-src 'self' data: blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

export default defineConfig({
  plugins: [react()],
  preview: {
    headers: securityHeaders,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    fileParallelism: false,
  },
});
