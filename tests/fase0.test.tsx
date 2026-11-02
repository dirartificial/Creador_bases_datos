import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { App } from '../src/App';
import {
  enmascararApiKey,
  guardarApiKey,
  obtenerApiKey,
  olvidarApiKey,
  tieneApiKey,
  validarFormatoKey,
} from '../src/core/key';
import {
  configurarClienteGeminiMock,
  consultarGeminiEstructurado,
  probarConexionGemini,
} from '../src/core/gemini';

const FAKE_KEY = 'AIzaSyTestKey1234567890abcdefXYZ987';

describe('Fase 0 — Seguridad de la API Key y Almacenamiento', () => {
  it('guarda la API key únicamente en sessionStorage y jamás en localStorage, cookies ni URL', () => {
    guardarApiKey(FAKE_KEY);

    expect(obtenerApiKey()).toBe(FAKE_KEY);
    expect(tieneApiKey()).toBe(true);

    // Verifica que solo está en sessionStorage
    expect(window.sessionStorage.length).toBe(1);
    expect(window.localStorage.length).toBe(0);
    expect(JSON.stringify(window.localStorage)).not.toContain(FAKE_KEY);
    expect(document.cookie).not.toContain(FAKE_KEY);
    expect(window.location.href).not.toContain(FAKE_KEY);
  });

  it('rechaza keys vacías, cortas o con espacios', () => {
    expect(validarFormatoKey('').valida).toBe(false);
    expect(validarFormatoKey('   ').valida).toBe(false);
    expect(validarFormatoKey('AIzaShort').valida).toBe(false);
    expect(validarFormatoKey('AIzaSyKeyCon Espacio1234567890').valida).toBe(false);
    expect(() => guardarApiKey('corta')).toThrow();
  });

  it('enmascara correctamente la key para no exponerla en texto plano en el DOM', () => {
    const enmascarada = enmascararApiKey(FAKE_KEY);
    expect(enmascarada).toBe('AIza••••••••••••Z987');
    expect(enmascarada).not.toContain('TestKey1234567890abcdef');
  });

  it('elimina inmediatamente la key al llamar a olvidarApiKey()', () => {
    guardarApiKey(FAKE_KEY);
    expect(tieneApiKey()).toBe(true);

    olvidarApiKey();
    expect(obtenerApiKey()).toBeNull();
    expect(tieneApiKey()).toBe(false);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('no realiza ninguna petición de red a dominios externos no autorizados durante el manejo de la key', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    configurarClienteGeminiMock({
      generarContenido: async () => 'CONECTADO',
    });

    guardarApiKey(FAKE_KEY);
    const res = await probarConexionGemini();
    expect(res.ok).toBe(true);

    // Ninguna llamada a dominios de terceros ni telemetría
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('Fase 0 — Pantalla de Onboarding y UI de Seguridad', () => {
  it('muestra el aviso obligatorio de seguridad y bloquea el guardado hasta aceptarlo', () => {
    render(<App />);

    const aviso = screen.getByTestId('security-notice');
    expect(aviso).toBeInTheDocument();
    expect(aviso).toHaveTextContent(/únicamente en esta pestaña/i);
    expect(aviso).toHaveTextContent(/exclusiva para este curso/i);
    expect(aviso).toHaveTextContent(/Computadoras compartidas/i);
    expect(aviso).toHaveTextContent(/No cargues nombres, documentos ni datos reales/i);

    const input = screen.getByTestId('api-key-input');
    const btnGuardar = screen.getByTestId('save-key-btn');

    fireEvent.change(input, { target: { value: FAKE_KEY } });
    // Sigue deshabilitado porque no aceptó el aviso obligatorio
    expect(btnGuardar).toBeDisabled();

    const checkbox = screen.getByTestId('accept-notice-checkbox');
    fireEvent.click(checkbox);
    expect(btnGuardar).not.toBeDisabled();

    fireEvent.click(btnGuardar);

    // La key queda guardada en sessionStorage y enmascarada en pantalla
    expect(obtenerApiKey()).toBe(FAKE_KEY);
    expect(window.localStorage.length).toBe(0);
    expect(screen.getByTestId('masked-key')).toHaveTextContent('AIza••••••••••••Z987');
    expect(document.body.textContent).not.toContain(FAKE_KEY);
  });

  it('permite probar la conexión y olvidar la key desde la UI', async () => {
    configurarClienteGeminiMock({
      generarContenido: async () => 'CONECTADO',
    });

    render(<App />);

    fireEvent.click(screen.getByTestId('accept-notice-checkbox'));
    fireEvent.change(screen.getByTestId('api-key-input'), {
      target: { value: FAKE_KEY },
    });
    fireEvent.click(screen.getByTestId('save-key-btn'));

    const btnProbar = screen.getByRole('button', { name: /probar conexión/i });
    fireEvent.click(btnProbar);

    await waitFor(() => {
      expect(screen.getByTestId('status-message')).toHaveTextContent(/Conexión exitosa/i);
    });

    const btnOlvidar = screen.getByRole('button', { name: /olvidar key ahora/i });
    fireEvent.click(btnOlvidar);

    expect(obtenerApiKey()).toBeNull();
    expect(screen.getByTestId('api-key-input')).toBeInTheDocument();
  });
});

describe('Fase 0 — Wrapper de Gemini, Cuota y Validación Zod con Reintento', () => {
  it('informa con mensaje claro cuando se agota la cuota gratuita (429)', async () => {
    configurarClienteGeminiMock({
      generarContenido: async () => {
        throw new Error('429 RESOURCE_EXHAUSTED: Quota exceeded');
      },
    });

    const res = await probarConexionGemini(FAKE_KEY);
    expect(res.ok).toBe(false);
    expect(res.codigoError).toBe('CUOTA_AGOTADA');
    expect(res.mensaje).toMatch(/límite de uso gratuito/i);
  });

  it('reintenta 1 vez si la respuesta de la IA no cumple el esquema Zod y devuelve el dato válido en el segundo intento', async () => {
    guardarApiKey(FAKE_KEY);
    let llamadas = 0;

    configurarClienteGeminiMock({
      generarContenido: async () => {
        llamadas++;
        if (llamadas === 1) {
          return JSON.stringify({ invalido: true });
        }
        return JSON.stringify({ suficiente: true, preguntas: [] });
      },
    });

    const EsquemaPrueba = z.object({
      suficiente: z.boolean(),
      preguntas: z.array(z.string()),
    });

    const resultado = await consultarGeminiEstructurado({
      prompt: 'Probando esquema',
      schema: EsquemaPrueba,
    });

    expect(llamadas).toBe(2);
    expect(resultado).toEqual({ suficiente: true, preguntas: [] });
  });
});

describe('Fase 0 — Configuración de Cabeceras CSP y Seguridad Estática', () => {
  it('verifica que vercel.json y public/_headers tengan CSP estricta y permitan generativelanguage.googleapis.com', () => {
    const rootDir = path.resolve(__dirname, '..');
    const vercelRaw = fs.readFileSync(path.join(rootDir, 'vercel.json'), 'utf-8');
    const headersRaw = fs.readFileSync(path.join(rootDir, 'public', '_headers'), 'utf-8');

    for (const contenido of [vercelRaw, headersRaw]) {
      expect(contenido).toContain("default-src 'self'");
      expect(contenido).toContain("script-src 'self' 'wasm-unsafe-eval'");
      expect(contenido).not.toContain('unsafe-inline');
      expect(contenido).not.toContain(" 'unsafe-eval'");
      expect(contenido).toContain('https://generativelanguage.googleapis.com');
      expect(contenido).toContain('https://openrouter.ai');
      expect(contenido).toContain("object-src 'none'");
      expect(contenido).toContain("frame-ancestors 'none'");
      expect(contenido).toContain('nosniff');
      expect(contenido).toContain('no-referrer');
    }
  });
});

describe('Soporte Multi-Proveedor LLM (OpenRouter Free Tier, Ollama Local y Robustez JSON)', () => {
  it('valida formatos de API key para OpenRouter, Gemini y Ollama', () => {
    expect(validarFormatoKey('sk-or-v1-abcdef1234567890', 'openrouter').valida).toBe(true);
    expect(validarFormatoKey('corta', 'openrouter').valida).toBe(false);
    expect(validarFormatoKey('sk-or-v1 con espacio', 'openrouter').valida).toBe(false);
    // Ollama es local y no requiere API key
    expect(validarFormatoKey('', 'ollama').valida).toBe(true);
    expect(validarFormatoKey('cualquier-cosa', 'ollama').valida).toBe(true);
  });

  it('establece gemini-3.8-flash como modelo por defecto de Gemini y lo normaliza a gemini-2.0-flash para la API', async () => {
    const { GEMINI_MODEL, obtenerModeloActivo, normalizarModeloGemini } = await import(
      '../src/core/gemini'
    );
    expect(GEMINI_MODEL).toBe('gemini-3.8-flash');
    expect(obtenerModeloActivo()).toBe('gemini-3.8-flash');
    expect(normalizarModeloGemini('gemini-3.8-flash')).toBe('gemini-2.0-flash');
    expect(normalizarModeloGemini('gemini-2.5-flash')).toBe('gemini-2.0-flash');
  });

  it('extraerJsonDeTexto extrae correctamente objetos JSON incluso con texto previo o formato markdown irregular', async () => {
    const { extraerJsonDeTexto } = await import('../src/core/gemini');

    // Con texto antes y después del bloque markdown
    const caso1 = `Aquí está tu respuesta estructurada:\n\`\`\`json\n{"nombre": "mascota", "ok": true}\n\`\`\`\nEspero que te sirva.`;
    expect(extraerJsonDeTexto(caso1)).toEqual({ nombre: 'mascota', ok: true });

    // Sin bloques markdown pero con texto alrededor
    const caso2 = `Nota: {"edad": 5, "activo": false} gracias.`;
    expect(extraerJsonDeTexto(caso2)).toEqual({ edad: 5, activo: false });

    // Con comas finales (trailing commas)
    const caso3 = `{"item": 1, "lista": [1, 2, ], }`;
    expect(extraerJsonDeTexto(caso3)).toEqual({ item: 1, lista: [1, 2] });
  });
});
