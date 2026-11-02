import nodeSqlParser from 'node-sql-parser';
import systemTutorPrompt from '../prompts/system_tutor.md?raw';
import { consultarGeminiEstructurado } from './gemini';
import {
  Modelo,
  PropuestaInformeIA,
  PropuestaInformeIASchema,
  ResultadoInforme,
} from './schemas';
import { construirDefinicionesTablas } from './ddl/sqlite';
import { sqliteClient } from './workers/sqliteClient';

// Compatibilidad robusta ESM / CJS para node-sql-parser
const ParserConstructor =
  (nodeSqlParser as any).Parser ||
  (nodeSqlParser as any).default?.Parser ||
  nodeSqlParser;

/**
 * Sentencias de modificación o administración que están terminantemente prohibidas en informes.
 */
const SENTENCIAS_PROHIBIDAS = new Set([
  'insert',
  'update',
  'delete',
  'drop',
  'alter',
  'create',
  'replace',
  'attach',
  'detach',
  'pragma',
  'vacuum',
  'reindex',
  'copy',
  'transaction',
  'commit',
  'rollback',
]);

/**
 * Funciones nativas o comandos peligrosos que deben ser rechazados en SQLite.
 */
const FUNCIONES_PELIGROSAS = new Set([
  'load_extension',
  'writefile',
  'readfile',
  'edit',
  'fts3_tokenizer',
]);

/**
 * Verifica recursivamente el AST de la consulta para asegurar que
 * no existan funciones peligrosas ni sentencias que no sean SELECT.
 */
function verificarNodosAST(nodo: any): string | null {
  if (!nodo || typeof nodo !== 'object') {
    return null;
  }

  // Si el nodo representa una sentencia prohibida, rechazar
  if (typeof nodo.type === 'string') {
    const tipo = nodo.type.toLowerCase();
    if (SENTENCIAS_PROHIBIDAS.has(tipo)) {
      return `Tipo de operación no permitida: "${nodo.type}". Solo se admiten consultas de lectura SELECT.`;
    }

    // Verificar si es una llamada a función peligrosa
    if (tipo === 'function' || tipo === 'aggr_func') {
      const nombreFunc = String(nodo.name?.name || nodo.name || '').toLowerCase();
      if (FUNCIONES_PELIGROSAS.has(nombreFunc)) {
        return `Uso de función prohibida en SQLite: "${nombreFunc}".`;
      }
    }
  }

  // Recorrer recursivamente las propiedades del objeto o elementos del array
  for (const clave of Object.keys(nodo)) {
    const hijo = nodo[clave];
    if (Array.isArray(hijo)) {
      for (const item of hijo) {
        const error = verificarNodosAST(item);
        if (error) return error;
      }
    } else if (hijo && typeof hijo === 'object') {
      const error = verificarNodosAST(hijo);
      if (error) return error;
    }
  }

  return null;
}

/**
 * Valida de forma estricta que una consulta SQL cumpla con las políticas de seguridad:
 * 1. Debe ser una única sentencia (rechaza consultas múltiples o inyecciones con punto y coma).
 * 2. Debe ser exclusivamente una sentencia SELECT (rechaza INSERT, UPDATE, DELETE, DROP, ALTER, PRAGMA, ATTACH, etc.).
 * 3. Enforza una cláusula LIMIT máxima para prevenir desbordamientos o bloqueos en el navegador.
 */
export function validarYNormalizarConsultaSelect(
  sql: string,
  maxLimit = 100
): { valido: boolean; sqlNormalizado?: string; error?: string } {
  const sqlTrim = sql.trim();
  if (!sqlTrim) {
    return { valido: false, error: 'La consulta SQL no puede estar vacía.' };
  }

  // Detección directa de llamadas a funciones nativas peligrosas en SQLite
  for (const funcPeligrosa of FUNCIONES_PELIGROSAS) {
    const regexFunc = new RegExp(`\\b${funcPeligrosa}\\s*\\(`, 'i');
    if (regexFunc.test(sqlTrim)) {
      return {
        valido: false,
        error: `Uso de función prohibida en SQLite: "${funcPeligrosa}".`,
      };
    }
  }

  // Detección preliminar de comandos DDL/DML o pragmas no permitidos
  const palabrasProhibidasRegex =
    /\b(DROP|INSERT|UPDATE|DELETE|ALTER|CREATE|REPLACE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|COPY|TRANSACTION|COMMIT|ROLLBACK)\b/i;

  // Analizamos con el parser AST de SQLite
  try {
    const parser = new ParserConstructor();
    let ast: any;

    try {
      ast = parser.astify(sqlTrim, { database: 'sqlite' });
    } catch (parseErr) {
      return {
        valido: false,
        error:
          parseErr instanceof Error
            ? `Error de sintaxis SQL: ${parseErr.message}`
            : 'Error de sintaxis SQL en la consulta ingresada.',
      };
    }

    // 1. Debe ser una única sentencia
    if (Array.isArray(ast) && ast.length > 1) {
      return {
        valido: false,
        error:
          'Solo se permite una única consulta SQL. Se detectaron múltiples sentencias en el texto.',
      };
    }

    const sentencia = Array.isArray(ast) ? ast[0] : ast;

    // 2. Debe ser de tipo 'select'
    if (!sentencia || typeof sentencia.type !== 'string' || sentencia.type.toLowerCase() !== 'select') {
      return {
        valido: false,
        error: `Operación no permitida: "${sentencia?.type ?? 'desconocida'}". En los informes únicamente se admiten consultas de lectura (SELECT).`,
      };
    }

    // 3. Verificación AST exhaustiva contra funciones y subconsultas peligrosas
    const errorAST = verificarNodosAST(sentencia);
    if (errorAST) {
      return { valido: false, error: errorAST };
    }

    // 4. Verificación de patrones de inyección o palabras prohibidas fuera de literales
    const sinStrings = sqlTrim.replace(/'(?:''|[^'])*'/g, "''");
    if (palabrasProhibidasRegex.test(sinStrings)) {
      // Si contiene palabras prohibidas, validamos que no formen una sentencia secundaria
      const match = sinStrings.match(palabrasProhibidasRegex);
      return {
        valido: false,
        error: `Instrucción no permitida en informes: "${match ? match[0] : 'comando prohibido'}". Solo se permiten consultas de selección (SELECT).`,
      };
    }

    // 5. Enforzar o acotar la cláusula LIMIT
    let sqlConLimit = sqlTrim.replace(/;+\s*$/, '');

    // Comprobamos si tiene cláusula LIMIT en el AST
    if (!sentencia.limit || !sentencia.limit.value || sentencia.limit.value.length === 0) {
      sqlConLimit = `${sqlConLimit} LIMIT ${maxLimit};`;
    } else {
      const limiteActual = Number(sentencia.limit.value[0]?.value);
      if (Number.isFinite(limiteActual) && limiteActual > maxLimit) {
        // Reemplazamos el límite si excede el máximo permitido
        sqlConLimit = sqlConLimit.replace(/\bLIMIT\s+\d+/i, `LIMIT ${maxLimit}`) + ';';
      } else {
        sqlConLimit = `${sqlConLimit};`;
      }
    }

    return {
      valido: true,
      sqlNormalizado: sqlConLimit,
    };
  } catch (err) {
    return {
      valido: false,
      error: err instanceof Error ? err.message : 'Error al validar la consulta SQL.',
    };
  }
}

/**
 * Genera de forma determinística y local una propuesta de informe SQL válida sobre el modelo actual,
 * utilizada como respaldo cuando el proveedor de IA presenta fallos de cuota/conexión o sintaxis SQL.
 */
export function generarPropuestaInformeLocal(
  modelo: Modelo,
  pedidoEstudiante: string
): PropuestaInformeIA {
  const defTablas = construirDefinicionesTablas(modelo);
  if (defTablas.length === 0) {
    return {
      titulo: 'Consulta general',
      consultaSQL: 'SELECT 1 AS resultado LIMIT 1;',
      explicacionPasoAPaso: '1. SELECT 1 devuelve una fila de verificación.',
      tipoGraficoSugerido: 'ninguno',
      resumenDidactico: 'Informe de prueba básico.',
    };
  }

  const pedidoLower = pedidoEstudiante.toLowerCase();
  const tablaConFK = defTablas.find((t) => t.clavesForaneas.length > 0);
  const fk = tablaConFK?.clavesForaneas[0];
  const tablaPadre = fk
    ? defTablas.find((t) => t.nombre.toLowerCase() === fk.tablaReferenciada.toLowerCase())
    : undefined;

  if (
    tablaConFK &&
    fk &&
    tablaPadre &&
    (pedidoLower.includes('join') ||
      pedidoLower.includes('combinad') ||
      pedidoLower.includes('relacion'))
  ) {
    const colPadre =
      tablaPadre.columnas.find((c) => !c.esPK && c.tipoSQL === 'TEXT')?.nombre ??
      tablaPadre.columnas[0]?.nombre ??
      fk.columnaReferenciada;
    const colHija =
      tablaConFK.columnas.find((c) => !c.esPK && c.nombre !== fk.columnaLocal)?.nombre ??
      tablaConFK.columnas[0]?.nombre ??
      fk.columnaLocal;
    const sql = `SELECT "${tablaConFK.nombre}"."${colHija}" AS "registro", "${tablaPadre.nombre}"."${colPadre}" AS "vinculado_con" FROM "${tablaConFK.nombre}" JOIN "${tablaPadre.nombre}" ON "${tablaConFK.nombre}"."${fk.columnaLocal}" = "${tablaPadre.nombre}"."${fk.columnaReferenciada}" LIMIT 20;`;
    return {
      titulo: `Listado combinado de ${tablaConFK.nombre} y ${tablaPadre.nombre}`,
      consultaSQL: sql,
      explicacionPasoAPaso: `1. SELECT selecciona las columnas principales de "${tablaConFK.nombre}" y "${tablaPadre.nombre}".\n2. JOIN vincula ambas tablas mediante la clave foránea "${fk.columnaLocal}" = "${fk.columnaReferenciada}".\n3. LIMIT 20 acota el conjunto de resultados.`,
      tipoGraficoSugerido: 'ninguno',
      resumenDidactico: `Muestra la relación de integridad referencial entre ${tablaConFK.nombre} y ${tablaPadre.nombre}.`,
    };
  }

  if (tablaConFK && fk && tablaPadre) {
    const colEtiqueta =
      tablaPadre.columnas.find((c) => !c.esPK && c.tipoSQL === 'TEXT')?.nombre ??
      tablaPadre.columnas[0]?.nombre ??
      fk.columnaReferenciada;
    const colPKHija =
      tablaConFK.clavesPrimarias[0] ?? tablaConFK.columnas[0]?.nombre ?? fk.columnaLocal;
    const sql = `SELECT "${tablaPadre.nombre}"."${colEtiqueta}" AS "categoria", COUNT("${tablaConFK.nombre}"."${colPKHija}") AS "total" FROM "${tablaPadre.nombre}" LEFT JOIN "${tablaConFK.nombre}" ON "${tablaPadre.nombre}"."${fk.columnaReferenciada}" = "${tablaConFK.nombre}"."${fk.columnaLocal}" GROUP BY "${tablaPadre.nombre}"."${fk.columnaReferenciada}", "${tablaPadre.nombre}"."${colEtiqueta}" ORDER BY "total" DESC LIMIT 20;`;
    return {
      titulo: `Total de ${tablaConFK.nombre} por ${tablaPadre.nombre}`,
      consultaSQL: sql,
      explicacionPasoAPaso: `1. SELECT elige la categoría ("${colEtiqueta}") y calcula el conteo con COUNT().\n2. LEFT JOIN vincula "${tablaPadre.nombre}" con "${tablaConFK.nombre}" incluyendo registros sin coincidencias.\n3. GROUP BY agrupa por cada registro padre.\n4. ORDER BY ordena de mayor a menor según el total.`,
      tipoGraficoSugerido: 'barras',
      columnaEtiquetas: 'categoria',
      columnaValores: 'total',
      resumenDidactico: `Permite analizar la distribución cuantitativa de ${tablaConFK.nombre} agrupada por ${tablaPadre.nombre}.`,
    };
  }

  const tablaPrincipal = defTablas[0];
  const colEtiqueta =
    tablaPrincipal.columnas.find((c) => !c.esPK)?.nombre ??
    tablaPrincipal.columnas[0]?.nombre ??
    'id';
  const colValor =
    tablaPrincipal.columnas.find(
      (c) => !c.esPK && (c.tipoSQL === 'INTEGER' || c.tipoSQL === 'REAL')
    )?.nombre ??
    tablaPrincipal.clavesPrimarias[0] ??
    colEtiqueta;

  const sql = `SELECT "${colEtiqueta}" AS "etiqueta", COUNT("${colValor}") AS "total" FROM "${tablaPrincipal.nombre}" GROUP BY "${colEtiqueta}" ORDER BY "total" DESC LIMIT 20;`;
  return {
    titulo: `Resumen agrupado de ${tablaPrincipal.nombre}`,
    consultaSQL: sql,
    explicacionPasoAPaso: `1. SELECT selecciona "${colEtiqueta}" y cuenta las ocurrencias con COUNT().\n2. FROM consulta la tabla "${tablaPrincipal.nombre}".\n3. GROUP BY agrupa los valores y ORDER BY los ordena de forma descendente.`,
    tipoGraficoSugerido: 'barras',
    columnaEtiquetas: 'etiqueta',
    columnaValores: 'total',
    resumenDidactico: `Presenta un resumen analítico de los registros almacenados en ${tablaPrincipal.nombre}.`,
  };
}

/**
 * Solicita al tutor IA (Gemini) traducir una pregunta o pedido en lenguaje natural del estudiante
 * a una consulta SQL de tipo SELECT explicada paso a paso.
 *
 * NOTA DE SEGURIDAD (Sección 3.3):
 * El prompt a la IA recibe ÚNICAMENTE el esquema del modelo (tablas, columnas y relaciones),
 * JAMÁS datos reales del estudiante ni contenidos privados.
 */
export async function generarConsultaInformeConIA(params: {
  modelo: Modelo;
  pedidoEstudiante: string;
  descripcionProblema: string;
}): Promise<PropuestaInformeIA> {
  const { modelo, pedidoEstudiante, descripcionProblema } = params;
  const defTablas = construirDefinicionesTablas(modelo);

  // Construir únicamente la descripción del esquema relacional real en SQLite (sin datos)
  const esquemaTexto = modelo.entidades
    .map((ent) => {
      const defSQL = defTablas.find(
        (d) => d.nombre.toLowerCase() === ent.nombre.toLowerCase()
      );
      const cols = (defSQL ? defSQL.columnas : []).map(
        (c) => `- ${c.nombre} (${c.tipoSQL}${c.esPK ? ', PK' : ''}${!c.nullable ? ', NOT NULL' : ''})`
      );
      const colsFallback = ent.atributos.map(
        (a) =>
          `- ${a.nombre} (${a.tipoConceptual}${a.esClavePrimaria ? ', PK' : ''}${a.obligatorio ? ', NOT NULL' : ''})`
      );
      const fksTexto =
        defSQL && defSQL.clavesForaneas.length > 0
          ? '\n  Claves foráneas en SQLite:\n' +
            defSQL.clavesForaneas
              .map(
                (fk) =>
                  `  * ${fk.columnaLocal} -> ${fk.tablaReferenciada}(${fk.columnaReferenciada})`
              )
              .join('\n')
          : '';
      return `Tabla "${defSQL ? defSQL.nombre : ent.nombre}" (${ent.descripcion}):\n${(cols.length > 0 ? cols : colsFallback).join('\n')}${fksTexto}`;
    })
    .join('\n\n');

  const relacionesTexto = modelo.relaciones
    .map(
      (r) =>
        `- "${r.origen}" con "${r.destino}" (${r.cardinalidad}): ${r.descripcion}`
    )
    .join('\n');

  const promptUsuario = `
Actuá como el tutor pedagógico de bases de datos.
El estudiante tiene la siguiente base de datos en SQLite:
Dominio: "${descripcionProblema}"

Esquema de tablas y columnas reales en SQLite:
${esquemaTexto}

Relaciones confirmadas:
${relacionesTexto}

Solicitud del estudiante en lenguaje natural:
"${pedidoEstudiante}"

INSTRUCCIONES OBLIGATORIAS:
1. Generá ÚNICAMENTE una consulta SQL de lectura con la sentencia \`SELECT\`.
   - Está terminantemente PROHIBIDO usar sentencias INSERT, UPDATE, DELETE, DROP, ALTER o PRAGMA.
   - Utilizá EXCLUSIVAMENTE los nombres exactos de tablas y columnas listados en el esquema de arriba.
   - Si la consulta involucra varias tablas, utilizá JOINs explícitos con sus condiciones ON usando las claves foráneas indicadas.
   - Si requiere agregación o conteos, utilizá GROUP BY y funciones estándar como COUNT(), SUM(), AVG().
   - Incluí un orden claro con ORDER BY y un LIMIT pedagógico razonable (máximo 50).
2. Título breve del informe (ej: "Total de libros por autor", "Mascotas registradas por especie").
3. Explicación didáctica paso a paso:
   - Explicá cada cláusula utilizada (SELECT, FROM, JOIN, WHERE, GROUP BY, ORDER BY, LIMIT) en español rioplatense claro.
4. Tipo de gráfico sugerido:
   - Si el resultado tiene una categoría y una métrica numérica agregada, sugerí "barras" o "torta" e indicá qué alias o columna va en 'columnaEtiquetas' y cuál en 'columnaValores'.
   - Si no aplica gráfico, usá "ninguno".
5. Resumen didáctico para que el estudiante comprenda el valor de la consulta.

Devolvé ÚNICAMENTE un objeto JSON válido con esta estructura exacta:
{
  "titulo": "Título breve del informe",
  "consultaSQL": "SELECT ... FROM ... LIMIT 20;",
  "explicacionPasoAPaso": "1. SELECT...\n2. FROM...",
  "tipoGraficoSugerido": "barras",
  "columnaEtiquetas": "nombre_columna_etiqueta",
  "columnaValores": "nombre_columna_numerica",
  "resumenDidactico": "Explicación breve del propósito del informe"
}
`;

  try {
    const respuesta = await consultarGeminiEstructurado<PropuestaInformeIA>({
      systemInstruction: systemTutorPrompt,
      prompt: promptUsuario,
      schema: PropuestaInformeIASchema,
    });

    // Verificación de seguridad inmediata sobre la salida de la IA
    const validacion = validarYNormalizarConsultaSelect(respuesta.consultaSQL);
    if (!validacion.valido || !validacion.sqlNormalizado) {
      return generarPropuestaInformeLocal(modelo, pedidoEstudiante);
    }

    return {
      ...respuesta,
      consultaSQL: validacion.sqlNormalizado,
    };
  } catch (err) {
    console.warn('Aviso: Tutor IA no pudo generar el informe, aplicando generador SQL local:', err);
    return generarPropuestaInformeLocal(modelo, pedidoEstudiante);
  }
}

/**
 * Ejecuta una consulta SELECT validada en el motor SQLite (sql.js en Web Worker)
 * y mide el tiempo de respuesta.
 */
export async function ejecutarConsultaInforme(sql: string): Promise<ResultadoInforme> {
  const validacion = validarYNormalizarConsultaSelect(sql);
  if (!validacion.valido || !validacion.sqlNormalizado) {
    throw new Error(validacion.error ?? 'Consulta SQL inválida o insegura.');
  }

  const inicio = performance.now();
  const res = await sqliteClient.ejecutarConsulta(validacion.sqlNormalizado);
  const fin = performance.now();
  const tiempoMs = Math.round((fin - inicio) * 10) / 10;

  if (!res || res.length === 0) {
    return {
      columnas: [],
      filas: [],
      totalFilas: 0,
      tiempoMs,
    };
  }

  const primerResultado = res[0];
  const columnas = primerResultado.columns || [];
  const filas = primerResultado.values || [];

  return {
    columnas,
    filas,
    totalFilas: filas.length,
    tiempoMs,
  };
}
