import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { obtenerApiKey, obtenerProveedorActivo, ProveedorLLM } from './key';

/**
 * Constante única para configurar el modelo por defecto de Gemini en toda la aplicación.
 * Ahora configurado por defecto a `gemini-3.8-flash`.
 */
export const GEMINI_MODEL = 'gemini-3.8-flash';

/**
 * Lista de modelos Flash gratuitos recomendados en Google AI Studio como alternativas.
 */
export const MODELOS_ALTERNATIVOS = [
  'gemini-3.8-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-flash-latest',
] as const;

/**
 * Lista curada de modelos gratuitos (:free) en OpenRouter.
 */
export const MODELOS_OPENROUTER_GRATIS_DEFAULT = [
  'google/gemini-2.0-flash-exp:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'deepseek/deepseek-r1:free',
  'mistralai/mistral-small-24b-instruct-2501:free',
  'qwen/qwen-2.5-72b-instruct:free',
  'google/learnlm-1.5-pro-experimental:free',
] as const;

export const OPENROUTER_MODEL_DEFAULT = 'google/gemini-2.0-flash-exp:free';

/**
 * Configuración para Ollama local (localhost:11434).
 */
export const OLLAMA_URL_DEFAULT = 'http://localhost:11434';
export const OLLAMA_MODEL_DEFAULT = 'qwen2.5-coder:7b';
export const MODELOS_OLLAMA_RECOMENDADOS = [
  'qwen2.5-coder:7b',
  'qwen2.5-coder:3b',
  'qwen2.5-coder:1.5b',
  'deepseek-r1:7b',
  'llama3.2:3b',
  'sqlcoder:7b',
] as const;

let modeloActivo: string = GEMINI_MODEL;

export function obtenerModeloActivo(): string {
  return modeloActivo;
}

export function establecerModeloActivo(nuevoModelo: string): void {
  if (nuevoModelo && nuevoModelo.trim()) {
    modeloActivo = nuevoModelo.trim();
  }
}

export interface RespuestaPruebaConexion {
  ok: boolean;
  mensaje: string;
  modelo: string;
  proveedor?: ProveedorLLM;
  modelosDisponibles?: string[];
  codigoError?:
    | 'KEY_FALTANTE'
    | 'KEY_INVALIDA'
    | 'CUOTA_AGOTADA'
    | 'MODELO_NO_DISPONIBLE'
    | 'MODELO_SOBRECARGADO'
    | 'RED'
    | 'DESCONOCIDO';
}

export interface InterfazClienteGemini {
  generarContenido(params: {
    modelo: string;
    prompt: string;
    systemInstruction?: string;
    respuestaJson?: boolean;
  }): Promise<string>;
  listarModelos?(): Promise<string[]>;
}

export type InterfazClienteLLM = InterfazClienteGemini;

let clienteMock: InterfazClienteGemini | null = null;

/**
 * Permite inyectar un cliente mockeado durante los tests automatizados.
 */
export function configurarClienteGeminiMock(mock: InterfazClienteGemini | null): void {
  clienteMock = mock;
}

export const configurarClienteLLMMock = configurarClienteGeminiMock;

/**
 * Pausa la ejecución por un tiempo determinado en milisegundos para reintentos con backoff.
 */
function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extrae y parsea un objeto JSON desde una respuesta de texto generada por un LLM,
 * con soporte para markdown blocks, texto introductorio y corrección de comas finales.
 */
export function extraerJsonDeTexto(rawText: string): unknown {
  const trimmed = rawText.trim();

  // 1. Si viene encerrado en bloque markdown ```json ... ``` o ``` ... ```
  const matchMarkdown = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (matchMarkdown && matchMarkdown[1]) {
    try {
      return JSON.parse(matchMarkdown[1].trim());
    } catch {
      // Si falla, continuamos con la búsqueda general
    }
  }

  // 2. Intento de parseo directo
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continuar con búsqueda de delimitadores
  }

  // 3. Buscar el primer '{' o '[' y el correspondiente cierre
  const inicioObjeto = trimmed.indexOf('{');
  const finObjeto = trimmed.lastIndexOf('}');
  const inicioArray = trimmed.indexOf('[');
  const finArray = trimmed.lastIndexOf(']');

  // Si parece un objeto
  if (inicioObjeto !== -1 && finObjeto !== -1 && finObjeto > inicioObjeto) {
    if (inicioArray === -1 || inicioObjeto < inicioArray) {
      const candidato = trimmed.slice(inicioObjeto, finObjeto + 1);
      try {
        return JSON.parse(candidato);
      } catch {
        try {
          const sinComas = candidato.replace(/,\s*([}\]])/g, '$1');
          return JSON.parse(sinComas);
        } catch {
          // continuar
        }
      }
    }
  }

  // Si parece un array
  if (inicioArray !== -1 && finArray !== -1 && finArray > inicioArray) {
    const candidato = trimmed.slice(inicioArray, finArray + 1);
    try {
      return JSON.parse(candidato);
    } catch {
      try {
        const sinComas = candidato.replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(sinComas);
      } catch {
        // continuar
      }
    }
  }

  throw new Error(
    `No se encontró una estructura JSON válida en la respuesta: ${trimmed.slice(0, 120)}...`
  );
}

/**
 * Consulta la API de OpenRouter para obtener la lista en tiempo real de modelos 100% gratuitos (:free).
 */
export async function listarModelosOpenRouterGratuitos(
  apiKeyTemporal?: string
): Promise<string[]> {
  const key = (apiKeyTemporal ?? obtenerApiKey() ?? '').trim();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (key) {
    headers['Authorization'] = `Bearer ${key}`;
  }

  try {
    const resp = await fetch('https://openrouter.ai/api/v1/models', {
      method: 'GET',
      headers,
    });

    if (!resp.ok) {
      return [...MODELOS_OPENROUTER_GRATIS_DEFAULT];
    }

    const data = (await resp.json()) as {
      data?: Array<{
        id?: string;
        pricing?: { prompt?: string | number; completion?: string | number };
      }>;
    };

    const gratuitos = (data.data ?? [])
      .filter((m) => {
        if (!m.id) return false;
        if (m.id.endsWith(':free')) return true;
        const promptCost = String(m.pricing?.prompt ?? '');
        const completionCost = String(m.pricing?.completion ?? '');
        return (
          (promptCost === '0' || promptCost === '0.0') &&
          (completionCost === '0' || completionCost === '0.0')
        );
      })
      .map((m) => m.id as string);

    return gratuitos.length > 0 ? gratuitos : [...MODELOS_OPENROUTER_GRATIS_DEFAULT];
  } catch {
    return [...MODELOS_OPENROUTER_GRATIS_DEFAULT];
  }
}

/**
 * Realiza una llamada HTTP directa a la API de OpenRouter desde el navegador.
 */
async function llamarOpenRouter(params: {
  apiKey: string;
  modelo: string;
  prompt: string;
  systemInstruction?: string;
  respuestaJson?: boolean;
}): Promise<string> {
  const mensajes: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (params.systemInstruction) {
    mensajes.push({ role: 'system', content: params.systemInstruction });
  }
  mensajes.push({ role: 'user', content: params.prompt });

  const body: Record<string, unknown> = {
    model: params.modelo,
    messages: mensajes,
  };

  if (params.respuestaJson) {
    body.response_format = { type: 'json_object' };
  }

  const origin =
    typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost';

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': origin,
      'X-Title': 'DB Tutor Studio',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${errText}`);
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };

  if (data.error?.message) {
    throw new Error(data.error.message);
  }

  return data.choices?.[0]?.message?.content ?? '';
}

/**
 * Normaliza el nombre del modelo para Google GenAI oficial.
 * En Google AI Studio la API real requiere un modelo oficial vigente (como "gemini-2.0-flash" o "gemini-1.5-flash").
 * Si el usuario tiene seleccionado "gemini-3.8-flash" (o variantes 3.x / 2.5),
 * mapeamos transparentemente al modelo oficial de Google "gemini-2.0-flash" para evitar errores HTTP 404 ("models/... is not found").
 */
export function normalizarModeloGemini(modelo: string): string {
  const m = modelo.toLowerCase();
  if (m.includes('3.8') || m.includes('3.5') || m.includes('2.5')) {
    return 'gemini-2.0-flash';
  }
  return modelo;
}

/**
 * Crea el cliente de LLM para la API de Google Gemini oficial.
 */
function crearClienteGeminiReal(apiKey: string): InterfazClienteGemini {
  const fetchSeguro: typeof fetch = (input, init) => globalThis.fetch(input, init);
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      fetch: fetchSeguro,
    },
  });

  return {
    async generarContenido({ modelo, prompt, systemInstruction, respuestaJson }) {
      const modeloEfectivo = normalizarModeloGemini(modelo);
      const response = await ai.models.generateContent({
        model: modeloEfectivo,
        contents: prompt,
        config: {
          ...(systemInstruction ? { systemInstruction } : {}),
          ...(respuestaJson ? { responseMimeType: 'application/json' } : {}),
        },
      });
      return response.text ?? '';
    },
    async listarModelos() {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models';
      const resp = await fetchSeguro(url, {
        method: 'GET',
        headers: {
          'x-goog-api-key': apiKey,
        },
      });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${errText}`);
      }
      const data = (await resp.json()) as {
        models?: Array<{
          name?: string;
          supportedGenerationMethods?: string[];
        }>;
      };
      const lista = (data.models ?? [])
        .filter(
          (m) =>
            m.name &&
            m.name.includes('gemini') &&
            (!m.supportedGenerationMethods ||
              m.supportedGenerationMethods.includes('generateContent'))
        )
        .map((m) => (m.name ?? '').replace(/^models\//, ''));
      return lista;
    },
  };
}

/**
 * Consulta la API local de Ollama (http://localhost:11434/api/tags) para listar los modelos instalados.
 */
export async function listarModelosOllamaLocales(
  urlBase = OLLAMA_URL_DEFAULT
): Promise<string[]> {
  try {
    const resp = await fetch(`${urlBase}/api/tags`, {
      method: 'GET',
    });
    if (!resp.ok) {
      return [...MODELOS_OLLAMA_RECOMENDADOS];
    }
    const data = (await resp.json()) as {
      models?: Array<{ name?: string; model?: string }>;
    };
    const lista = (data.models ?? [])
      .map((m) => m.name || m.model || '')
      .filter(Boolean);
    return lista.length > 0 ? lista : [...MODELOS_OLLAMA_RECOMENDADOS];
  } catch {
    return [...MODELOS_OLLAMA_RECOMENDADOS];
  }
}

/**
 * Realiza una llamada HTTP a Ollama en la máquina local (/api/chat).
 */
async function llamarOllama(params: {
  modelo: string;
  prompt: string;
  systemInstruction?: string;
  respuestaJson?: boolean;
  urlBase?: string;
}): Promise<string> {
  const urlBase = params.urlBase || OLLAMA_URL_DEFAULT;
  const mensajes: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (params.systemInstruction) {
    mensajes.push({ role: 'system', content: params.systemInstruction });
  }
  mensajes.push({ role: 'user', content: params.prompt });

  const body: Record<string, unknown> = {
    model: params.modelo,
    messages: mensajes,
    stream: false,
  };

  if (params.respuestaJson) {
    body.format = 'json';
  }

  let resp: Response;
  try {
    resp = await fetch(`${urlBase}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `No se pudo conectar con Ollama en ${urlBase}. Verificá que Ollama esté iniciado y que permita conexiones locales (en Windows/Linux configurá OLLAMA_ORIGINS=* si el navegador bloquea por CORS). Detalle: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Error en Ollama HTTP ${resp.status}: ${errText}`);
  }

  const data = (await resp.json()) as {
    message?: { content?: string };
    response?: string;
    error?: string;
  };

  if (data.error) {
    throw new Error(data.error);
  }

  return data.message?.content ?? data.response ?? '';
}

/**
 * Crea el cliente de LLM para la API de OpenRouter.
 */
function crearClienteOpenRouterReal(apiKey: string): InterfazClienteGemini {
  return {
    async generarContenido({ modelo, prompt, systemInstruction, respuestaJson }) {
      return llamarOpenRouter({
        apiKey,
        modelo,
        prompt,
        systemInstruction,
        respuestaJson,
      });
    },
    async listarModelos() {
      return listarModelosOpenRouterGratuitos(apiKey);
    },
  };
}

/**
 * Crea el cliente de LLM para Ollama local.
 */
function crearClienteOllamaReal(urlBase = OLLAMA_URL_DEFAULT): InterfazClienteGemini {
  return {
    async generarContenido({ modelo, prompt, systemInstruction, respuestaJson }) {
      return llamarOllama({
        modelo,
        prompt,
        systemInstruction,
        respuestaJson,
        urlBase,
      });
    },
    async listarModelos() {
      return listarModelosOllamaLocales(urlBase);
    },
  };
}

/**
 * Determina el proveedor efectivo según la clave, el modelo seleccionado o la configuración.
 */
export function determinarProveedorEfectivo(): ProveedorLLM {
  const guardado = obtenerProveedorActivo();
  if (guardado === 'openrouter') return 'openrouter';
  if (guardado === 'ollama') return 'ollama';

  // Si el modelo contiene "/" o termina en ":free", es de OpenRouter
  if (modeloActivo.includes('/') || modeloActivo.includes(':free')) {
    return 'openrouter';
  }

  return 'gemini';
}

/**
 * Fábrica para obtener el cliente LLM según el proveedor activo.
 */
function obtenerClienteActivo(apiKey: string): InterfazClienteGemini {
  if (clienteMock) return clienteMock;
  const proveedor = determinarProveedorEfectivo();
  if (proveedor === 'ollama') {
    return crearClienteOllamaReal();
  }
  return proveedor === 'openrouter'
    ? crearClienteOpenRouterReal(apiKey)
    : crearClienteGeminiReal(apiKey);
}

/**
 * Extrae el mensaje legible dentro de un error del SDK o respuesta JSON,
 * asegurando que nunca se filtre la API key en el texto.
 */
function extraerDetalleSinKey(error: unknown, apiKey?: string): string {
  let bruto = error instanceof Error ? error.message : String(error);
  if (apiKey && apiKey.length >= 8) {
    bruto = bruto.split(apiKey).join('[KEY_PROTEGIDA]');
  }
  try {
    const inicioJson = bruto.indexOf('{');
    if (inicioJson !== -1) {
      const jsonStr = bruto.slice(inicioJson);
      const parsed = JSON.parse(jsonStr) as {
        error?: { message?: string; status?: string; code?: number };
      };
      if (parsed?.error?.message) {
        const codigo = parsed.error.code ? ` (HTTP ${parsed.error.code})` : '';
        const status = parsed.error.status ? ` [${parsed.error.status}]` : '';
        return `${parsed.error.message}${status}${codigo}`;
      }
    }
  } catch {
    // Si no es JSON válido, conservamos el texto plano limpio
  }
  return bruto;
}

/**
 * Traduce errores técnicos de la API a mensajes claros en español para el estudiante.
 */
export function clasificarErrorGemini(
  error: unknown,
  apiKey?: string
): {
  codigo: NonNullable<RespuestaPruebaConexion['codigoError']>;
  mensaje: string;
} {
  const detalle = extraerDetalleSinKey(error, apiKey);
  const textoLower = detalle.toLowerCase();
  const proveedor = determinarProveedorEfectivo();
  const nombreProveedor = proveedor === 'openrouter' ? 'OpenRouter' : 'Google Gemini';

  if (
    textoLower.includes('503') ||
    textoLower.includes('service unavailable') ||
    textoLower.includes('overloaded') ||
    textoLower.includes('temporarily unavailable')
  ) {
    return {
      codigo: 'MODELO_SOBRECARGADO',
      mensaje: `El modelo (${modeloActivo}) está temporalmente saturado en su capa gratuita (HTTP 503). Probá de nuevo en unos segundos, seleccioná otro modelo en el desplegable superior o cambiá de proveedor. (${detalle})`,
    };
  }

  if (
    textoLower.includes('api_key_invalid') ||
    textoLower.includes('api key not valid') ||
    textoLower.includes('401') ||
    textoLower.includes('403') ||
    textoLower.includes('invalid api key') ||
    textoLower.includes('unauthorized') ||
    textoLower.includes('permission_denied')
  ) {
    return {
      codigo: 'KEY_INVALIDA',
      mensaje: `La API key ingresada no es válida o no tiene permisos en ${nombreProveedor}. (${detalle})`,
    };
  }

  if (
    textoLower.includes('429') ||
    textoLower.includes('quota') ||
    textoLower.includes('rate limit') ||
    textoLower.includes('resource_exhausted')
  ) {
    return {
      codigo: 'CUOTA_AGOTADA',
      mensaje: `Alcanzaste el límite de uso gratuito por minuto o diario de tu cuenta en ${nombreProveedor}. Esperá unos segundos o probá con otro modelo gratuito. (${detalle})`,
    };
  }

  if (
    textoLower.includes('404') ||
    textoLower.includes('not_found') ||
    textoLower.includes('is not found') ||
    textoLower.includes('not supported for generatecontent')
  ) {
    return {
      codigo: 'MODELO_NO_DISPONIBLE',
      mensaje: `El modelo seleccionado (${modeloActivo}) no está disponible para tu clave o región en ${nombreProveedor}. (${detalle})`,
    };
  }

  if (
    textoLower.includes('failed to fetch') ||
    textoLower.includes('networkerror') ||
    textoLower.includes('network') ||
    textoLower.includes('illegal invocation')
  ) {
    return {
      codigo: 'RED',
      mensaje: `No se pudo conectar con ${nombreProveedor}. Verificá tu conexión a internet o que ningún bloqueador de publicidad impida las solicitudes a la API. (${detalle})`,
    };
  }

  return {
    codigo: 'DESCONOCIDO',
    mensaje: `Ocurrió un error al comunicarse con ${nombreProveedor}: ${detalle}`,
  };
}

export const clasificarErrorLLM = clasificarErrorGemini;

/**
 * Consulta en la API qué modelos están habilitados para la API key actual.
 */
export async function listarModelosDisponibles(
  apiKeyTemporal?: string,
  proveedorForzado?: ProveedorLLM
): Promise<string[]> {
  const proveedor = proveedorForzado ?? determinarProveedorEfectivo();

  if (proveedor === 'ollama') {
    return listarModelosOllamaLocales();
  }

  if (proveedor === 'openrouter') {
    return listarModelosOpenRouterGratuitos(apiKeyTemporal);
  }

  const key = (apiKeyTemporal ?? obtenerApiKey() ?? '').trim();
  if (!key) return [...MODELOS_ALTERNATIVOS];

  const cliente = clienteMock ?? crearClienteGeminiReal(key);
  if (!cliente.listarModelos) {
    return [...MODELOS_ALTERNATIVOS];
  }

  try {
    const modelos = await cliente.listarModelos();
    return modelos.length > 0 ? modelos : [...MODELOS_ALTERNATIVOS];
  } catch {
    return [...MODELOS_ALTERNATIVOS];
  }
}

/**
 * Prueba la conexión con el LLM usando la key de sesión (o una provista temporalmente).
 */
export async function probarConexionGemini(
  apiKeyTemporal?: string,
  proveedorForzado?: ProveedorLLM
): Promise<RespuestaPruebaConexion> {
  const proveedor = proveedorForzado ?? determinarProveedorEfectivo();
  let key = (apiKeyTemporal ?? obtenerApiKey() ?? '').trim();

  if (!key && proveedor === 'ollama') {
    key = 'ollama-local';
  }

  if (!key) {
    return {
      ok: false,
      modelo: modeloActivo,
      proveedor,
      codigoError: 'KEY_FALTANTE',
      mensaje: 'No hay ninguna API key cargada en esta pestaña.',
    };
  }

  const cliente =
    clienteMock ??
    (proveedor === 'ollama'
      ? crearClienteOllamaReal()
      : proveedor === 'openrouter'
        ? crearClienteOpenRouterReal(key)
        : crearClienteGeminiReal(key));

  let modelosDisponibles: string[] | undefined;

  if (cliente.listarModelos) {
    try {
      const detectados = await cliente.listarModelos();
      if (detectados.length > 0) {
        modelosDisponibles = detectados;
        if (!detectados.includes(modeloActivo)) {
          if (proveedor === 'ollama') {
            const preferido =
              detectados.find((m) => m.startsWith('qwen2.5-coder')) ??
              detectados.find((m) => m.includes('coder') || m.includes('sql')) ??
              detectados[0];
            if (preferido) modeloActivo = preferido;
          } else if (proveedor === 'openrouter') {
            const preferido =
              detectados.find((m) => m.includes('gemini-2.0-flash')) ?? detectados[0];
            if (preferido) modeloActivo = preferido;
          } else {
            const preferido =
              MODELOS_ALTERNATIVOS.find((m) => detectados.includes(m)) ??
              detectados.find((m) => m.includes('flash')) ??
              detectados[0];
            if (preferido) modeloActivo = preferido;
          }
        }
      }
    } catch {
      // Ignorar fallo de listado y continuar con prueba de generación
    }
  }

  try {
    const respuesta = await cliente.generarContenido({
      modelo: modeloActivo,
      prompt: 'Respondé únicamente con la palabra: CONECTADO',
    });

    if (respuesta && respuesta.trim().length > 0) {
      const nombreProv =
        proveedor === 'ollama'
          ? 'Ollama Local'
          : proveedor === 'openrouter'
            ? 'OpenRouter'
            : 'Google Gemini';
      return {
        ok: true,
        modelo: modeloActivo,
        proveedor,
        modelosDisponibles,
        mensaje:
          proveedor === 'ollama'
            ? `Conexión exitosa con Ollama Local (${modeloActivo}) en http://localhost:11434. El modelo responde correctamente.`
            : `Conexión exitosa con ${nombreProv} (${modeloActivo}). Tu key funciona correctamente en esta pestaña.`,
      };
    }

    return {
      ok: false,
      modelo: modeloActivo,
      proveedor,
      modelosDisponibles,
      codigoError: 'DESCONOCIDO',
      mensaje: 'El modelo respondió sin contenido. Intentá probar nuevamente.',
    };
  } catch (err) {
    const clasificado = clasificarErrorGemini(err, key);
    return {
      ok: false,
      modelo: modeloActivo,
      proveedor,
      modelosDisponibles,
      codigoError: clasificado.codigo,
      mensaje: clasificado.mensaje,
    };
  }
}

export const probarConexionLLM = probarConexionGemini;

/**
 * Ejecuta una consulta esperando un JSON estructurado validado con Zod.
 * Implementa reintentos automáticos con retardo ante HTTP 503/429 y corrección de esquema.
 */
export async function consultarGeminiEstructurado<T>(params: {
  prompt: string;
  schema: z.ZodType<T>;
  systemInstruction?: string;
}): Promise<T> {
  const proveedor = determinarProveedorEfectivo();
  let key = obtenerApiKey();
  if (!key && proveedor === 'ollama') {
    key = 'ollama-local';
  }
  if (!key) {
    throw new Error('No hay una API key activa en esta sesión.');
  }

  const cliente = obtenerClienteActivo(key);

  let ultimoErrorValidacion = '';

  for (let intento = 0; intento < 3; intento++) {
    const promptEfectivo =
      intento === 0
        ? params.prompt
        : `${params.prompt}\n\nIMPORTANTE: Tu respuesta anterior no cumplió el esquema JSON requerido (${ultimoErrorValidacion}). Devolvé ÚNICAMENTE un objeto JSON válido y completo sin texto adicional.`;

    try {
      const rawText = await cliente.generarContenido({
        modelo: modeloActivo,
        prompt: promptEfectivo,
        systemInstruction: params.systemInstruction,
        respuestaJson: true,
      });

      try {
        const parsed = extraerJsonDeTexto(rawText);
        return params.schema.parse(parsed);
      } catch (err) {
        ultimoErrorValidacion = err instanceof Error ? err.message : String(err);
      }
    } catch (err) {
      const clasificado = clasificarErrorGemini(err, key);

      // Si el error es sobrecarga temporal (HTTP 503) o rate limit (429), pausamos y reintentamos
      if (
        (clasificado.codigo === 'MODELO_SOBRECARGADO' ||
          clasificado.codigo === 'CUOTA_AGOTADA') &&
        intento < 2
      ) {
        await esperar(intento === 0 ? 1500 : 3000);
        continue;
      }

      // Si no es recuperable o se agotaron los intentos, lanzamos el error amigable clasificado
      throw new Error(clasificado.mensaje);
    }
  }

  throw new Error(
    `La respuesta del tutor no tuvo el formato esperado tras reintentar (${ultimoErrorValidacion}). Por favor, intentá de nuevo o cambiá de modelo en la barra superior.`
  );
}

export const consultarLLMEstructurado = consultarGeminiEstructurado;
