/**
 * Módulo para gestionar la API key y el proveedor activo de LLM (Gemini u OpenRouter).
 *
 * REGLA DE SEGURIDAD (Sección 3.1 del Plan):
 * - La key se guarda EXCLUSIVAMENTE en `sessionStorage` (se borra al cerrar la pestaña).
 * - PROHIBIDO usar `localStorage`, `IndexedDB`, cookies, parámetros de URL o logs.
 * - La key jamás debe incluirse en ningún archivo exportable.
 */

export type ProveedorLLM = 'gemini' | 'openrouter' | 'ollama';

const SESSION_KEY_NAME = 'db_tutor_gemini_api_key';
const SESSION_PROVIDER_NAME = 'db_tutor_llm_provider';

/**
 * Obtiene el proveedor de LLM activo en la sesión ('gemini' por defecto, 'openrouter' u 'ollama').
 */
export function obtenerProveedorActivo(): ProveedorLLM {
  if (typeof window === 'undefined' || !window.sessionStorage) return 'gemini';
  const guardado = window.sessionStorage.getItem(SESSION_PROVIDER_NAME);
  if (guardado === 'openrouter' || guardado === 'ollama') return guardado;
  return 'gemini';
}

/**
 * Establece el proveedor de LLM activo en la sesión.
 */
export function establecerProveedorActivo(proveedor: ProveedorLLM): void {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    window.sessionStorage.setItem(SESSION_PROVIDER_NAME, proveedor);
  }
}

/**
 * Valida que la cadena ingresada tenga un formato plausible de API key según el proveedor.
 */
export function validarFormatoKey(
  rawKey: string,
  proveedor?: ProveedorLLM
): { valida: boolean; mensaje?: string } {
  const prov = proveedor ?? obtenerProveedorActivo();
  if (prov === 'ollama') {
    // Ollama corre localmente y no requiere credenciales de API
    return { valida: true };
  }
  const limpia = rawKey.trim();
  if (!limpia) {
    return { valida: false, mensaje: 'Ingresá una API key para continuar.' };
  }
  if (/\s/.test(limpia)) {
    return { valida: false, mensaje: 'La API key no debe contener espacios.' };
  }
  if (prov === 'openrouter') {
    if (limpia.length < 15) {
      return {
        valida: false,
        mensaje:
          'La API key de OpenRouter parece demasiado corta. Las claves de OpenRouter habitualmente comienzan con "sk-or-v1-".',
      };
    }
  } else {
    if (limpia.length < 20) {
      return {
        valida: false,
        mensaje:
          'La API key parece demasiado corta. Verificá que la hayas copiado completa desde Google AI Studio.',
      };
    }
  }
  return { valida: true };
}

/**
 * Guarda la API key únicamente en `sessionStorage` y opcionalmente actualiza el proveedor.
 */
export function guardarApiKey(rawKey: string, proveedor?: ProveedorLLM): void {
  const prov = proveedor ?? obtenerProveedorActivo();
  const validacion = validarFormatoKey(rawKey, prov);
  if (!validacion.valida) {
    throw new Error(validacion.mensaje ?? 'API key inválida');
  }
  const limpia = rawKey.trim() || (prov === 'ollama' ? 'ollama-local' : '');
  window.sessionStorage.setItem(SESSION_KEY_NAME, limpia);
  if (proveedor) {
    establecerProveedorActivo(proveedor);
  }
}

/**
 * Obtiene la API key actual desde `sessionStorage`, o `null` si no existe.
 */
export function obtenerApiKey(): string | null {
  if (typeof window === 'undefined' || !window.sessionStorage) return null;
  return window.sessionStorage.getItem(SESSION_KEY_NAME);
}

/**
 * Verifica si hay una API key activa en la sesión actual (o si Ollama está seleccionado).
 */
export function tieneApiKey(): boolean {
  if (obtenerProveedorActivo() === 'ollama') return true;
  const key = obtenerApiKey();
  return typeof key === 'string' && key.trim().length >= 15;
}

/**
 * Elimina inmediatamente la API key de `sessionStorage` ("Olvidar key ahora").
 */
export function olvidarApiKey(): void {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    window.sessionStorage.removeItem(SESSION_KEY_NAME);
    window.sessionStorage.removeItem(SESSION_PROVIDER_NAME);
  }
}

/**
 * Enmascara una API key para mostrarla de forma segura en la interfaz
 * (ej. "AIza••••••••••••••••7x9Q", "sk-o••••••••••••••••3aB2" o "Ollama Local (Sin Key)").
 */
export function enmascararApiKey(key: string | null): string {
  if (!key) return '';
  const limpia = key.trim();
  if (limpia === 'ollama-local' || limpia === 'ollama') {
    return 'Ollama Local (11434)';
  }
  if (limpia.length <= 8) {
    return '••••••••';
  }
  const inicio = limpia.slice(0, 4);
  const fin = limpia.slice(-4);
  return `${inicio}${'•'.repeat(12)}${fin}`;
}
