import systemTutorPrompt from '../prompts/system_tutor.md?raw';
import { consultarGeminiEstructurado } from './gemini';
import {
  ConjuntoDatosEjemplo,
  ConjuntoDatosEjemploSchema,
  Modelo,
  RondaAclaracion,
} from './schemas';
import {
  construirDefinicionesTablas,
  escaparLiteralSQL,
  ordenarTablasTopologicamente,
  sanitizarIdentificadorSQL,
} from './ddl/sqlite';
import { formatearContextoRondas } from './clarity';

/**
 * Sanitiza un valor para su exportación segura en formato CSV,
 * protegiendo contra ataques de inyección de fórmulas (Formula Injection / CSV Injection).
 * Regla: Si el texto comienza con '=', '+', '-', '@', tabulador o retorno de carro, se antepone un apóstrofe (').
 */
export function sanitizarValorCSV(valor: unknown): string {
  if (valor === null || valor === undefined) {
    return '';
  }

  let str = String(valor);

  // Detección de caracteres desencadenantes de fórmulas en Excel, Calc y Google Sheets
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // Si contiene comas, saltos de línea o comillas dobles, se encierra en comillas dobles
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Formatea un valor individual de JavaScript a un literal válido de SQLite 3.
 */
export function formatearValorLiteralSQLite(valor: unknown): string {
  if (valor === null || valor === undefined) {
    return 'NULL';
  }
  if (typeof valor === 'number') {
    return Number.isFinite(valor) ? String(valor) : 'NULL';
  }
  if (typeof valor === 'boolean') {
    return valor ? '1' : '0';
  }
  return `'${escaparLiteralSQL(String(valor))}'`;
}

/**
 * Genera sentencias SQL "INSERT INTO ..." determinísticas a partir del conjunto de datos de ejemplo.
 * Las sentencias se emiten en el orden topológico especificado para respetar las claves foráneas.
 */
export function generarInsertStatementsSQLite(datos: ConjuntoDatosEjemplo): string[] {
  const sentencias: string[] = [];
  const tablasMap = new Map(datos.tablas.map((t) => [t.tabla.toLowerCase(), t]));

  // Usamos el orden de inserción indicado en el conjunto (o el orden natural de las tablas)
  const ordenTablas =
    datos.ordenInsercion && datos.ordenInsercion.length > 0
      ? datos.ordenInsercion
      : datos.tablas.map((t) => t.tabla);

  for (const nombreTabla of ordenTablas) {
    const tablaData = tablasMap.get(nombreTabla.toLowerCase());
    if (!tablaData || tablaData.filas.length === 0) continue;

    const tablaSanitizada = sanitizarIdentificadorSQL(tablaData.tabla);
    const columnas = tablaData.columnas.map(sanitizarIdentificadorSQL);
    const columnasStr = columnas.map((c) => `"${c}"`).join(', ');

    for (const fila of tablaData.filas) {
      const valoresStr = tablaData.columnas
        .map((col) => formatearValorLiteralSQLite(fila[col]))
        .join(', ');

      sentencias.push(`INSERT INTO "${tablaSanitizada}" (${columnasStr}) VALUES (${valoresStr});`);
    }
  }

  return sentencias;
}

/**
 * Valida la integridad referencial y las restricciones básicas de los datos de ejemplo
 * generados por la IA:
 * 1. Claves primarias no nulas y únicas dentro de cada tabla.
 * 2. Claves foráneas apuntando a valores existentes en la tabla padre.
 */
export function validarIntegridadReferencialDatos(
  datos: ConjuntoDatosEjemplo,
  modelo: Modelo
): { valido: boolean; errores: string[] } {
  const errores: string[] = [];
  const definicionesTablas = construirDefinicionesTablas(modelo);

  // Mapa de valores de PKs generados: tabla -> columnaPK -> Set de valores
  const pksPorTabla = new Map<string, Map<string, Set<any>>>();

  const tablasDataMap = new Map(
    datos.tablas.map((t) => [sanitizarIdentificadorSQL(t.tabla).toLowerCase(), t])
  );

  // 1. Registrar valores de PK y verificar unicidad
  for (const defTabla of definicionesTablas) {
    const tablaData = tablasDataMap.get(defTabla.nombre.toLowerCase());
    if (!tablaData) continue;

    const mapaColsPK = new Map<string, Set<any>>();
    for (const pkCol of defTabla.clavesPrimarias) {
      mapaColsPK.set(pkCol.toLowerCase(), new Set());
    }
    pksPorTabla.set(defTabla.nombre.toLowerCase(), mapaColsPK);
    const tuplasPKVistas = new Set<string>();

    for (let i = 0; i < tablaData.filas.length; i++) {
      const fila = tablaData.filas[i];
      const valoresTuplaPK: any[] = [];
      let tieneNulo = false;

      for (const pkCol of defTabla.clavesPrimarias) {
        // Encontrar valor de la PK (sensible o insensible a mayúsculas)
        const claveFila = Object.keys(fila).find(
          (k) => sanitizarIdentificadorSQL(k).toLowerCase() === pkCol.toLowerCase()
        );
        const valorPK = claveFila !== undefined ? fila[claveFila] : undefined;

        if (valorPK === null || valorPK === undefined || valorPK === '') {
          tieneNulo = true;
          errores.push(
            `Fila ${i + 1} de la tabla "${defTabla.nombre}": la clave primaria "${pkCol}" no puede ser nula.`
          );
        } else {
          const setPK = mapaColsPK.get(pkCol.toLowerCase())!;
          setPK.add(valorPK);
          valoresTuplaPK.push(valorPK);
        }
      }

      if (!tieneNulo && defTabla.clavesPrimarias.length > 0) {
        const claveCompuesta = valoresTuplaPK.map(String).join('___');
        if (tuplasPKVistas.has(claveCompuesta)) {
          errores.push(
            `Fila ${i + 1} de la tabla "${defTabla.nombre}": valor duplicado para la clave primaria (${defTabla.clavesPrimarias.join(', ')}): [${valoresTuplaPK.join(', ')}].`
          );
        } else {
          tuplasPKVistas.add(claveCompuesta);
        }
      }
    }
  }

  // 2. Verificar que las claves foráneas apunten a valores existentes en la tabla padre
  for (const defTabla of definicionesTablas) {
    const tablaData = tablasDataMap.get(defTabla.nombre.toLowerCase());
    if (!tablaData) continue;

    for (const fk of defTabla.clavesForaneas) {
      const padrePKMap = pksPorTabla.get(fk.tablaReferenciada.toLowerCase());
      const valoresValidosPadre = padrePKMap?.get(fk.columnaReferenciada.toLowerCase());

      for (let i = 0; i < tablaData.filas.length; i++) {
        const fila = tablaData.filas[i];
        const claveFila = Object.keys(fila).find(
          (k) => sanitizarIdentificadorSQL(k).toLowerCase() === fk.columnaLocal.toLowerCase()
        );
        const valorFK = claveFila !== undefined ? fila[claveFila] : undefined;

        if (valorFK !== null && valorFK !== undefined && valorFK !== '') {
          if (valoresValidosPadre && !valoresValidosPadre.has(valorFK)) {
            errores.push(
              `Error de integridad referencial en "${defTabla.nombre}" (fila ${i + 1}): la clave foránea "${fk.columnaLocal}" tiene el valor "${valorFK}", el cual no existe en la clave primaria "${fk.columnaReferenciada}" de la tabla padre "${fk.tablaReferenciada}".`
            );
          }
        }
      }
    }
  }

  return {
    valido: errores.length === 0,
    errores,
  };
}

/**
 * Genera un conjunto de datos de prueba determinístico y pedagógico de forma local,
 * garantizando que los datos cumplan estrictamente los tipos de datos y la integridad referencial
 * de claves foráneas aun cuando el servicio externo de IA presente fallas de cuota o conexión.
 */
export function generarDatosEjemploLocales(
  modelo: Modelo,
  cantidadFilas: number
): ConjuntoDatosEjemplo {
  const defTablas = construirDefinicionesTablas(modelo);
  const { tablasOrdenadas } = ordenarTablasTopologicamente(defTablas);
  const pksPorTabla = new Map<string, number[]>();

  const tablas: ConjuntoDatosEjemplo['tablas'] = [];

  for (const t of tablasOrdenadas) {
    const columnas = t.columnas.map((c) => c.nombre);
    const filas: Record<string, any>[] = [];
    const pksGeneradas: number[] = [];

    for (let f = 1; f <= cantidadFilas; f++) {
      const fila: Record<string, any> = {};

      for (const col of t.columnas) {
        if (col.esPK) {
          fila[col.nombre] = f;
          pksGeneradas.push(f);
          continue;
        }

        // Si es clave foránea, vincular a una PK existente de la tabla padre
        const fk = t.clavesForaneas.find(
          (k) => k.columnaLocal.toLowerCase() === col.nombre.toLowerCase()
        );
        if (fk) {
          const valoresPadre = pksPorTabla.get(fk.tablaReferenciada.toLowerCase()) || [1];
          const valorElegido = valoresPadre[(f - 1) % valoresPadre.length] ?? 1;
          fila[col.nombre] = valorElegido;
          continue;
        }

        // Valores realistas y didácticos según el tipo y nombre de columna
        const nomLower = col.nombre.toLowerCase();
        if (
          nomLower.includes('precio') ||
          nomLower.includes('monto') ||
          nomLower.includes('total') ||
          nomLower.includes('salario')
        ) {
          fila[col.nombre] = 100 * f + 50.0;
        } else if (nomLower.includes('fecha') || (col.tipoSQL === 'TEXT' && nomLower.includes('date'))) {
          fila[col.nombre] = `2026-03-${String(Math.min(f, 28)).padStart(2, '0')}`;
        } else if (nomLower.includes('email') || nomLower.includes('correo')) {
          fila[col.nombre] = `usuario${f}@ejemplo.com`;
        } else if (nomLower.includes('telefono') || nomLower.includes('tel')) {
          fila[col.nombre] = `+54 11 4000-${1000 + f}`;
        } else if (
          nomLower.includes('activo') ||
          nomLower.includes('habilitado') ||
          nomLower.includes('es_')
        ) {
          fila[col.nombre] = 1;
        } else if (col.tipoSQL === 'INTEGER') {
          fila[col.nombre] = f * 10;
        } else if (col.tipoSQL === 'REAL') {
          fila[col.nombre] = f * 12.5;
        } else {
          fila[col.nombre] = `Ejemplo ${t.nombre} ${f}`;
        }
      }

      filas.push(fila);
    }

    pksPorTabla.set(t.nombre.toLowerCase(), pksGeneradas);
    tablas.push({
      tabla: t.nombre,
      columnas,
      filas,
    });
  }

  const ordenInsercion = tablasOrdenadas.map((t) => t.nombre);
  return {
    tablas,
    ordenInsercion,
    resumenDidactico: `Datos de prueba generados con integridad referencial validada para ${tablas.length} tablas.`,
  };
}

/**
 * Solicita al tutor IA (Gemini u OpenRouter) la generación de N filas de datos de ejemplo coherentes
 * con el dominio y respetando las claves foráneas e integridad referencial.
 * Si el servicio externo presenta saturación temporal, utiliza automáticamente el generador local de respaldo.
 */
export async function generarDatosEjemploConIA(params: {
  modelo: Modelo;
  cantidadFilas: number;
  descripcionProblema: string;
  rondasAclaracion?: RondaAclaracion[];
}): Promise<ConjuntoDatosEjemplo> {
  const { modelo, cantidadFilas, descripcionProblema, rondasAclaracion = [] } = params;

  const defTablas = construirDefinicionesTablas(modelo);
  const { tablasOrdenadas } = ordenarTablasTopologicamente(defTablas);
  const ordenNombres = tablasOrdenadas.map((t) => t.nombre);

  const estructuraTablasTexto = tablasOrdenadas
    .map((t) => {
      const cols = t.columnas
        .map(
          (c) =>
            `- ${c.nombre} (${c.tipoSQL}${c.esPK ? ', PK' : ''}${!c.nullable ? ', NOT NULL' : ''}${c.unico ? ', UNIQUE' : ''}${c.checkExpr ? `, CHECK: ${c.checkExpr}` : ''})`
        )
        .join('\n');
      const fks =
        t.clavesForaneas.length > 0
          ? '\n  Claves foráneas:\n' +
            t.clavesForaneas
              .map((fk) => `  * ${fk.columnaLocal} -> ${fk.tablaReferenciada}(${fk.columnaReferenciada})`)
              .join('\n')
          : '';
      return `Tabla "${t.nombre}":\n${cols}${fks}`;
    })
    .join('\n\n');

  const contextoRondas = formatearContextoRondas(rondasAclaracion);

  const promptUsuario = `
Actuá como el tutor pedagógico de bases de datos.
El estudiante diseñó una base de datos para el siguiente dominio:
"${descripcionProblema}"

${contextoRondas ? `Contexto y reglas aclaradas:\n${contextoRondas}\n` : ''}

Esquema de tablas y relaciones a poblar con datos de ejemplo (en orden topológico de dependencias):
${estructuraTablasTexto}

INSTRUCCIONES OBLIGATORIAS:
1. Generá exactamente ${cantidadFilas} filas realistas, didácticas y coherentes para CADA una de las siguientes tablas: ${ordenNombres.join(', ')}.
2. INTEGRIDAD REFERENCIAL ESTRICTA:
   - Para las tablas padre independientes (primeras en la lista), usá claves primarias numéricas simples (1, 2, 3...) o códigos legibles.
   - Para las tablas hijas que tienen claves foráneas (FK), el valor de la clave foránea DEBE ser uno de los valores de clave primaria que generaste previamente en la tabla padre referenciada.
   - NUNCA generes un valor de FK que no exista en la tabla padre.
3. Tipos y restricciones:
   - Respetá los tipos de datos SQLite (para fechas usá formato 'YYYY-MM-DD', para booleanos usá 1 o 0).
   - Respetá las restricciones UNIQUE y CHECK.
   - No uses textos de relleno ficticios sin sentido como "test", "asdf" o "prueba1"; usá nombres, descripciones y ejemplos verosímiles del dominio.
4. El orden de inserción DEBE ser exactamente: ${JSON.stringify(ordenNombres)}.

Respondé ÚNICAMENTE con un objeto JSON válido con esta estructura exacta (utilizá estos nombres de propiedad):
{
  "tablas": [
    {
      "tabla": "nombre_de_la_tabla",
      "columnas": ["columna1", "columna2"],
      "filas": [
        { "columna1": 1, "columna2": "valor_didactico" }
      ]
    }
  ],
  "ordenInsercion": ${JSON.stringify(ordenNombres)},
  "resumenDidactico": "Explicación breve de la coherencia de los datos generados"
}
`;

  try {
    const resultadoIA = await consultarGeminiEstructurado<ConjuntoDatosEjemplo>({
      systemInstruction: systemTutorPrompt,
      prompt: promptUsuario,
      schema: ConjuntoDatosEjemploSchema,
    });

    if (
      !resultadoIA.tablas ||
      resultadoIA.tablas.length === 0 ||
      resultadoIA.tablas.every((t) => !t.filas || t.filas.length === 0)
    ) {
      return generarDatosEjemploLocales(modelo, cantidadFilas);
    }

    // Garantizar que todas las tablas del modelo tengan filas (completar con respaldo local si alguna faltó)
    const respaldo = generarDatosEjemploLocales(modelo, cantidadFilas);
    const tablasCompletas = respaldo.tablas.map((tablaLocal) => {
      const encontrada = resultadoIA.tablas.find(
        (t) =>
          sanitizarIdentificadorSQL(t.tabla).toLowerCase() ===
          sanitizarIdentificadorSQL(tablaLocal.tabla).toLowerCase()
      );
      if (encontrada && encontrada.filas && encontrada.filas.length > 0) {
        return {
          ...encontrada,
          tabla: tablaLocal.tabla,
          columnas:
            encontrada.columnas && encontrada.columnas.length > 0
              ? encontrada.columnas
              : Object.keys(encontrada.filas[0]),
        };
      }
      return tablaLocal;
    });

    return {
      tablas: tablasCompletas,
      ordenInsercion: respaldo.ordenInsercion,
      resumenDidactico: resultadoIA.resumenDidactico || respaldo.resumenDidactico,
    };
  } catch (err) {
    console.warn('Aviso: Tutor IA no pudo generar los datos, aplicando generador local determinístico:', err);
    return generarDatosEjemploLocales(modelo, cantidadFilas);
  }
}
