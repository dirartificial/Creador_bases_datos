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
 * Mapea el tipo conceptual del modelo al tipo de datos estándar de MySQL / MariaDB (InnoDB).
 *
 * Mapeo didáctico:
 * - texto      -> VARCHAR(255)
 * - entero     -> INT (o INT AUTO_INCREMENT para PKs autoincrementales)
 * - decimal    -> DECIMAL(10, 2) (formato de coma fija estándar para precisión matemática)
 * - fecha      -> DATE (formato YYYY-MM-DD)
 * - fecha_hora -> DATETIME (formato YYYY-MM-DD HH:MM:SS)
 * - booleano   -> BOOLEAN (en MySQL es sinónimo de TINYINT(1) con valores 0 y 1)
 */
export function mapearTipoConceptualAMySQL(tipo: TipoConceptual): string {
  switch (tipo) {
    case 'texto':
      return 'VARCHAR(255)';
    case 'entero':
      return 'INT';
    case 'decimal':
      return 'DECIMAL(10, 2)';
    case 'fecha':
      return 'DATE';
    case 'fecha_hora':
      return 'DATETIME';
    case 'booleano':
      return 'BOOLEAN';
    default:
      return 'VARCHAR(255)';
  }
}

/**
 * Construye la representación intermedia de tablas SQL adaptada para MySQL.
 */
export function construirDefinicionesTablasMySQL(
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
      const tipoSQL = mapearTipoConceptualAMySQL(attr.tipoConceptual);
      const esPK = attr.esClavePrimaria;
      const esAutoincrement = esPK && esSinglePK && attr.tipoConceptual === 'entero';

      let checkExpr: string | undefined;
      const colSanitizada = sanitizarIdentificadorSQL(attr.nombre);

      if (attr.valoresPermitidos && attr.valoresPermitidos.length > 0) {
        const valoresEscapados = attr.valoresPermitidos
          .map((v) => `'${escaparLiteralSQL(v)}'`)
          .join(', ');
        checkExpr = `\`${colSanitizada}\` IN (${valoresEscapados})`;
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

  // 2. Relaciones N:M que no tienen tabla intermedia en el modelo
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
                  ? mapearTipoConceptualAMySQL(pkOrigen.tipoConceptual)
                  : 'INT',
                esPK: true,
                esAutoincrement: false,
                nullable: false,
                unico: false,
                justificacion: `Clave foránea hacia "${entOrigen.nombre}".`,
              },
              {
                nombre: colDestino,
                tipoSQL: pkDestino
                  ? mapearTipoConceptualAMySQL(pkDestino.tipoConceptual)
                  : 'INT',
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
            comentario: `Tabla asociativa intermedia generada automáticamente para resolver la relación N:M entre "${entOrigen.nombre}" y "${entDestino.nombre}".`,
          };

          tablas.push(tablaIntermedia);
        }
      }
    }
  }

  return tablas;
}

/**
 * Genera el script DDL determinístico para MySQL (InnoDB) a partir del modelo.
 */
export function generarDDLMySQL(
  modelo: Modelo,
  opciones?: Partial<OpcionesGeneracionDDL>
): string {
  const incluirComentarios = opciones?.incluirComentarios ?? true;
  const tablasCrudas = construirDefinicionesTablasMySQL(modelo, opciones);
  const { tablasOrdenadas } = ordenarTablasTopologicamente(tablasCrudas);

  const lineas: string[] = [];

  if (incluirComentarios) {
    lineas.push('-- ============================================================================');
    lineas.push('-- SCRIPT DDL DETERMINÍSTICO PARA MYSQL (ENGINE=InnoDB)');
    lineas.push('-- Generado por DB Tutor (Asistente Pedagógico de Diseño de Bases de Datos)');
    lineas.push('-- Compatible con MySQL 8.0+, MariaDB 10.4+, phpMyAdmin y MySQL Workbench');
    lineas.push('-- ============================================================================');
    lineas.push('');
  }

  // Desactivar temporalmente foreign_key_checks durante la creación y reactivar al final
  if (incluirComentarios) {
    lineas.push('-- Recomendado en scripts de inicialización para evitar bloqueos por orden de dependencias:');
  }
  lineas.push('SET FOREIGN_KEY_CHECKS = 0;');
  lineas.push('');

  for (const tabla of tablasOrdenadas) {
    if (incluirComentarios) {
      lineas.push('-- ----------------------------------------------------------------------------');
      lineas.push(`-- Tabla: \`${tabla.nombre}\``);
      if (tabla.comentario) {
        lineas.push(`-- Propósito: ${tabla.comentario}`);
      }
      lineas.push('-- ----------------------------------------------------------------------------');
    }

    lineas.push(`CREATE TABLE \`${tabla.nombre}\` (`);

    const definicionesInternas: string[] = [];
    const esCompuestaPK = tabla.clavesPrimarias.length > 1;

    // 1. Columnas
    for (const col of tabla.columnas) {
      const partesCol: string[] = [`  \`${col.nombre}\` ${col.tipoSQL}`];

      if (!col.nullable) {
        partesCol.push('NOT NULL');
      }

      if (col.esAutoincrement) {
        partesCol.push('AUTO_INCREMENT');
      }

      if (col.esPK && !esCompuestaPK) {
        partesCol.push('PRIMARY KEY');
      }

      if (col.unico) {
        partesCol.push('UNIQUE');
      }

      if (col.checkExpr) {
        partesCol.push(`CHECK (${col.checkExpr})`);
      }

      if (incluirComentarios && col.justificacion) {
        partesCol.push(`COMMENT '${escaparLiteralSQL(col.justificacion)}'`);
      }

      definicionesInternas.push(partesCol.join(' '));
    }

    // 2. Clave primaria compuesta
    if (esCompuestaPK) {
      const colsPK = tabla.clavesPrimarias.map((c) => `\`${c}\``).join(', ');
      definicionesInternas.push(`  PRIMARY KEY (${colsPK})`);
    }

    // 3. Claves foráneas con restricciones nombradas
    for (const fk of tabla.clavesForaneas) {
      const nombreConstraint = `fk_${tabla.nombre}_${fk.columnaLocal}`;
      definicionesInternas.push(
        `  CONSTRAINT \`${nombreConstraint}\` FOREIGN KEY (\`${fk.columnaLocal}\`) REFERENCES \`${fk.tablaReferenciada}\` (\`${fk.columnaReferenciada}\`) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`
      );
    }

    lineas.push(definicionesInternas.join(',\n'));

    // Configuración de motor de almacenamiento InnoDB y charset utf8mb4
    let cierreTabla = ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    if (incluirComentarios && tabla.comentario) {
      cierreTabla += ` COMMENT='${escaparLiteralSQL(tabla.comentario)}'`;
    }
    cierreTabla += ';';

    lineas.push(cierreTabla);
    lineas.push('');
  }

  lineas.push('SET FOREIGN_KEY_CHECKS = 1;');
  lineas.push('');

  return lineas.join('\n').trim();
}

/**
 * Valida la sintaxis del script DDL generado usando el parser AST de SQL (node-sql-parser)
 * configurado para el dialecto MySQL.
 * Omite directivas de sesión como 'SET FOREIGN_KEY_CHECKS' que son comandos del servidor MySQL.
 */
export function validarScriptMySQL(ddl: string): { valido: boolean; error?: string } {
  try {
    const parser = new ParserConstructor();
    // Filtramos las sentencias SET de MySQL para la validación estricta del DDL
    const ddlSinSets = ddl
      .split('\n')
      .filter((linea) => !linea.trim().toUpperCase().startsWith('SET '))
      .join('\n')
      .trim();

    if (!ddlSinSets) {
      return { valido: true };
    }

    parser.astify(ddlSinSets, { database: 'MySQL' });
    return { valido: true };
  } catch (err) {
    return {
      valido: false,
      error: err instanceof Error ? err.message : 'Error de sintaxis SQL en el script MySQL generado.',
    };
  }
}

/**
 * Genera una explicación pedagógica deductiva local a partir de la estructura del modelo para MySQL.
 */
export function generarExplicacionDDLMySQLLocal(
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
      ? `Clave primaria: "${pk.nombre}" (INT AUTO_INCREMENT). ${
          fks.length > 0
            ? `Claves foráneas: ${fks.map((f) => `"${f.nombre}"`).join(', ')} con restricciones CONSTRAINT para soporte relacional en InnoDB.`
            : 'Tabla maestra o catálogo principal.'
        }`
      : 'Tabla asociativa con clave primaria compuesta.';

    const tiposDestacados = ent.atributos
      .map((a) => `${a.nombre} -> ${mapearTipoConceptualAMySQL(a.tipoConceptual)}`)
      .slice(0, 3)
      .join(', ');

    return {
      tabla: sanitizarIdentificadorSQL(ent.nombre),
      explicacion: `Estructura relacional de "${ent.nombre}" configurada bajo el motor InnoDB para soporte transaccional ACID y juego de caracteres utf8mb4 (${tiposDestacados}).`,
      detalleClaves,
    };
  });

  return {
    resumenPedagogico:
      'El script DDL de MySQL define la base de datos relacional utilizando el motor transaccional InnoDB, juego de caracteres utf8mb4, claves primarias AUTO_INCREMENT y restricciones de clave foránea con integridad referencial.',
    explicacionPorTabla,
    observacionesTutor: [
      'Las columnas clave primaria configuradas con AUTO_INCREMENT generan identificadores enteros correlativos de forma atómica y única en cada INSERT.',
      'InnoDB es el motor de almacenamiento transaccional recomendado en MySQL; asegura soporte ACID y validación real de claves foráneas.',
      'El juego de caracteres utf8mb4 con collation utf8mb4_unicode_ci soporta cualquier símbolo internacional y emojis sin corrupción de datos.',
      'Las directivas SET FOREIGN_KEY_CHECKS = 0 al inicio y 1 al final facilitan la importación del script sin errores temporales por el orden de creación de tablas.',
      'Recordá que MySQL es un servidor cliente/servidor tradicional; podés importar este script en phpMyAdmin o MySQL Workbench mediante "Importar" o pegándolo en la pestaña SQL.',
    ],
  };
}

/**
 * Solicita al tutor IA (Gemini / OpenRouter) una explicación pedagógica para MySQL.
 */
export async function pedirExplicacionDDLMySQLConIA(params: {
  ddl: string;
  modelo: Modelo;
}): Promise<ExplicacionDDL> {
  const { ddl, modelo } = params;
  const nombresEntidades = modelo.entidades.map((e) => e.nombre).join(', ');

  const promptUsuario = `
Actuá como tutor experto en diseño de bases de datos relacionales y MySQL.
El estudiante confirmó el modelo conceptual con las entidades: ${nombresEntidades}.

Se generó el siguiente script DDL determinístico para MySQL (InnoDB):
\`\`\`sql
${ddl}
\`\`\`

Tu misión es explicar:
1. Resumen pedagógico del diseño físico en MySQL (InnoDB, utf8mb4).
2. Para cada tabla: propósito didáctico, elección de tipos de datos, AUTO_INCREMENT y claves foráneas.
3. Observaciones didácticas sobre buenas prácticas en MySQL y cómo ejecutar este script en phpMyAdmin o MySQL Workbench.

Respondé ÚNICAMENTE con un objeto JSON válido con esta estructura exacta:
{
  "resumenPedagogico": "Resumen conceptual claro sobre el script DDL generado para MySQL",
  "explicacionPorTabla": [
    {
      "tabla": "nombre_de_la_tabla",
      "explicacion": "Propósito didáctico y justificación de tipos de datos",
      "detalleClaves": "Explicación de sus claves primarias y foráneas"
    }
  ],
  "observacionesTutor": [
    "Observación 1 sobre ENGINE=InnoDB o AUTO_INCREMENT",
    "Observación 2 sobre importación en phpMyAdmin o Workbench"
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
      'Fallo en la explicación de MySQL con IA externa; activando generador didáctico local:',
      error
    );
    return generarExplicacionDDLMySQLLocal(modelo, ddl);
  }
}
