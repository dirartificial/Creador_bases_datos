import nodeSqlParser from 'node-sql-parser';
import systemTutorPrompt from '../../prompts/system_tutor.md?raw';
import { consultarGeminiEstructurado } from '../gemini';
import {
  ExplicacionDDL,
  ExplicacionDDLSchema,
  Modelo,
  OpcionesGeneracionDDL,
  TipoConceptual,
} from '../schemas';
import {
  buscarAtributoFK,
  escaparLiteralSQL,
  existeTablaIntermediaEnModelo,
  normalizar,
  ordenarTablasTopologicamente,
  sanitizarIdentificadorSQL,
} from './common';
import {
  DefinicionClaveForaneaSQL,
  DefinicionColumnaSQL,
  DefinicionTablaSQL,
} from './types';

// Soporte robusto ESM / CJS para node-sql-parser
const ParserConstructor =
  (nodeSqlParser as any).Parser ||
  (nodeSqlParser as any).default?.Parser ||
  nodeSqlParser;

/**
 * Mapea el tipo conceptual del modelo al tipo de datos estándar de PostgreSQL.
 *
 * Mapeo didáctico:
 * - texto      -> VARCHAR(255) (o TEXT si no tiene límite)
 * - entero     -> INTEGER (o SERIAL para PKs autoincrementales)
 * - decimal    -> NUMERIC(10, 2) (precisión fija ideal para montos, precios y mediciones)
 * - fecha      -> DATE (tipo de fecha nativo ANSI/Postgres)
 * - fecha_hora -> TIMESTAMP (marca temporal con fecha y hora completa)
 * - booleano   -> BOOLEAN (tipo booleano nativo true / false)
 */
export function mapearTipoConceptualAPostgres(tipo: TipoConceptual): string {
  switch (tipo) {
    case 'texto':
      return 'VARCHAR(255)';
    case 'entero':
      return 'INTEGER';
    case 'decimal':
      return 'NUMERIC(10, 2)';
    case 'fecha':
      return 'DATE';
    case 'fecha_hora':
      return 'TIMESTAMP';
    case 'booleano':
      return 'BOOLEAN';
    default:
      return 'VARCHAR(255)';
  }
}

/**
 * Construye la representación intermedia de tablas SQL adaptada para PostgreSQL.
 */
export function construirDefinicionesTablasPostgres(
  modelo: Modelo,
  opciones?: Partial<OpcionesGeneracionDDL>
): DefinicionTablaSQL[] {
  const onDelete = opciones?.onDelete ?? 'CASCADE';
  const onUpdate = opciones?.onUpdate ?? 'CASCADE';

  const tablas: DefinicionTablaSQL[] = [];
  const entidadesMap = new Map<string, any>();
  modelo.entidades.forEach((e) => entidadesMap.set(normalizar(e.nombre), e));

  // 1. Entidades del modelo
  for (const ent of modelo.entidades) {
    const pks = ent.atributos.filter((a) => a.esClavePrimaria);
    const esSinglePK = pks.length === 1;

    const columnas: DefinicionColumnaSQL[] = ent.atributos.map((attr) => {
      const esPK = attr.esClavePrimaria;
      const esAutoincrement = esPK && esSinglePK && attr.tipoConceptual === 'entero';

      // En PostgreSQL, una clave primaria autoincremental entera se define tradicionalmente como SERIAL
      const tipoSQL = esAutoincrement
        ? 'SERIAL'
        : mapearTipoConceptualAPostgres(attr.tipoConceptual);

      let checkExpr: string | undefined;
      const colSanitizada = sanitizarIdentificadorSQL(attr.nombre);

      if (attr.valoresPermitidos && attr.valoresPermitidos.length > 0) {
        const valoresEscapados = attr.valoresPermitidos
          .map((v) => `'${escaparLiteralSQL(v)}'`)
          .join(', ');
        checkExpr = `"${colSanitizada}" IN (${valoresEscapados})`;
      }

      return {
        nombre: colSanitizada,
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

    for (const rel of modelo.relaciones) {
      if (rel.cardinalidad === '1:N' || rel.cardinalidad === '1:1') {
        if (normalizar(rel.destino) === normalizar(ent.nombre)) {
          const padreEnt = entidadesMap.get(normalizar(rel.origen));
          if (padreEnt) {
            const fkEncontrada = buscarAtributoFK(ent, padreEnt);
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
          const pkOrigen = entOrigen.atributos.find((a: any) => a.esClavePrimaria);
          const pkDestino = entDestino.atributos.find((a: any) => a.esClavePrimaria);

          const colOrigen = sanitizarIdentificadorSQL(`id_${normalizar(entOrigen.nombre)}`);
          const colDestino = sanitizarIdentificadorSQL(`id_${normalizar(entDestino.nombre)}`);

          const tablaIntermedia: DefinicionTablaSQL = {
            nombre: nombreTablaIntermedia,
            columnas: [
              {
                nombre: colOrigen,
                tipoSQL: pkOrigen
                  ? mapearTipoConceptualAPostgres(pkOrigen.tipoConceptual)
                  : 'INTEGER',
                esPK: true,
                esAutoincrement: false,
                nullable: false,
                unico: false,
                justificacion: `Clave foránea hacia "${entOrigen.nombre}".`,
              },
              {
                nombre: colDestino,
                tipoSQL: pkDestino
                  ? mapearTipoConceptualAPostgres(pkDestino.tipoConceptual)
                  : 'INTEGER',
                esPK: true,
                esAutoincrement: false,
                nullable: false,
                unico: false,
                justificacion: `Clave foránea hacia "${entDestino.nombre}".`,
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
            comentario: `Tabla asociativa intermedia para la relación N:M entre "${entOrigen.nombre}" y "${entDestino.nombre}".`,
          };

          tablas.push(tablaIntermedia);
        }
      }
    }
  }

  return tablas;
}

/**
 * Genera el script DDL determinístico para PostgreSQL a partir del modelo.
 */
export function generarDDLPostgres(
  modelo: Modelo,
  opciones?: Partial<OpcionesGeneracionDDL>
): string {
  const incluirComentarios = opciones?.incluirComentarios ?? true;
  const tablasCrudas = construirDefinicionesTablasPostgres(modelo, opciones);
  const { tablasOrdenadas } = ordenarTablasTopologicamente(tablasCrudas);

  const lineas: string[] = [];
  const comentariosSentencias: string[] = [];

  if (incluirComentarios) {
    lineas.push('-- ============================================================================');
    lineas.push('-- SCRIPT DDL DETERMINÍSTICO PARA POSTGRESQL');
    lineas.push('-- Generado por DB Tutor (Asistente Pedagógico de Diseño de Bases de Datos)');
    lineas.push('-- Compatible con PostgreSQL 12+ y PGlite (WASM en el navegador)');
    lineas.push('-- ============================================================================');
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
        partesCol.push('PRIMARY KEY');
      } else {
        if (!col.nullable) {
          partesCol.push('NOT NULL');
        }
        if (col.unico) {
          partesCol.push('UNIQUE');
        }
      }

      if (col.checkExpr) {
        partesCol.push(`CHECK (${col.checkExpr})`);
      }

      definicionesInternas.push(partesCol.join(' '));

      // Comentarios de columnas ANSI en PostgreSQL
      if (incluirComentarios && col.justificacion) {
        comentariosSentencias.push(
          `COMMENT ON COLUMN "${tabla.nombre}"."${col.nombre}" IS '${escaparLiteralSQL(
            col.justificacion
          )}';`
        );
      }
    }

    // 2. Clave primaria compuesta
    if (esCompuestaPK) {
      const colsPK = tabla.clavesPrimarias.map((c) => `"${c}"`).join(', ');
      definicionesInternas.push(`  CONSTRAINT "pk_${tabla.nombre}" PRIMARY KEY (${colsPK})`);
    }

    // 3. Claves foráneas con restricciones nombradas
    for (const fk of tabla.clavesForaneas) {
      const nombreConstraint = `fk_${tabla.nombre}_${fk.columnaLocal}`;
      definicionesInternas.push(
        `  CONSTRAINT "${nombreConstraint}" FOREIGN KEY ("${fk.columnaLocal}") REFERENCES "${fk.tablaReferenciada}" ("${fk.columnaReferenciada}") ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`
      );
    }

    lineas.push(definicionesInternas.join(',\n'));
    lineas.push(');');
    lineas.push('');

    // Comentarios de tabla ANSI en PostgreSQL
    if (incluirComentarios && tabla.comentario) {
      comentariosSentencias.push(
        `COMMENT ON TABLE "${tabla.nombre}" IS '${escaparLiteralSQL(tabla.comentario)}';`
      );
    }
  }

  // Si hay comentarios ANSI estructurados en PostgreSQL, agregarlos al final
  if (incluirComentarios && comentariosSentencias.length > 0) {
    lineas.push('-- ============================================================================');
    lineas.push('-- METADATOS Y COMENTARIOS DIDÁCTICOS (Estándar ANSI / PostgreSQL)');
    lineas.push('-- ============================================================================');
    lineas.push(...comentariosSentencias);
    lineas.push('');
  }

  return lineas.join('\n').trim();
}

/**
 * Valida la sintaxis del script DDL generado usando el parser AST de SQL (node-sql-parser)
 * configurado para el dialecto PostgreSQL.
 */
export function validarScriptPostgres(ddl: string): { valido: boolean; error?: string } {
  try {
    const parser = new ParserConstructor();
    if (!ddl || !ddl.trim()) {
      return { valido: true };
    }

    parser.astify(ddl, { database: 'PostgresQL' });
    return { valido: true };
  } catch (err) {
    return {
      valido: false,
      error: err instanceof Error ? err.message : 'Error de sintaxis SQL en el script PostgreSQL generado.',
    };
  }
}

/**
 * Genera una explicación pedagógica deductiva local a partir de la estructura del modelo para PostgreSQL.
 */
export function generarExplicacionDDLPostgresLocal(
  modelo: Modelo,
  _ddl?: string
): ExplicacionDDL {
  const explicacionPorTabla = modelo.entidades.map((ent) => {
    const pk = ent.atributos.find((a) => a.esClavePrimaria);
    const fks = ent.atributos.filter(
      (a) =>
        (a.nombre.toLowerCase().startsWith('id_') || a.nombre.toLowerCase().endsWith('_id')) &&
        !a.esClavePrimaria
    );

    const detalleClaves = pk
      ? `Clave primaria: "${pk.nombre}" (tipo SERIAL / INTEGER autoincremental). ${
          fks.length > 0
            ? `Claves foráneas: ${fks.map((f) => `"${f.nombre}"`).join(', ')} con restricciones CONSTRAINT para integridad referencial estricta.`
            : 'Tabla independiente o catálogo principal.'
        }`
      : 'Tabla asociativa con clave primaria compuesta.';

    const tiposDestacados = ent.atributos
      .map((a) => `${a.nombre} -> ${mapearTipoConceptualAPostgres(a.tipoConceptual)}`)
      .slice(0, 3)
      .join(', ');

    return {
      tabla: sanitizarIdentificadorSQL(ent.nombre),
      explicacion: `Estructura relacional de "${ent.nombre}" en PostgreSQL. Aplica tipos nativos estrictos (${tiposDestacados}) y comentarios descriptivos con COMMENT ON.`,
      detalleClaves,
    };
  });

  return {
    resumenPedagogico:
      'El script DDL traduce el modelo al dialecto PostgreSQL aplicando tipado estricto (SERIAL, VARCHAR, NUMERIC, TIMESTAMP, BOOLEAN) y restricciones nombradas (CONSTRAINT fk_...) que garantizan integridad referencial de estándar ANSI.',
    explicacionPorTabla,
    observacionesTutor: [
      'En PostgreSQL el tipo SERIAL crea internamente un objeto secuencia (SEQUENCE) que gestiona números correlativos únicos sin posibilidad de colisión.',
      'A diferencia de SQLite, PostgreSQL posee tipos nativos como BOOLEAN (true/false) y NUMERIC(10, 2), evitando emulaciones o pérdidas de precisión en valores monetarios.',
      'Nombrar explícitamente las claves foráneas con CONSTRAINT facilita el diagnóstico pedagógico cuando una inserción o borrado viola una regla de integridad referencial.',
      'Este script es 100% compatible con PGlite, lo que permite ejecutar PostgreSQL real compilado a WebAssembly directamente dentro de tu navegador.',
    ],
  };
}

/**
 * Solicita al tutor IA (Gemini / OpenRouter) una explicación pedagógica para PostgreSQL.
 */
export async function pedirExplicacionDDLPostgresConIA(params: {
  ddl: string;
  modelo: Modelo;
}): Promise<ExplicacionDDL> {
  const { ddl, modelo } = params;
  const nombresEntidades = modelo.entidades.map((e) => e.nombre).join(', ');

  const promptUsuario = `
Actuá como tutor experto en diseño de bases de datos relacionales y PostgreSQL.
El estudiante confirmó el modelo conceptual con las entidades: ${nombresEntidades}.

Se generó el siguiente script DDL determinístico para PostgreSQL:
\`\`\`sql
${ddl}
\`\`\`

Tu misión es explicar:
1. Resumen pedagógico del diseño físico en PostgreSQL.
2. Para cada tabla: propósito didáctico, elección de tipos estrictos (SERIAL, VARCHAR, NUMERIC, BOOLEAN) y claves foráneas.
3. Observaciones didácticas sobre buenas prácticas en PostgreSQL y el uso de PGlite en el navegador.

Respondé ÚNICAMENTE con un objeto JSON válido con esta estructura exacta:
{
  "resumenPedagogico": "Resumen conceptual claro sobre el script DDL generado para PostgreSQL",
  "explicacionPorTabla": [
    {
      "tabla": "nombre_de_la_tabla",
      "explicacion": "Propósito didáctico y justificación de tipos de datos",
      "detalleClaves": "Explicación de sus claves primarias y foráneas"
    }
  ],
  "observacionesTutor": [
    "Observación 1 sobre SERIAL o tipos de datos nativos",
    "Observación 2 sobre buenas prácticas en PostgreSQL"
  ]
}
`.trim();

  try {
    return await consultarGeminiEstructurado<ExplicacionDDL>({
      systemInstruction: systemTutorPrompt,
      prompt: promptUsuario,
      schema: ExplicacionDDLSchema,
    });
  } catch (error) {
    console.warn(
      'Fallo en la explicación de PostgreSQL con IA externa; activando generador didáctico local:',
      error
    );
    return generarExplicacionDDLPostgresLocal(modelo, ddl);
  }
}
