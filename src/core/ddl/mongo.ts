import systemTutorPrompt from '../../prompts/system_tutor.md?raw';
import { consultarGeminiEstructurado } from '../gemini';
import {
  ConjuntoDatosEjemplo,
  ExplicacionDDL,
  ExplicacionDDLSchema,
  Modelo,
  OpcionesGeneracionDDL,
  TipoConceptual,
} from '../schemas';
import { buscarAtributoFK, normalizar } from './common';

/**
 * Sanitiza identificadores de colecciones y campos en MongoDB.
 * MongoDB permite casi cualquier carácter UTF-8 en nombres de campo, pero por convención
 * didáctica y compatibilidad con drivers BSON usamos snake_case sin caracteres especiales ni espacios.
 */
export function sanitizarIdentificadorMongo(identificador: string): string {
  const limpio = identificador
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^\p{L}\p{N}_]/gu, '');
  return limpio || 'campo';
}

/**
 * Mapeo pedagógico de tipos conceptuales a tipos nativos BSON de MongoDB.
 *
 * Mapeo didáctico:
 * - texto      -> string (Cadena de caracteres UTF-8)
 * - entero     -> int (Entero de 32 bits, NumberInt en mongosh)
 * - decimal    -> double (Número flotante IEEE 754 de 64 bits o decimal BSON)
 * - fecha      -> date (Fecha y hora BSON / ISODate)
 * - fecha_hora -> date (Fecha y hora con zona horaria UTC)
 * - booleano   -> bool (Booleano nativo BSON true / false)
 */
export function mapearTipoConceptualABSON(tipo: TipoConceptual): {
  bsonType: string;
  ejemploValor: any;
  descripcionDidactica: string;
} {
  switch (tipo) {
    case 'texto':
      return {
        bsonType: 'string',
        ejemploValor: 'Texto de ejemplo',
        descripcionDidactica: 'Cadena de caracteres UTF-8 (BSON string)',
      };
    case 'entero':
      return {
        bsonType: 'int',
        ejemploValor: 1,
        descripcionDidactica: 'Número entero de 32 bits (BSON int o NumberInt)',
      };
    case 'decimal':
      return {
        bsonType: 'double',
        ejemploValor: 99.99,
        descripcionDidactica: 'Número de coma flotante de doble precisión (BSON double)',
      };
    case 'fecha':
      return {
        bsonType: 'date',
        ejemploValor: '2025-01-15T00:00:00.000Z',
        descripcionDidactica: 'Fecha BSON (ISODate sin hora relevante)',
      };
    case 'fecha_hora':
      return {
        bsonType: 'date',
        ejemploValor: '2025-01-15T14:30:00.000Z',
        descripcionDidactica: 'Fecha y hora con marca temporal BSON (ISODate UTC)',
      };
    case 'booleano':
      return {
        bsonType: 'bool',
        ejemploValor: true,
        descripcionDidactica: 'Valor de verdad booleano nativo (BSON bool: true o false)',
      };
    default:
      return {
        bsonType: 'string',
        ejemploValor: 'Valor por defecto',
        descripcionDidactica: 'Tipo cadena por compatibilidad genérica',
      };
  }
}

/**
 * Análisis pedagógico de la disyuntiva central en bases de datos orientadas a documentos:
 * Embeber (Embedding / Subdocumentos) vs. Referenciar (Referencing / $lookup).
 */
export interface AnalisisEmbeberVsReferenciar {
  entidadPrincipal: string;
  entidadRelacionada: string;
  cardinalidad: '1:1' | '1:N' | 'N:M';
  estrategiaRecomendada: 'embeber' | 'referenciar';
  justificacionPedagogica: string;
  ejemploEstructura: string;
}

/**
 * Analiza cada relación del modelo conceptual y emite una recomendación didáctica
 * sobre si conviene embeber (subdocumento o array) o referenciar (mediante _id / FK).
 */
export function analizarEmbeberVsReferenciar(modelo: Modelo): AnalisisEmbeberVsReferenciar[] {
  const resultados: AnalisisEmbeberVsReferenciar[] = [];

  for (const rel of modelo.relaciones) {
    if (rel.cardinalidad === '1:1') {
      resultados.push({
        entidadPrincipal: rel.origen,
        entidadRelacionada: rel.destino,
        cardinalidad: '1:1',
        estrategiaRecomendada: 'embeber',
        justificacionPedagogica: `En una relación 1:1 entre "${rel.origen}" y "${rel.destino}", embeber "${rel.destino}" como subdocumento dentro de "${rel.origen}" garantiza lecturas atómicas de toda la entidad en una sola operación sin necesidad de $lookup. Solo convendría referenciar si "${rel.destino}" contiene datos masivos que rara vez se consultan.`,
        ejemploEstructura: `{ _id: ObjectId(...), ..., ${sanitizarIdentificadorMongo(rel.destino)}: { ...campos de ${rel.destino}... } }`,
      });
    } else if (rel.cardinalidad === '1:N') {
      // Regla didáctica: Si el destino parece una entidad dependiente / contenida (detalle, teléfono, item, dirección)
      const nombreDestinoNorm = normalizar(rel.destino);
      const pareceContenido =
        nombreDestinoNorm.includes('detalle') ||
        nombreDestinoNorm.includes('item') ||
        nombreDestinoNorm.includes('linea') ||
        nombreDestinoNorm.includes('direccion') ||
        nombreDestinoNorm.includes('telefono') ||
        nombreDestinoNorm.includes('foto');

      if (pareceContenido) {
        resultados.push({
          entidadPrincipal: rel.origen,
          entidadRelacionada: rel.destino,
          cardinalidad: '1:N',
          estrategiaRecomendada: 'embeber',
          justificacionPedagogica: `Los elementos de "${rel.destino}" son íntimamente dependientes de "${rel.origen}" y su cantidad por documento es acotada. Embeberlos como un array de subdocumentos evita JOINs ($lookup), mantiene la integridad transaccional dentro del documento y no corre riesgo de superar el límite de 16 MB de BSON.`,
          ejemploEstructura: `{ _id: ObjectId(...), ..., ${sanitizarIdentificadorMongo(rel.destino)}: [ { ...item 1... }, { ...item 2... } ] }`,
        });
      } else {
        resultados.push({
          entidadPrincipal: rel.origen,
          entidadRelacionada: rel.destino,
          cardinalidad: '1:N',
          estrategiaRecomendada: 'referenciar',
          justificacionPedagogica: `Entre "${rel.origen}" y "${rel.destino}", cada "${rel.destino}" posee identidad propia y su cantidad puede crecer de forma ilimitada (unbounded 1:N). Conviene referenciar guardando "${sanitizarIdentificadorMongo(rel.origen)}_id" en la colección "${sanitizarIdentificadorMongo(rel.destino)}" e indexar ese campo para consultas eficientes con $lookup. Esto evita sobrepasar el límite de 16 MB por documento en MongoDB.`,
          ejemploEstructura: `En colección "${sanitizarIdentificadorMongo(rel.destino)}": { _id: ObjectId(...), ${sanitizarIdentificadorMongo(rel.origen)}_id: ObjectId(...), ... }`,
        });
      }
    } else if (rel.cardinalidad === 'N:M') {
      resultados.push({
        entidadPrincipal: rel.origen,
        entidadRelacionada: rel.destino,
        cardinalidad: 'N:M',
        estrategiaRecomendada: 'referenciar',
        justificacionPedagogica: `En una asociación Muchos a Muchos (N:M) entre "${rel.origen}" y "${rel.destino}", MongoDB permite evitar la rígida tabla asociativa de SQL guardando un array de referencias (IDs) en una o ambas colecciones (Two-Way Referencing), o manteniendo colecciones independientes cruzadas mediante agregaciones con $lookup.`,
        ejemploEstructura: `{ _id: ObjectId(...), ${sanitizarIdentificadorMongo(rel.destino)}_ids: [ ObjectId(...), ObjectId(...) ] }`,
      });
    }
  }

  return resultados;
}

/**
 * Representación intermedia de una propiedad BSON en el validador JSON Schema.
 */
export interface DefinicionPropiedadMongo {
  nombre: string;
  bsonType: string;
  esPK: boolean;
  obligatorio: boolean;
  unico: boolean;
  enumValores?: string[];
  descripcion: string;
  referencia?: {
    coleccionPadre: string;
    campoPadre: string;
  };
}

/**
 * Representación intermedia de un índice sugerido en MongoDB.
 */
export interface DefinicionIndiceMongo {
  nombre: string;
  campos: Record<string, 1 | -1>;
  unico?: boolean;
  motivoPedagogico: string;
}

/**
 * Representación intermedia de una colección de MongoDB con su JSON Schema e índices.
 */
export interface DefinicionColeccionMongo {
  nombre: string;
  descripcion: string;
  propiedades: DefinicionPropiedadMongo[];
  camposRequeridos: string[];
  indicesSugeridos: DefinicionIndiceMongo[];
  analisisRelaciones: AnalisisEmbeberVsReferenciar[];
}

/**
 * Construye la representación intermedia de colecciones MongoDB a partir del modelo conceptual.
 */
export function construirDefinicionesMongo(
  modelo: Modelo,
  _opciones?: Partial<OpcionesGeneracionDDL>
): DefinicionColeccionMongo[] {
  const colecciones: DefinicionColeccionMongo[] = [];
  const analisisRelaciones = analizarEmbeberVsReferenciar(modelo);

  // Mapa de entidades normalizado
  const entidadesMap = new Map<string, typeof modelo.entidades[0]>();
  modelo.entidades.forEach((e) => entidadesMap.set(normalizar(e.nombre), e));

  for (const ent of modelo.entidades) {
    const nombreColeccion = sanitizarIdentificadorMongo(ent.nombre);
    const camposRequeridos: string[] = [];
    const indicesSugeridos: DefinicionIndiceMongo[] = [];

    const propiedades: DefinicionPropiedadMongo[] = ent.atributos.map((attr) => {
      const nombreCampo = sanitizarIdentificadorMongo(attr.nombre);
      const mapeo = mapearTipoConceptualABSON(attr.tipoConceptual);

      if (attr.obligatorio || attr.esClavePrimaria) {
        camposRequeridos.push(nombreCampo);
      }

      // Índices únicos sugeridos
      if (attr.esClavePrimaria) {
        indicesSugeridos.push({
          nombre: `idx_${nombreColeccion}_${nombreCampo}_pk`,
          campos: { [nombreCampo]: 1 },
          unico: true,
          motivoPedagogico: `Índice único para la clave primaria de negocio "${attr.nombre}" (complementa o sustituye al _id autogenerado de MongoDB).`,
        });
      } else if (attr.unico) {
        indicesSugeridos.push({
          nombre: `idx_${nombreColeccion}_${nombreCampo}_unique`,
          campos: { [nombreCampo]: 1 },
          unico: true,
          motivoPedagogico: `Garantiza unicidad a nivel de colección para el campo "${attr.nombre}" (ej: correo electrónico, DNI o código).`,
        });
      }

      return {
        nombre: nombreCampo,
        bsonType: mapeo.bsonType,
        esPK: attr.esClavePrimaria,
        obligatorio: attr.obligatorio || attr.esClavePrimaria,
        unico: attr.unico,
        enumValores: attr.valoresPermitidos,
        descripcion:
          attr.justificacion ||
          `${attr.nombre}: ${mapeo.descripcionDidactica}${attr.esClavePrimaria ? ' (Clave Primaria)' : ''}`,
      };
    });

    // Detectar campos de referencia (claves foráneas) por relaciones 1:N y 1:1
    for (const rel of modelo.relaciones) {
      if (rel.cardinalidad === '1:N' || rel.cardinalidad === '1:1') {
        if (normalizar(rel.destino) === normalizar(ent.nombre)) {
          const padre = entidadesMap.get(normalizar(rel.origen));
          if (padre) {
            const fk = buscarAtributoFK(ent, padre, rel);
            if (fk) {
              const campoLocal = sanitizarIdentificadorMongo(fk.atributoLocal);
              const prop = propiedades.find((p) => p.nombre === campoLocal);
              if (prop) {
                prop.referencia = {
                  coleccionPadre: sanitizarIdentificadorMongo(padre.nombre),
                  campoPadre: sanitizarIdentificadorMongo(fk.columnaPadre),
                };
              }

              indicesSugeridos.push({
                nombre: `idx_${nombreColeccion}_${campoLocal}_ref`,
                campos: { [campoLocal]: 1 },
                unico: false,
                motivoPedagogico: `Optimiza búsquedas y etapas de agregación $lookup hacia la colección "${sanitizarIdentificadorMongo(padre.nombre)}".`,
              });
            }
          }
        }
      }
    }

    const relacionesDeEstaColeccion = analisisRelaciones.filter(
      (a) =>
        normalizar(a.entidadPrincipal) === normalizar(ent.nombre) ||
        normalizar(a.entidadRelacionada) === normalizar(ent.nombre)
    );

    colecciones.push({
      nombre: nombreColeccion,
      descripcion: ent.descripcion || `Colección documental para ${ent.nombre}`,
      propiedades,
      camposRequeridos,
      indicesSugeridos,
      analisisRelaciones: relacionesDeEstaColeccion,
    });
  }

  return colecciones;
}

/**
 * Genera el script ejecutable para mongosh (.js) con esquemas JSON Schema, índices y documentos de ejemplo.
 */
export function generarScriptMongo(
  modelo: Modelo,
  opciones?: Partial<OpcionesGeneracionDDL>
): string {
  const incluirComentarios = opciones?.incluirComentarios ?? true;
  const colecciones = construirDefinicionesMongo(modelo, opciones);
  const analisisRelaciones = analizarEmbeberVsReferenciar(modelo);

  const lineas: string[] = [];

  // 1. Cabecera Didáctica Pedagógica
  lineas.push('/**');
  lineas.push(' * =========================================================================');
  lineas.push(' * SCRIPT DIDÁCTICO DE CREACIÓN PARA MONGODB (mongosh / MongoDB Compass)');
  lineas.push(' * Generado pedagógicamente por DB Tutor (Fase 8 — NoSQL Documental)');
  lineas.push(' * =========================================================================');
  lineas.push(' *');
  lineas.push(' * 🎓 PARADIGMA DOCUMENTAL vs. RELACIONAL:');
  lineas.push(' * 1. En MongoDB no existen "tablas" ni "filas", sino "colecciones" y "documentos BSON".');
  lineas.push(' * 2. Aunque MongoDB es schema-flexible por defecto, en entornos formales se aplican');
  lineas.push(' *    validadores $jsonSchema para garantizar integridad de tipos y requeridos.');
  lineas.push(' * 3. En lugar de foreign keys rígidas, el diseñador decide entre EMBEBER subdocumentos');
  lineas.push(' *    (para datos acotados y lecturas atómicas) o REFERENCIAR con IDs (para relaciones');
  lineas.push(' *    grandes y desacopladas que se consultan mediante agregaciones con $lookup).');
  lineas.push(' *');
  lineas.push(' * 🚀 CÓMO EJECUTAR ESTE SCRIPT:');
  lineas.push(' * - En terminal oficial: mongosh < esquema_mongodb.js');
  lineas.push(' * - O conectándote a MongoDB Compass / Atlas y abriendo la consola integrada.');
  lineas.push(' * =========================================================================');
  lineas.push(' */');
  lineas.push('');
  lineas.push('// Selección o creación de la base de datos pedagógica');
  lineas.push('const DB_NAME = "db_tutor";');
  lineas.push('const dbInstance = db.getSiblingDB(DB_NAME);');
  lineas.push('');

  // 2. Sección Didáctica de Análisis de Embeber vs. Referenciar
  if (incluirComentarios && analisisRelaciones.length > 0) {
    lineas.push('// -------------------------------------------------------------------------');
    lineas.push('// 💡 ANÁLISIS DEL TUTOR IA: ¿EMBEBER O REFERENCIAR EN ESTE DOMINIO?');
    lineas.push('// -------------------------------------------------------------------------');
    for (const rel of analisisRelaciones) {
      lineas.push(`// Relación [${rel.cardinalidad}] entre "${rel.entidadPrincipal}" y "${rel.entidadRelacionada}":`);
      lineas.push(`// 👉 Recomendación: ${rel.estrategiaRecomendada.toUpperCase()}`);
      lineas.push(`// 📝 ${rel.justificacionPedagogica}`);
      lineas.push(`// 📐 Estructura BSON sugerida: ${rel.ejemploEstructura}`);
      lineas.push('//');
    }
    lineas.push('');
  }

  // 3. Creación de cada colección con validador $jsonSchema
  for (const col of colecciones) {
    lineas.push('// =========================================================================');
    lineas.push(`// Colección: "${col.nombre}"`);
    if (col.descripcion) {
      lineas.push(`// Propósito: ${col.descripcion}`);
    }
    lineas.push('// =========================================================================');

    // Construcción del objeto $jsonSchema
    const propertiesObj: Record<string, any> = {};
    for (const prop of col.propiedades) {
      const propDef: Record<string, any> = {
        bsonType: prop.bsonType,
        description: prop.descripcion,
      };
      if (prop.enumValores && prop.enumValores.length > 0) {
        propDef.enum = prop.enumValores;
      }
      propertiesObj[prop.nombre] = propDef;
    }

    const jsonSchemaValidator = {
      $jsonSchema: {
        bsonType: 'object',
        title: `Validador de esquema para colección "${col.nombre}"`,
        required: col.camposRequeridos,
        properties: propertiesObj,
      },
    };

    const validatorFormatted = JSON.stringify(jsonSchemaValidator, null, 2);

    lineas.push(`dbInstance.createCollection("${col.nombre}", {`);
    lineas.push(`  validator: ${validatorFormatted},`);
    lineas.push('  validationLevel: "strict",');
    lineas.push('  validationAction: "error"');
    lineas.push('});');
    lineas.push('');

    // 4. Índices sugeridos
    if (col.indicesSugeridos.length > 0) {
      lineas.push(`// Índices sugeridos para optimizar consultas en "${col.nombre}":`);
      for (const idx of col.indicesSugeridos) {
        if (incluirComentarios) {
          lineas.push(`// ${idx.motivoPedagogico}`);
        }
        const fieldsJson = JSON.stringify(idx.campos);
        const optionsObj: Record<string, any> = { name: idx.nombre };
        if (idx.unico) {
          optionsObj.unique = true;
        }
        lineas.push(
          `dbInstance.${col.nombre}.createIndex(${fieldsJson}, ${JSON.stringify(optionsObj)});`
        );
      }
      lineas.push('');
    }
  }

  // 5. Inserción de documentos de ejemplo representativos
  lineas.push('// =========================================================================');
  lineas.push('// 📦 DOCUMENTOS DE EJEMPLO INICIALES (POBLADO DE PRUEBA)');
  lineas.push('// =========================================================================');

  for (const col of colecciones) {
    const docEjemplo1: Record<string, any> = {};
    const docEjemplo2: Record<string, any> = {};

    col.propiedades.forEach((prop, i) => {
      if (prop.bsonType === 'int') {
        docEjemplo1[prop.nombre] = i + 1;
        docEjemplo2[prop.nombre] = i + 2;
      } else if (prop.bsonType === 'double') {
        docEjemplo1[prop.nombre] = 25.5;
        docEjemplo2[prop.nombre] = 79.9;
      } else if (prop.bsonType === 'bool') {
        docEjemplo1[prop.nombre] = true;
        docEjemplo2[prop.nombre] = false;
      } else if (prop.bsonType === 'date') {
        docEjemplo1[prop.nombre] = 'ISODate("2025-02-01T10:00:00Z")';
        docEjemplo2[prop.nombre] = 'ISODate("2025-02-15T15:30:00Z")';
      } else if (prop.enumValores && prop.enumValores.length > 0) {
        docEjemplo1[prop.nombre] = prop.enumValores[0];
        docEjemplo2[prop.nombre] = prop.enumValores[1] ?? prop.enumValores[0];
      } else {
        docEjemplo1[prop.nombre] = `${prop.nombre} de muestra A`;
        docEjemplo2[prop.nombre] = `${prop.nombre} de muestra B`;
      }
    });

    lineas.push(`// Inserción en colección "${col.nombre}":`);
    lineas.push(`dbInstance.${col.nombre}.insertMany([`);
    lineas.push(`  ${formatearDocMongo(docEjemplo1)},`);
    lineas.push(`  ${formatearDocMongo(docEjemplo2)}`);
    lineas.push(']);');
    lineas.push('');
  }

  // 6. Ejemplo pedagógico de consulta con $lookup (el equivalente a un JOIN SQL en MongoDB)
  const coleccionConRef = colecciones.find((c) =>
    c.propiedades.some((p) => p.referencia)
  );

  if (coleccionConRef) {
    const propRef = coleccionConRef.propiedades.find((p) => p.referencia)!;
    lineas.push('// =========================================================================');
    lineas.push('// 🔍 EJEMPLO DE CONSULTA CON AGREGACIÓN ($lookup = JOIN relacional)');
    lineas.push('// Permite combinar documentos referenciados en una sola consulta estructurada.');
    lineas.push('// =========================================================================');
    lineas.push(`dbInstance.${coleccionConRef.nombre}.aggregate([`);
    lineas.push('  {');
    lineas.push('    $lookup: {');
    lineas.push(`      from: "${propRef.referencia?.coleccionPadre}",`);
    lineas.push(`      localField: "${propRef.nombre}",`);
    lineas.push(`      foreignField: "${propRef.referencia?.campoPadre}",`);
    lineas.push(`      as: "${propRef.referencia?.coleccionPadre}_info"`);
    lineas.push('    }');
    lineas.push('  },');
    lineas.push('  { $limit: 5 }');
    lineas.push(']);');
    lineas.push('');
  }

  lineas.push('print("✓ ¡Base de datos db_tutor creada e inicializada con éxito en MongoDB!");');

  return lineas.join('\n');
}

/**
 * Formatea un objeto JavaScript para código mongosh preservando constructores como ISODate.
 */
function formatearDocMongo(doc: Record<string, any>): string {
  const entradas = Object.entries(doc).map(([k, v]) => {
    if (typeof v === 'string' && v.startsWith('ISODate(')) {
      return `"${k}": new Date()`;
    }
    return `"${k}": ${JSON.stringify(v)}`;
  });
  return `{ ${entradas.join(', ')} }`;
}

/**
 * Validación estática de sintaxis y estructura para scripts de MongoDB / mongosh.
 * Comprueba balanceo de llaves, corchetes, paréntesis, presencia de createCollection y $jsonSchema.
 */
export function validarScriptMongo(script: string): {
  valido: boolean;
  error?: string;
  totalColecciones?: number;
} {
  if (!script || !script.trim()) {
    return { valido: false, error: 'El script de MongoDB está vacío.' };
  }

  // 1. Balanceo de delimitadores
  let llaves = 0;
  let corchetes = 0;
  let parentesis = 0;
  let enCadena: string | null = null;
  let enComentarioLinea = false;
  let enComentarioBloque = false;

  for (let i = 0; i < script.length; i++) {
    const char = script[i];
    const siguiente = script[i + 1];

    if (enComentarioLinea) {
      if (char === '\n') enComentarioLinea = false;
      continue;
    }

    if (enComentarioBloque) {
      if (char === '*' && siguiente === '/') {
        enComentarioBloque = false;
        i++;
      }
      continue;
    }

    if (enCadena) {
      if (char === '\\') {
        i++; // escapar siguiente
      } else if (char === enCadena) {
        enCadena = null;
      }
      continue;
    }

    if (char === '/' && siguiente === '/') {
      enComentarioLinea = true;
      i++;
      continue;
    }

    if (char === '/' && siguiente === '*') {
      enComentarioBloque = true;
      i++;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      enCadena = char;
      continue;
    }

    if (char === '{') llaves++;
    else if (char === '}') llaves--;
    else if (char === '[') corchetes++;
    else if (char === ']') corchetes--;
    else if (char === '(') parentesis++;
    else if (char === ')') parentesis--;

    if (llaves < 0 || corchetes < 0 || parentesis < 0) {
      return {
        valido: false,
        error: `Error de delimitadores en la posición ${i}: se cerró un delimitador sin abrir previamente.`,
      };
    }
  }

  if (llaves !== 0 || corchetes !== 0 || parentesis !== 0) {
    return {
      valido: false,
      error: `Error de sintaxis: delimitadores sin balancear (llaves: ${llaves}, corchetes: ${corchetes}, paréntesis: ${parentesis}).`,
    };
  }

  // 2. Verificación de llamadas de creación de colecciones
  const coincidenciasColecciones = script.match(/createCollection\s*\(\s*["']([^"']+)["']/g);
  if (!coincidenciasColecciones || coincidenciasColecciones.length === 0) {
    return {
      valido: false,
      error: 'El script no contiene sentencias db.createCollection para definir colecciones.',
    };
  }

  // 3. Verificación de validador JSON Schema
  if (!script.includes('$jsonSchema')) {
    return {
      valido: false,
      error: 'El script no incluye validadores de esquema $jsonSchema para las colecciones.',
    };
  }

  return {
    valido: true,
    totalColecciones: coincidenciasColecciones.length,
  };
}

/**
 * Genera documentos de ejemplo en formato JSON puro organizados por colección.
 * Ideal para descargar archivos .json o importarlos directamente en MongoDB Compass.
 */
export function generarDocumentosEjemploMongo(
  modelo: Modelo,
  datosEjemplo?: ConjuntoDatosEjemplo
): Record<string, any[]> {
  const resultado: Record<string, any[]> = {};
  const colecciones = construirDefinicionesMongo(modelo);

  for (const col of colecciones) {
    const tablaOrigen = datosEjemplo?.tablas.find(
      (t) => normalizar(t.tabla) === normalizar(col.nombre)
    );

    if (tablaOrigen && tablaOrigen.filas.length > 0) {
      // Convertir tipos de datos relacionales al formato JSON adecuado para MongoDB
      resultado[col.nombre] = tablaOrigen.filas.map((fila, idx) => {
        const doc: Record<string, any> = { _id: `obj_${col.nombre}_${idx + 1}` };
        for (const prop of col.propiedades) {
          const valorCrudo = fila[prop.nombre] ?? fila[normalizar(prop.nombre)];
          if (valorCrudo !== undefined) {
            if (prop.bsonType === 'int') {
              doc[prop.nombre] = Number.parseInt(String(valorCrudo), 10) || 0;
            } else if (prop.bsonType === 'double') {
              doc[prop.nombre] = Number.parseFloat(String(valorCrudo)) || 0.0;
            } else if (prop.bsonType === 'bool') {
              doc[prop.nombre] = Boolean(valorCrudo);
            } else {
              doc[prop.nombre] = valorCrudo;
            }
          } else {
            const def = mapearTipoConceptualABSON('texto');
            doc[prop.nombre] = def.ejemploValor;
          }
        }
        return doc;
      });
    } else {
      // Fallback determinístico con 2 documentos de muestra
      resultado[col.nombre] = [1, 2].map((num) => {
        const doc: Record<string, any> = { _id: `obj_${col.nombre}_${num}` };
        for (const prop of col.propiedades) {
          if (prop.bsonType === 'int') doc[prop.nombre] = num;
          else if (prop.bsonType === 'double') doc[prop.nombre] = num * 19.99;
          else if (prop.bsonType === 'bool') doc[prop.nombre] = num % 2 === 1;
          else if (prop.bsonType === 'date') doc[prop.nombre] = '2025-01-15T00:00:00Z';
          else if (prop.enumValores && prop.enumValores.length > 0)
            doc[prop.nombre] = prop.enumValores[0];
          else doc[prop.nombre] = `${prop.nombre}_ejemplo_${num}`;
        }
        return doc;
      });
    }
  }

  return resultado;
}

/**
 * Generador didáctico local de respaldo para MongoDB (offline o fallback ante error de IA externa).
 */
export function generarExplicacionDDLMongoLocal(
  modelo: Modelo,
  _script?: string
): ExplicacionDDL {
  const colecciones = construirDefinicionesMongo(modelo);
  const analisis = analizarEmbeberVsReferenciar(modelo);

  const explicacionPorTabla = colecciones.map((col) => {
    const tiposResumen = col.propiedades
      .map((p) => `${p.nombre} (${p.bsonType})`)
      .join(', ');

    const indicesResumen =
      col.indicesSugeridos.length > 0
        ? `Índices definidos: ${col.indicesSugeridos.map((i) => i.nombre).join(', ')}.`
        : 'Colección sin índices secundarios explícitos.';

    const analisisCol = col.analisisRelaciones
      .map((a) => `[${a.cardinalidad}] con "${a.entidadRelacionada}": se sugiere ${a.estrategiaRecomendada}.`)
      .join(' ');

    return {
      tabla: col.nombre,
      explicacion: `Colección de documentos JSON/BSON validados con $jsonSchema. Campos: ${tiposResumen}. ${analisisCol || 'Colección principal sin dependencias complejas.'}`,
      detalleClaves: `Estructura documental: ${indicesResumen} Requeridos: [${col.camposRequeridos.join(', ')}].`,
    };
  });

  const observacionesTutor: string[] = [
    'MongoDB es una base de datos NoSQL documental: los datos se almacenan en documentos BSON con tipos nativos (string, int, double, date, bool).',
    'La decisión de EMBEBER vs. REFERENCIAR es el núcleo del diseño NoSQL: embebé si los datos se consultan siempre juntos y el array es acotado; referenciá si crece indefinidamente para no superar los 16 MB por documento.',
    'Se incluyó el validador estricto $jsonSchema en db.createCollection para proteger la integridad de tipos sin perder la flexibilidad documental de MongoDB.',
    'Los índices únicos en claves primarias y campos de referencia aseguran consultas de alta velocidad y optimizan agregaciones con $lookup.',
    'Al ser un motor cliente/servidor nativo (WiredTiger), MongoDB no se ejecuta directamente en el navegador web estático. Podés correr este script (.js) en mongosh o MongoDB Compass.',
  ];

  if (analisis.length > 0) {
    const recomendacionesTexto = analisis
      .map((a) => `${a.entidadPrincipal} -> ${a.entidadRelacionada} (${a.estrategiaRecomendada})`)
      .join('; ');
    observacionesTutor.unshift(`Estrategia de modelado documental recomendada: ${recomendacionesTexto}.`);
  }

  return {
    resumenPedagogico: `El script generado traduce el modelo relacional al paradigma NoSQL documental de MongoDB, definiendo ${colecciones.length} colecciones protegidas con validadores $jsonSchema, índices sugeridos y una estrategia fundamentada de embebido vs. referenciado.`,
    explicacionPorTabla,
    observacionesTutor,
  };
}

/**
 * Solicita al tutor IA (Gemini / OpenRouter) una explicación pedagógica adaptada para MongoDB.
 */
export async function pedirExplicacionDDLMongoConIA(params: {
  script: string;
  modelo: Modelo;
}): Promise<ExplicacionDDL> {
  const { script, modelo } = params;
  const nombresEntidades = modelo.entidades.map((e) => e.nombre).join(', ');

  const promptUsuario = `
Actuá como tutor experto en bases de datos NoSQL y MongoDB.
El estudiante confirmó un modelo conceptual con las entidades: ${nombresEntidades}.

Se generó el siguiente script pedagógico para MongoDB (mongosh):
\`\`\`javascript
${script}
\`\`\`

Tu misión didáctica es explicar:
1. Resumen pedagógico del diseño documental en MongoDB (cambio de paradigma respecto a SQL).
2. Para cada colección: propósito de la colección, campos principales con sus tipos BSON, validador $jsonSchema y la decisión de EMBEBER vs. REFERENCIAR en sus relaciones.
3. Observaciones y consejos didácticos sobre buenas prácticas en MongoDB (límite de 16 MB de BSON, uso de índices, cuándo usar $lookup y cómo ejecutar este script en mongosh o MongoDB Compass).

Respondé ÚNICAMENTE con un objeto JSON válido con esta estructura exacta:
{
  "resumenPedagogico": "Resumen conceptual claro sobre el script de MongoDB generado y el cambio de paradigma NoSQL",
  "explicacionPorTabla": [
    {
      "tabla": "nombre_de_la_coleccion",
      "explicacion": "Propósito documental, justificación de tipos BSON y estrategia de embeber vs referenciar",
      "detalleClaves": "Validación con $jsonSchema e índices sugeridos"
    }
  ],
  "observacionesTutor": [
    "Consejo 1 sobre la decisión de embeber vs referenciar y el límite de 16 MB",
    "Consejo 2 sobre agregaciones con $lookup e índices",
    "Consejo 3 sobre la ejecución del script en mongosh o Compass"
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
      'Fallo en la explicación de MongoDB con IA externa; activando generador didáctico local:',
      error
    );
    return generarExplicacionDDLMongoLocal(modelo, script);
  }
}
