import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { configurarClienteGeminiMock } from '../src/core/gemini';
import { reiniciarProyectoEnIndexedDB } from '../src/core/storage';

afterEach(async () => {
  cleanup();
  window.sessionStorage.clear();
  window.localStorage.clear();
  configurarClienteGeminiMock(null);
  await reiniciarProyectoEnIndexedDB();
});
