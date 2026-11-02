import { openDB, IDBPDatabase } from 'idb';
import {
  crearProyectoInicial,
  Decision,
  DecisionSchema,
  ProyectoEstado,
  ProyectoEstadoSchema,
} from './schemas';

const DB_NAME = 'db_tutor_storage';
const DB_VERSION = 1;
const STORE_PROYECTOS = 'proyectos';
const PROYECTO_ACTUAL_KEY = 'proyecto_actual';

/**
 * Límite máximo de tamaño para importar un archivo de proyecto JSON (512 KB).
 * Previene ataques de denegación de servicio en el navegador (Sección 3.4).
 */
export const MAX_IMPORT_BYTES = 512 * 1024;

let dbPromise: Promise<IDBPDatabase> | null = null;

function obtenerBaseDatos(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_PROYECTOS)) {
          db.createObjectStore(STORE_PROYECTOS);
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Permite reiniciar la referencia de conexión en tests cuando se reinicia fake-indexeddb.
 */
export function resetearConexionStorageParaTests(): void {
  dbPromise = null;
}

/**
 * Guarda el estado del proyecto en IndexedDB validando previamente con Zod
 * para garantizar que nunca se filtren campos ajenos al esquema (como una API key).
 */
export async function guardarProyectoEnIndexedDB(
  proyecto: ProyectoEstado
): Promise<ProyectoEstado> {
  const validado = ProyectoEstadoSchema.parse({
    ...proyecto,
    actualizadoEn: new Date().toISOString(),
  });

  const db = await obtenerBaseDatos();
  await db.put(STORE_PROYECTOS, validado, PROYECTO_ACTUAL_KEY);
  return validado;
}

/**
 * Carga el proyecto actual desde IndexedDB. Si no existe o no es válido, devuelve un proyecto inicial limpio.
 */
export async function cargarProyectoDesdeIndexedDB(): Promise<ProyectoEstado> {
  try {
    const db = await obtenerBaseDatos();
    const guardado = await db.get(STORE_PROYECTOS, PROYECTO_ACTUAL_KEY);
    if (!guardado) {
      return crearProyectoInicial();
    }
    const resultado = ProyectoEstadoSchema.safeParse(guardado);
    return resultado.success ? resultado.data : crearProyectoInicial();
  } catch {
    return crearProyectoInicial();
  }
}

/**
 * Limpia el proyecto actual en IndexedDB y devuelve un estado nuevo desde cero.
 */
export async function reiniciarProyectoEnIndexedDB(): Promise<ProyectoEstado> {
  const inicial = crearProyectoInicial();
  try {
    const db = await obtenerBaseDatos();
    await db.put(STORE_PROYECTOS, inicial, PROYECTO_ACTUAL_KEY);
  } catch {
    // Ignorar si el navegador bloquea IndexedDB en modo privado estricto
  }
  return inicial;
}

/**
 * Crea un nuevo registro de decisión validado con Zod para agregar a la bitácora pedagógica.
 */
export function crearRegistroDecision(params: {
  paso: number;
  descripcion: string;
  origen: Decision['origen'];
  fecha?: string;
}): Decision {
  return DecisionSchema.parse({
    paso: params.paso,
    fecha: params.fecha ?? new Date().toISOString(),
    descripcion: params.descripcion.trim(),
    origen: params.origen,
  });
}

/**
 * Serializa el proyecto a JSON listo para exportar, garantizando con Zod que
 * solo contenga los campos del proyecto y jamás incluya la API key.
 */
export function exportarProyectoAJson(proyecto: ProyectoEstado): string {
  const limpio = ProyectoEstadoSchema.parse(proyecto);
  return JSON.stringify(limpio, null, 2);
}

/**
 * Importa un proyecto desde un string JSON aplicando las reglas de seguridad de la Sección 3.4:
 * - Verifica límite de tamaño (máx. 512 KB).
 * - Parsea JSON sin evaluar código.
 * - Valida estrictamente con Zod (`ProyectoEstadoSchema`), que ignora/elimina cualquier campo desconocido.
 */
export function importarProyectoDesdeJson(contenidoRaw: string): ProyectoEstado {
  const bytes = new TextEncoder().encode(contenidoRaw).length;
  if (bytes > MAX_IMPORT_BYTES) {
    throw new Error(
      `El archivo supera el tamaño máximo permitido (${Math.round(MAX_IMPORT_BYTES / 1024)} KB).`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contenidoRaw);
  } catch {
    throw new Error('El archivo seleccionado no contiene un formato JSON válido.');
  }

  const validacion = ProyectoEstadoSchema.safeParse(parsed);
  if (!validacion.success) {
    const detalle = validacion.error.issues
      .map((i) => `${i.path.join('.') || 'raíz'}: ${i.message}`)
      .join('; ');
    throw new Error(`El proyecto importado no cumple el esquema esperado (${detalle}).`);
  }

  return validacion.data;
}
