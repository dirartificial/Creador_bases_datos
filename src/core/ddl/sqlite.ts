import nodeSqlParser from 'node-sql-parser';
import systemTutorPrompt from '../../prompts/system_tutor.md?raw';
import { consultarGeminiEstructurado } from '../gemini';
import {
  Entidad,
  ExplicacionDDL,
  ExplicacionDDLSchema,
  Modelo,
  OpcionesGeneracionDDL,
  TipoConceptual,
} from '../schemas';
import {
  DefinicionClaveForaneaSQL,
  DefinicionColumnaSQL,
  DefinicionTablaSQL,
} from './types';
import { buscarAtributoFK as buscarAtributoFKUnificado } from './common';

// Soporte robusto ESM / CJS para node-sql-parser en Vite y Node
const ParserConstructor =
  (nodeSqlParser as any).Parser ||
  (nodeSqlParser as any).default?.Parser ||
  nodeSqlParser;

/**
 * Mapea el tipo conceptual del modelo al tipo de datos estándar de SQLite 3.
 *
 * Mapeo didáctico:
 * - texto      -> TEXT
 * - entero     -> INTEGER
 * - decimal    -> REAL
 * - fecha      -> TEXT (formato ISO-8601 YYYY-MM-DD; SQLite no tiene tipo DATE nativo)
 * - fecha_hora -> TEXT (formato ISO-8601 YYYY-MM-DD HH:MM:SS)
 * - booleano   -> INTEGER (con restricción CHECK (col IN (0, 1)))
 */
export function mapearTipoConceptualASQLite(tipo: TipoConceptual): string {
  switch (tipo) {
    case 'texto':
      return 'TEXT';
    case 'entero':
      return 'INTEGER';
    case 'decimal':
      return 'REAL';
    case 'fecha':
    case 'fecha_hora':
      return 'TEXT';
    case 'booleano':
      return 'INTEGER';
    default:
      return 'TEXT';
  }
}

/**
 * Sanitiza identificadores SQL para evitar inyección y conflictos con palabras reservadas.
 */
export function sanitizarIdentificadorSQL(identificador: string): string {
  const limpio = identificador
    .trim()
    .replace(/[\s-]+/g, '_')
    .replace(/[^\p{L}\p{N}_]/gu, '');
  return limpio || 'columna';
}

/**
 * Escapa comillas simples para literales SQL dentro de CHECK constraints o valores de texto.
 */
export function escaparLiteralSQL(valor: string): string {
  return valor.replace(/'/g, "''");
}

/**
 * Normaliza nombres para comparación insensible a mayúsculas y acentos.
 */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Detecta si una entidad ya tiene un atributo que funcione como clave foránea
 * apuntando a la entidad padre.
 */
function buscarAtributoFK(
  entidadHijo: Entidad,
  entidadPadre: Entidad
): { atributoLocal: string; columnaPadre: string } | null {
  const nombrePadreNorm = normalizar(entidadPadre.nombre);
  const pkPadre = entidadPadre.atributos.find((a) => a.esClavePrimaria);
  const nombrePKPadre = pkPadre ? pkPadre.nombre : 'id';
  const nombrePKPadreNorm = normalizar(nombrePKPadre);

  for (const attr of entidadHijo.atributos) {
    const nom = normalizar(attr.nombre);

    // Si coincide con el nombre de la PK del padre (ej: id_cliente) y no es su propia PK exclusiva
    if (nombrePKPadreNorm && nom === nombrePKPadreNorm && !attr.esClavePrimaria) {
      return { atributoLocal: attr.nombre, columnaPadre: nombrePKPadre };
    }

    // Patrones típicos de claves foráneas
    if (
      nom === `id_${nombrePadreNorm}` ||
      nom === `${nombrePadreNorm}_id` ||
      nom === `id${nombrePadreNorm}` ||
      nom === `fk_${nombrePadreNorm}` ||
      nom === `${nombrePadreNorm}fk` ||
      nom === nombrePadreNorm ||
      (nom.includes(nombrePadreNorm) && (nom.includes('id') || nom.includes('fk')))
    ) {
      return { atributoLocal: attr.nombre, columnaPadre: nombrePKPadre };
    }
  }

  return null;
}

/**
 * Determina si existe una tabla intermedia explícita para una relación N:M entre dos entidades.
 */
function existeTablaIntermediaEnModelo(
  modelo: Modelo,
  origen: string,
  destino: string
): boolean {
  const aNorm = normalizar(origen);
  const bNorm = normalizar(destino);

  return modelo.entidades.some((ent) => {
    const entNorm = normalizar(ent.nombre);
    if (entNorm === aNorm || entNorm === bNorm) return false;

    const entA = modelo.entidades.find((e) => normalizar(e.nombre) === aNorm);
    const entB = modelo.entidades.find((e) => normalizar(e.nombre) === bNorm);

    if (entA && entB) {
      const fkA = buscarAtributoFK(ent, entA);
      const fkB = buscarAtributoFK(ent, entB);
      if (fkA && fkB) return true;
    }

    return (
      (entNorm.includes(aNorm) && entNorm.includes(bNorm)) ||
      entNorm === `${aNorm}_${bNorm}` ||
      entNorm === `${bNorm}_${aNorm}`
    );
  });
}

/**
 * Construye la representación intermedia de tablas SQL a partir del modelo conceptual.
 */
export function construirDefinicionesTablas(
  modelo: Modelo,
  opciones?: Partial<OpcionesGeneracionDDL>
): DefinicionTablaSQL[] {
  const onDelete = opciones?.onDelete ?? 'CASCADE';
  const onUpdate = opciones?.onUpdate ?? 'CASCADE';

  const tablas: DefinicionTablaSQL[] = [];
  const entidadesMap = new Map<string, Entidad>();

  for (const ent of modelo.entidades) {
    entidadesMap.set(normalizar(ent.nombre), ent);
  }

  // 1. Procesar cada entidad del modelo
  for (const ent of modelo.entidades) {
    const pks = ent.atributos.filter((a) => a.esClavePrimaria);
    const esSinglePK = pks.length === 1;

    const columnas: DefinicionColumnaSQL[] = ent.atributos.map((attr) => {
      const tipoSQL = mapearTipoConceptualASQLite(attr.tipoConceptual);
      const esPK = attr.esClavePrimaria;
      // En SQLite, INTEGER PRIMARY KEY es un alias del ROWID autoincremental
      const esAutoincrement = esPK && esSinglePK && attr.tipoConceptual === 'entero';

      let checkExpr: string | undefined;
      if (attr.tipoConceptual === 'booleano') {
        checkExpr = `"${sanitizarIdentificadorSQL(attr.nombre)}" IN (0, 1)`;
      } else if (attr.valoresPermitidos && attr.valoresPermitidos.length > 0) {
        const valoresEscapados = attr.valoresPermitidos
          .map((v) => `'${escaparLiteralSQL(v)}'`)
          .join(', ');
        checkExpr = `"${sanitizarIdentificadorSQL(attr.nombre)}" IN (${valoresEscapados})`;
      }

      return {
        nombre: sanitizarIdentificadorSQL(attr.nombre),
        tipoSQL,
        esPK,
        esAutoincrement,
        nullable: !attr.obligatorio && !esPK,
        unico: attr.unico && !esPK,
        checkExpr,
        justificacion: attr.justificacion,
      };
    });

    const clavesPrimarias = pks.map((p) => sanitizarIdentificadorSQL(p.nombre));
    const clavesForaneas: DefinicionClaveForaneaSQL[] = [];

    // Detectar claves foráneas basadas en las relaciones 1:N y 1:1
    for (const rel of modelo.relaciones) {
      if (rel.cardinalidad === '1:N' || rel.cardinalidad === '1:1') {
        if (normalizar(rel.destino) === normalizar(ent.nombre)) {
          const padreEnt = entidadesMap.get(normalizar(rel.origen));
          if (padreEnt) {
            const fkEncontrada = buscarAtributoFKUnificado(ent, padreEnt, rel);
            if (fkEncontrada) {
              clavesForaneas.push({
                columnaLocal: sanitizarIdentificadorSQL(fkEncontrada.atributoLocal),
                tablaReferenciada: sanitizarIdentificadorSQL(padreEnt.nombre),
                columnaReferenciada: sanitizarIdentificadorSQL(fkEncontrada.columnaPadre),
                onDelete,
                onUpdate,
              });
            }
          }
        }
      }
    }

    tablas.push({
      nombre: sanitizarIdentificadorSQL(ent.nombre),
      columnas,
      clavesPrimarias,
      clavesForaneas,
      comentario: ent.descripcion,
    });
  }

  // 2. Relaciones N:M que no tienen tabla intermedia en el modelo conceptual
  for (const rel of modelo.relaciones) {
    if (rel.cardinalidad === 'N:M') {
      const existe = existeTablaIntermediaEnModelo(modelo, rel.origen, rel.destino);
      if (!existe) {
        const entOrigen = entidadesMap.get(normalizar(rel.origen));
        const entDestino = entidadesMap.get(normalizar(rel.destino));

        if (entOrigen && entDestino) {
          const nombreTablaIntermedia = sanitizarIdentificadorSQL(
            `${entOrigen.nombre}_${entDestino.nombre}`
          );
          const pkOrigen = entOrigen.atributos.find((a) => a.esClavePrimaria);
          const pkDestino = entDestino.atributos.find((a) => a.esClavePrimaria);

          const colOrigen = sanitizarIdentificadorSQL(`id_${normalizar(entOrigen.nombre)}`);
          const colDestino = sanitizarIdentificadorSQL(`id_${normalizar(entDestino.nombre)}`);

          const tablaIntermedia: DefinicionTablaSQL = {
            nombre: nombreTablaIntermedia,
            columnas: [
              {
                nombre: colOrigen,
                tipoSQL: pkOrigen
                  ? mapearTipoConceptualASQLite(pkOrigen.tipoConceptual)
                  : 'INTEGER',
                esPK: true,
                esAutoincrement: false,
                nullable: false,
                unico: false,
                justificacion: `Clave foránea referenciando a la entidad padre "${entOrigen.nombre}".`,
              },
              {
                nombre: colDestino,
                tipoSQL: pkDestino
                  ? mapearTipoConceptualASQLite(pkDestino.tipoConceptual)
                  : 'INTEGER',
                esPK: true,
                esAutoincrement: false,
                nullable: false,
                unico: false,
                justificacion: `Clave foránea referenciando a la entidad padre "${entDestino.nombre}".`,
              },
            ],
            clavesPrimarias: [colOrigen, colDestino],
            clavesForaneas: [
              {
                columnaLocal: colOrigen,
                tablaReferenciada: sanitizarIdentificadorSQL(entOrigen.nombre),
                columnaReferenciada: sanitizarIdentificadorSQL(pkOrigen?.nombre ?? 'id'),
                onDelete,
                onUpdate,
              },
              {
                columnaLocal: colDestino,
                tablaReferenciada: sanitizarIdentificadorSQL(entDestino.nombre),
                columnaReferenciada: sanitizarIdentificadorSQL(pkDestino?.nombre ?? 'id'),
                onDelete,
                onUpdate,
              },
            ],
            comentario: `Tabla asociativa intermedia generada automáticamente para resolver la relación Muchos a Muchos (N:M) entre "${entOrigen.nombre}" y "${entDestino.nombre}".`,
          };

          tablas.push(tablaIntermedia);
        }
      }
    }
  }

  return tablas;
}

/**
 * Ordena las tablas topológicamente de forma que las tablas padre independientes
 * se creen antes que las tablas hijas que contienen claves foráneas.
 */
export function ordenarTablasTopologicamente(tablas: DefinicionTablaSQL[]): {
  tablasOrdenadas: DefinicionTablaSQL[];
  hayCiclo: boolean;
} {
  const grafo = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  const mapaTablas = new Map<string, DefinicionTablaSQL>();

  for (const t of tablas) {
    grafo.set(t.nombre.toLowerCase(), new Set<string>());
    inDegree.set(t.nombre.toLowerCase(), 0);
    mapaTablas.set(t.nombre.toLowerCase(), t);
  }

  // Aristas: Si B depende de A (B tiene FK -> A), entonces A debe crearse antes que B (A -> B)
  for (const t of tablas) {
    const hijo = t.nombre.toLowerCase();
    for (const fk of t.clavesForaneas) {
      const padre = fk.tablaReferenciada.toLowerCase();
      if (padre !== hijo && grafo.has(padre)) {
        const aristasPadre = grafo.get(padre)!;
        if (!aristasPadre.has(hijo)) {
          aristasPadre.add(hijo);
          inDegree.set(hijo, (inDegree.get(hijo) ?? 0) + 1);
        }
      }
    }
  }

  const cola: string[] = [];
  inDegree.forEach((deg, nombre) => {
    if (deg === 0) {
      cola.push(nombre);
    }
  });

  const orden: DefinicionTablaSQL[] = [];
  while (cola.length > 0) {
    const actual = cola.shift()!;
    const tabla = mapaTablas.get(actual);
    if (tabla) {
      orden.push(tabla);
    }

    const vecinos = grafo.get(actual) ?? new Set<string>();
    for (const v of vecinos) {
      const nuevoDeg = (inDegree.get(v) ?? 1) - 1;
      inDegree.set(v, nuevoDeg);
      if (nuevoDeg === 0) {
        cola.push(v);
      }
    }
  }

  const hayCiclo = orden.length < tablas.length;
  if (hayCiclo) {
    // Si hay un ciclo de dependencias circulares, agregamos las tablas restantes
    const yaAgregadas = new Set(orden.map((t) => t.nombre.toLowerCase()));
    for (const t of tablas) {
      if (!yaAgregadas.has(t.nombre.toLowerCase())) {
        orden.push(t);
      }
    }
  }

  return { tablasOrdenadas: orden, hayCiclo };
}

/**
 * Genera el script DDL completo y determinístico para SQLite 3 a partir del modelo.
 */
export function generarDDLSQLite(
  modelo: Modelo,
  opciones?: Partial<OpcionesGeneracionDDL>
): string {
  const incluirComentarios = opciones?.incluirComentarios ?? true;
  const habilitarFKs = opciones?.habilitarClavesForaneas ?? true;

  const tablasCrudas = construirDefinicionesTablas(modelo, opciones);
  const { tablasOrdenadas } = ordenarTablasTopologicamente(tablasCrudas);

  const lineas: string[] = [];

  if (incluirComentarios) {
    lineas.push('-- ============================================================================');
    lineas.push('-- SCRIPT DDL DETERMINÍSTICO PARA SQLITE 3');
    lineas.push('-- Generado por DB Tutor (Asistente Pedagógico de Diseño de Bases de Datos)');
    lineas.push('-- Modelo conceptual validado con Zod y trazado en bitácora de decisiones.');
    lineas.push('-- ============================================================================');
    lineas.push('');
  }

  if (habilitarFKs) {
    if (incluirComentarios) {
      lineas.push('-- En SQLite, la verificación de claves foráneas está DESACTIVADA por defecto');
      lineas.push('-- por compatibilidad histórica con versiones antiguas. Esta directiva la activa:');
    }
    lineas.push('PRAGMA foreign_keys = ON;');
    lineas.push('');
  }

  for (const tabla of tablasOrdenadas) {
    if (incluirComentarios) {
      lineas.push('-- ----------------------------------------------------------------------------');
      lineas.push(`-- Tabla: "${tabla.nombre}"`);
      if (tabla.comentario) {
        lineas.push(`-- Propósito: ${tabla.comentario}`);
      }
      lineas.push('-- ----------------------------------------------------------------------------');
    }

    lineas.push(`CREATE TABLE "${tabla.nombre}" (`);

    const definicionesInternas: string[] = [];
    const esCompuestaPK = tabla.clavesPrimarias.length > 1;

    // 1. Columnas
    for (const col of tabla.columnas) {
      const partesCol: string[] = [`  "${col.nombre}" ${col.tipoSQL}`];

      if (col.esPK && !esCompuestaPK) {
        if (col.esAutoincrement) {
          partesCol.push('PRIMARY KEY AUTOINCREMENT');
        } else {
          partesCol.push('PRIMARY KEY');
        }
      }

      if (!col.nullable && !(col.esPK && !esCompuestaPK)) {
        partesCol.push('NOT NULL');
      }

      if (col.unico && !col.esPK) {
        partesCol.push('UNIQUE');
      }

      if (col.checkExpr) {
        partesCol.push(`CHECK (${col.checkExpr})`);
      }

      definicionesInternas.push(partesCol.join(' '));
    }

    // 2. Clave primaria compuesta (si aplica)
    if (esCompuestaPK) {
      const pksLista = tabla.clavesPrimarias.map((pk) => `"${pk}"`).join(', ');
      definicionesInternas.push(`  PRIMARY KEY (${pksLista})`);
    }

    // 3. Claves foráneas de la tabla
    for (const fk of tabla.clavesForaneas) {
      definicionesInternas.push(
        `  FOREIGN KEY ("${fk.columnaLocal}") REFERENCES "${fk.tablaReferenciada}" ("${fk.columnaReferenciada}") ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`
      );
    }

    lineas.push(definicionesInternas.join(',\n'));
    lineas.push(');');
    lineas.push('');
  }

  return lineas.join('\n').trim();
}

/**
 * Valida la sintaxis del script DDL generado usando el parser AST de SQL (node-sql-parser).
 * Ignora directivas PRAGMA ya que son comandos exclusivos del motor SQLite y no parte del estándar ANSI DDL.
 */
export function validarScriptSQLite(ddl: string): { valido: boolean; error?: string } {
  try {
    const parser = new ParserConstructor();
    // Filtramos líneas PRAGMA para la verificación del parser AST
    const ddlSinPragmas = ddl
      .split('\n')
      .filter((linea) => !linea.trim().toUpperCase().startsWith('PRAGMA'))
      .join('\n')
      .trim();

    if (!ddlSinPragmas) {
      return { valido: true };
    }

    parser.astify(ddlSinPragmas, { database: 'sqlite' });
    return { valido: true };
  } catch (err) {
    return {
      valido: false,
      error: err instanceof Error ? err.message : 'Error de sintaxis SQL en el script generado.',
    };
  }
}

/**
 * Solicita al tutor IA (Gemini) una explicación pedagógica línea por línea / bloque por bloque
 * del script DDL generado, para que el estudiante aprenda por qué se eligieron esas estructuras.
 */
/**
 * Genera una explicación pedagógica deductiva local a partir de la estructura del modelo,
 * garantizando que el estudiante siempre reciba la justificación conceptual aun si la IA externa no está disponible.
 */
export function generarExplicacionDDLLocal(modelo: Modelo, _ddl?: string): ExplicacionDDL {
  const explicacionPorTabla = modelo.entidades.map((ent) => {
    const pk = ent.atributos.find((a) => a.esClavePrimaria);
    const fks = ent.atributos.filter(
      (a) =>
        (a.nombre.toLowerCase().startsWith('id_') || a.nombre.toLowerCase().endsWith('_id')) &&
        !a.esClavePrimaria
    );

    const detalleClaves = pk
      ? `Clave primaria: "${pk.nombre}" (${pk.tipoConceptual}). ${
          fks.length > 0
            ? `Claves foráneas asociadas: ${fks.map((f) => f.nombre).join(', ')}.`
            : 'Sin claves foráneas salientes hacia otras entidades.'
        }`
      : 'Clave primaria autoincremental asignada automáticamente.';

    return {
      tabla: ent.nombre,
      explicacion: `Estructura relacional de "${ent.nombre}". Almacena los atributos definidos con tipos nativos SQLite (TEXT para cadenas/fechas e INTEGER para claves numéricas).`,
      detalleClaves,
    };
  });

  return {
    resumenPedagogico:
      'El script DDL traduce el modelo conceptual confirmado al dialecto SQLite 3, estableciendo identificadores únicos, restricciones de no nulidad (NOT NULL) y reglas de integridad referencial.',
    explicacionPorTabla,
    observacionesTutor: [
      'SQLite exige ejecutar siempre "PRAGMA foreign_keys = ON;" al abrir la base de datos para que el motor valide activamente las claves foráneas.',
      'La acción ON DELETE CASCADE asegura que no queden registros huérfanos al borrar la entidad principal vinculada.',
      'SQLite no cuenta con tipo DATE nativo; las fechas se almacenan como TEXT en formato estándar ISO-8601 (YYYY-MM-DD HH:MM:SS) para permitir comparaciones cronológicas lexicográficas.',
    ],
  };
}

/**
 * Solicita al tutor IA (Gemini u OpenRouter) una explicación pedagógica línea por línea / bloque por bloque
 * del script DDL generado, para que el estudiante aprenda por qué se eligieron esas estructuras.
 * Si el servicio externo está sobrecargado (HTTP 503) o sin conexión, provee automáticamente la explicación deductiva local.
 */
export async function pedirExplicacionDDLConIA(params: {
  ddl: string;
  modelo: Modelo;
}): Promise<ExplicacionDDL> {
  const { ddl, modelo } = params;

  const nombresEntidades = modelo.entidades.map((e) => e.nombre).join(', ');

  const promptUsuario = `
Actuá como el tutor pedagógico de bases de datos.
El estudiante confirmó el siguiente modelo conceptual relacional con las entidades: ${nombresEntidades}.

Se ha generado el siguiente script DDL determinístico para SQLite 3:
\`\`\`sql
${ddl}
\`\`\`

Tu tarea:
1. Brindar un resumen pedagógico general en español rioplatense claro sobre la traducción del modelo conceptual a SQLite.
2. Explicar cada tabla: su propósito didáctico, por qué se eligió cada tipo de dato SQLite (recordando que SQLite no tiene tipo DATE nativo y por qué se usa TEXT en formato ISO), cómo funcionan sus claves primarias (y por qué INTEGER PRIMARY KEY actúa como alias de ROWID) y claves foráneas.
3. Brindar observaciones o advertencias didácticas (por ejemplo: la necesidad de PRAGMA foreign_keys = ON, qué significa ON DELETE CASCADE/RESTRICT con ejemplos concretos de la vida real del dominio).

Respondé ÚNICAMENTE con un objeto JSON válido con esta estructura exacta:
{
  "resumenPedagogico": "Resumen conceptual claro sobre el script DDL generado para SQLite",
  "explicacionPorTabla": [
    {
      "tabla": "nombre_de_la_tabla",
      "explicacion": "Propósito didáctico y elección de tipos de datos",
      "detalleClaves": "Explicación de sus claves primarias y foráneas"
    }
  ],
  "observacionesTutor": [
    "Observación 1 sobre foreign_keys = ON o acciones referenciales",
    "Observación 2 sobre buenas prácticas en SQLite"
  ]
}
`;

  try {
    return await consultarGeminiEstructurado<ExplicacionDDL>({
      systemInstruction: systemTutorPrompt,
      prompt: promptUsuario,
      schema: ExplicacionDDLSchema,
    });
  } catch (err) {
    console.warn('Aviso: el tutor IA externo no pudo responder en este momento, aplicando explicación pedagógica local:', err);
    return generarExplicacionDDLLocal(modelo, ddl);
  }
}
