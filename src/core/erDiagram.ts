import { Atributo, Entidad, Modelo, Relacion, TipoConceptual } from './schemas';

/**
 * Mapeo de tipos conceptuales del modelo hacia tipos de datos estandarizados de Mermaid ER.
 */
export function mapearTipoConceptualAMermaid(tipo: TipoConceptual): string {
  switch (tipo) {
    case 'texto':
      return 'string';
    case 'entero':
      return 'int';
    case 'decimal':
      return 'float';
    case 'fecha':
      return 'date';
    case 'fecha_hora':
      return 'datetime';
    case 'booleano':
      return 'boolean';
    default:
      return 'string';
  }
}

/**
 * Normaliza el nombre de una entidad para que sea un identificador válido en la sintaxis Mermaid ER.
 * Reemplaza espacios y guiones con guiones bajos y elimina caracteres no válidos.
 */
export function normalizarIdentificadorEntidad(nombre: string): string {
  const limpio = nombre
    .trim()
    .replace(/[\s-]+/g, '_')
    .replace(/[^\p{L}\p{N}_]/gu, '');
  return limpio || 'ENTIDAD';
}

/**
 * Normaliza el nombre de un atributo para que sea un identificador válido en la sintaxis Mermaid ER.
 */
export function normalizarIdentificadorAtributo(nombre: string): string {
  const limpio = nombre
    .trim()
    .replace(/[\s-]+/g, '_')
    .replace(/[^\p{L}\p{N}_]/gu, '');
  return limpio || 'campo';
}

/**
 * Determina los símbolos de cardinalidad Mermaid para una relación:
 *
 * Lado Origen:
 * - '1' obligatoria:  `||` (exactamente 1)
 * - '1' opcional:     `|o` (cero o 1)
 * - 'N' obligatoria:  `}|` (uno o más)
 * - 'N' opcional:     `}o` (cero o más)
 *
 * Lado Destino:
 * - '1' obligatoria:  `||` (exactamente 1)
 * - '1' opcional:     `o|` (cero o 1)
 * - 'N' obligatoria:  `|{` (uno o más)
 * - 'N' opcional:     `o{` (cero o más)
 */
export function obtenerSimbolosCardinalidad(rel: Relacion): {
  simboloOrigen: string;
  simboloDestino: string;
  conectorMermaid: string;
} {
  const esOrigenN = rel.cardinalidad === 'N:M';
  const esDestinoN = rel.cardinalidad === '1:N' || rel.cardinalidad === 'N:M';

  const simboloOrigen = esOrigenN
    ? rel.obligatoriaEnOrigen
      ? '}|'
      : '}o'
    : rel.obligatoriaEnOrigen
      ? '||'
      : '|o';

  const simboloDestino = esDestinoN
    ? rel.obligatoriaEnDestino
      ? '|{'
      : 'o{'
    : rel.obligatoriaEnDestino
      ? '||'
      : 'o|';

  return {
    simboloOrigen,
    simboloDestino,
    conectorMermaid: `${simboloOrigen}--${simboloDestino}`,
  };
}

/**
 * Detecta qué atributos de cada entidad funcionan como Clave Foránea (FK) en base al modelo:
 * - En relaciones 1:N, la entidad destino (lado N) almacena la FK referenciando a la entidad origen.
 * - En relaciones 1:1, si la entidad destino tiene un atributo coincidente.
 * - Si el atributo contiene el nombre de la entidad origen o coincide con su PK.
 */
export function detectarClavesForaneas(modelo: Modelo): Map<string, Set<string>> {
  const fksPorEntidad = new Map<string, Set<string>>();

  for (const ent of modelo.entidades) {
    fksPorEntidad.set(normalizarIdentificadorEntidad(ent.nombre), new Set<string>());
  }

  const entidadesMap = new Map<string, Entidad>();
  for (const ent of modelo.entidades) {
    entidadesMap.set(normalizarIdentificadorEntidad(ent.nombre).toLowerCase(), ent);
  }

  for (const rel of modelo.relaciones) {
    const origenNorm = normalizarIdentificadorEntidad(rel.origen);
    const destinoNorm = normalizarIdentificadorEntidad(rel.destino);
    const fksDestino = fksPorEntidad.get(destinoNorm);
    if (!fksDestino) continue;

    const entOrigen = entidadesMap.get(origenNorm.toLowerCase());
    const pkOrigen = entOrigen?.atributos.find((a) => a.esClavePrimaria);

    const entDestino = entidadesMap.get(destinoNorm.toLowerCase());
    if (!entDestino) continue;

    for (const attr of entDestino.atributos) {
      const nombreAttrNorm = normalizarIdentificadorAtributo(attr.nombre).toLowerCase();
      const origenBase = origenNorm.toLowerCase();

      const esFKPorNombre =
        nombreAttrNorm === `id_${origenBase}` ||
        nombreAttrNorm === `${origenBase}_id` ||
        nombreAttrNorm === origenBase ||
        (pkOrigen && nombreAttrNorm === normalizarIdentificadorAtributo(pkOrigen.nombre).toLowerCase() && !attr.esClavePrimaria) ||
        (pkOrigen && nombreAttrNorm.includes(origenBase) && nombreAttrNorm.includes('id'));

      if (esFKPorNombre) {
        fksDestino.add(normalizarIdentificadorAtributo(attr.nombre));
      }
    }
  }

  return fksPorEntidad;
}

/**
 * Determina las marcas de clave para un atributo en Mermaid:
 * - `PK`: Clave primaria
 * - `FK`: Clave foránea
 * - `PK, FK`: Clave primaria compuesta que a su vez es foránea (ej. tabla asociativa)
 * - `UK`: Clave única (Unique Key) cuando no es PK
 * - '': Sin marca especial
 */
export function obtenerFlagsClave(
  atributo: Atributo,
  nombreAtributoNorm: string,
  fksDeLaEntidad: Set<string>
): string {
  const esPK = atributo.esClavePrimaria;
  const esFK = fksDeLaEntidad.has(nombreAtributoNorm);

  if (esPK && esFK) {
    return 'PK, FK';
  }
  if (esPK) {
    return 'PK';
  }
  if (esFK) {
    return 'FK';
  }
  if (atributo.unico) {
    return 'UK';
  }
  return '';
}

/**
 * Sanitiza el comentario de un atributo o etiqueta de relación para no romper la sintaxis Mermaid.
 */
export function sanitizarTextoMermaid(texto: string): string {
  return texto
    .replace(/["\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface OpcionesGeneracionEr {
  incluirTipos?: boolean;
  incluirComentarios?: boolean;
}

/**
 * Genera el código de diagrama Mermaid ER en modo estricto a partir de un Modelo confirmado.
 * El modelo es la única fuente de verdad; no depende de texto libre de la IA.
 */
export function generarMermaidEr(
  modelo: Modelo,
  opciones: OpcionesGeneracionEr = { incluirTipos: true, incluirComentarios: true }
): string {
  const lineas: string[] = ['erDiagram'];

  if (modelo.entidades.length === 0 && modelo.relaciones.length === 0) {
    return lineas.join('\n');
  }

  // 1. Relaciones
  if (modelo.relaciones.length > 0) {
    lineas.push('');
    lineas.push('    %% Relaciones del modelo relacional');
    for (const rel of modelo.relaciones) {
      const origenNorm = normalizarIdentificadorEntidad(rel.origen);
      const destinoNorm = normalizarIdentificadorEntidad(rel.destino);
      const { conectorMermaid } = obtenerSimbolosCardinalidad(rel);
      const descLimpia = sanitizarTextoMermaid(rel.descripcion) || 'se relaciona con';

      lineas.push(`    ${origenNorm} ${conectorMermaid} ${destinoNorm} : "${descLimpia}"`);
    }
  }

  // 2. Entidades y Atributos
  const fksPorEntidad = detectarClavesForaneas(modelo);

  if (modelo.entidades.length > 0) {
    lineas.push('');
    lineas.push('    %% Entidades y definiciones de atributos');
    for (const ent of modelo.entidades) {
      const entNorm = normalizarIdentificadorEntidad(ent.nombre);
      const fksEntidad = fksPorEntidad.get(entNorm) || new Set<string>();

      lineas.push(`    ${entNorm} {`);

      for (const attr of ent.atributos) {
        const attrNorm = normalizarIdentificadorAtributo(attr.nombre);
        const tipoMermaid = opciones.incluirTipos !== false
          ? mapearTipoConceptualAMermaid(attr.tipoConceptual)
          : 'string';
        const flags = obtenerFlagsClave(attr, attrNorm, fksEntidad);
        const flagsStr = flags ? ` ${flags}` : '';

        const comentarioLimpio = opciones.incluirComentarios !== false
          ? sanitizarTextoMermaid(attr.justificacion || '')
          : '';
        const comentarioStr = comentarioLimpio ? ` "${comentarioLimpio}"` : '';

        lineas.push(`        ${tipoMermaid} ${attrNorm}${flagsStr}${comentarioStr}`);
      }

      lineas.push('    }');
    }
  }

  return lineas.join('\n');
}
