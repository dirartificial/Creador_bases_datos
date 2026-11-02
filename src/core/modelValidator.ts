import systemTutorPrompt from '../prompts/system_tutor.md?raw';
import { consultarGeminiEstructurado } from './gemini';
import {
  Entidad,
  Modelo,
  ObservacionDiseno,
  PropuestaRelaciones,
  PropuestaRelacionesSchema,
  Relacion,
  RespuestaExplicacionObservaciones,
  RespuestaExplicacionObservacionesSchema,
  RondaAclaracion,
} from './schemas';
import { formatearContextoRondas } from './clarity';

export type CodigoRegla =
  | 'ENTIDAD_SIN_PK'
  | 'ENTIDADES_AISLADAS'
  | 'RELACION_ENTIDAD_INEXISTENTE'
  | 'NM_SIN_TABLA_INTERMEDIA'
  | 'FK_FALTANTE'
  | 'RELACIONES_DUPLICADAS'
  | 'ATRIBUTOS_DUPLICADOS'
  | 'TABLA_INTERMEDIA_DETECTADA';

export interface AccionRapidaSugerida {
  tipo: 'crear_tabla_intermedia' | 'agregar_fk' | 'asignar_pk';
  descripcion: string;
  entidadDestino?: string;
  entidadOrigen?: string;
  relacion?: Relacion;
  atributoPropuesto?: string;
}

export interface ObservacionValidacion extends ObservacionDiseno {
  codigo: CodigoRegla;
  entidadesInvolucradas: string[];
  relacionInvolucrada?: Relacion;
  accionRapida?: AccionRapidaSugerida;
}

export interface ResultadoValidacion {
  valido: boolean;
  observaciones: ObservacionValidacion[];
  errores: ObservacionValidacion[];
  advertencias: ObservacionValidacion[];
  sugerencias: ObservacionValidacion[];
  resumen: {
    totalErrores: number;
    totalAdvertencias: number;
    totalSugerencias: number;
  };
}

/**
 * Normaliza nombres para comparaciones insensibles a mayúsculas y acentos/espacios.
 */
export function normalizarNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Determina si una entidad contiene un atributo que funcione como clave foránea (FK)
 * haciendo referencia a la clave primaria de otra entidad padre.
 */
export function tieneAtributoFK(entidadHijo: Entidad, entidadPadre: Entidad): boolean {
  const nombrePadreNorm = normalizarNombre(entidadPadre.nombre);
  const pkPadre = entidadPadre.atributos.find((a) => a.esClavePrimaria);
  const nombrePKPadreNorm = pkPadre ? normalizarNombre(pkPadre.nombre) : '';

  return entidadHijo.atributos.some((attr) => {
    const nom = normalizarNombre(attr.nombre);

    // Coincidencia exacta con el nombre de la PK del padre (ej: id_cliente en Cliente y en Mascota)
    if (nombrePKPadreNorm && nom === nombrePKPadreNorm && nombrePKPadreNorm !== 'id') {
      return true;
    }

    // Patrones típicos de claves foráneas
    if (
      nom === `id_${nombrePadreNorm}` ||
      nom === `${nombrePadreNorm}_id` ||
      nom === `id${nombrePadreNorm}` ||
      nom === `cod_${nombrePadreNorm}` ||
      nom === `${nombrePadreNorm}_cod` ||
      nom === `fk_${nombrePadreNorm}` ||
      nom === `${nombrePadreNorm}fk` ||
      nom === nombrePadreNorm
    ) {
      return true;
    }

    // Coincidencias contextuales como id_cliente_dueno
    if (
      (nom.startsWith('id_') || nom.endsWith('_id') || nom.includes('fk')) &&
      nom.includes(nombrePadreNorm)
    ) {
      return true;
    }

    return false;
  });
}

/**
 * Obtiene el nombre sugerido para una clave foránea hacia la entidad padre.
 */
export function obtenerNombreAtributoFKPropuesto(entidadPadre: Entidad): string {
  const pkPadre = entidadPadre.atributos.find((a) => a.esClavePrimaria);
  const nombrePadre = normalizarNombre(entidadPadre.nombre);

  if (pkPadre && pkPadre.nombre.toLowerCase().includes(nombrePadre)) {
    return pkPadre.nombre;
  }
  return `id_${nombrePadre}`;
}

/**
 * Regla: Verifica que cada entidad tenga al menos una clave primaria (PK).
 */
export function verificarClavesPrimarias(modelo: Modelo): ObservacionValidacion[] {
  const obs: ObservacionValidacion[] = [];

  for (const ent of modelo.entidades) {
    const tienePK = ent.atributos.some((a) => a.esClavePrimaria);
    if (!tienePK) {
      obs.push({
        codigo: 'ENTIDAD_SIN_PK',
        gravedad: 'error',
        mensaje: `La entidad "${ent.nombre}" no tiene ninguna clave primaria (PK) definida.`,
        explicacionConceptual:
          'Toda entidad relacional debe tener al menos un atributo que identifique de forma unívoca a cada registro. Sin clave primaria, ninguna otra tabla puede referenciarla mediante una clave foránea (FK).',
        entidadesInvolucradas: [ent.nombre],
        accionRapida: {
          tipo: 'asignar_pk',
          descripcion: `Marcar un atributo existente de "${ent.nombre}" como clave primaria o agregar "id_${normalizarNombre(ent.nombre)}".`,
          entidadDestino: ent.nombre,
        },
      });
    }
  }

  return obs;
}

/**
 * Regla: Detecta entidades que no participan en ninguna relación (entidades aisladas).
 */
export function verificarEntidadesAisladas(modelo: Modelo): ObservacionValidacion[] {
  const obs: ObservacionValidacion[] = [];
  if (modelo.entidades.length <= 1) {
    return obs;
  }

  const conectadas = new Set<string>();
  for (const rel of modelo.relaciones) {
    conectadas.add(normalizarNombre(rel.origen));
    conectadas.add(normalizarNombre(rel.destino));
  }

  for (const ent of modelo.entidades) {
    const nombreNorm = normalizarNombre(ent.nombre);
    if (!conectadas.has(nombreNorm)) {
      obs.push({
        codigo: 'ENTIDADES_AISLADAS',
        gravedad: 'advertencia',
        mensaje: `Entidad aislada: la entidad "${ent.nombre}" no participa en ninguna relación.`,
        explicacionConceptual:
          'En el diseño relacional, las entidades rara vez viven aisladas. Una entidad sin relaciones suele indicar que falta definir cómo se conecta con el resto del negocio (por ejemplo, con quién interactúa) o que no corresponde al alcance de este sistema.',
        entidadesInvolucradas: [ent.nombre],
      });
    }
  }

  return obs;
}

/**
 * Regla: Detecta si una relación apunta a una entidad que no existe en el catálogo.
 */
export function verificarRelacionesEntidadesInexistentes(modelo: Modelo): ObservacionValidacion[] {
  const obs: ObservacionValidacion[] = [];
  const mapaEntidades = new Set(modelo.entidades.map((e) => normalizarNombre(e.nombre)));

  for (const rel of modelo.relaciones) {
    const origenNorm = normalizarNombre(rel.origen);
    const destinoNorm = normalizarNombre(rel.destino);

    if (!mapaEntidades.has(origenNorm)) {
      obs.push({
        codigo: 'RELACION_ENTIDAD_INEXISTENTE',
        gravedad: 'error',
        mensaje: `La relación referencia la entidad de origen inexistente "${rel.origen}".`,
        explicacionConceptual:
          'No podés definir una relación usando una entidad que no existe en tu modelo conceptual. Verificá si fue eliminada o si el nombre tiene un error tipográfico.',
        entidadesInvolucradas: [rel.origen],
        relacionInvolucrada: rel,
      });
    }

    if (!mapaEntidades.has(destinoNorm)) {
      obs.push({
        codigo: 'RELACION_ENTIDAD_INEXISTENTE',
        gravedad: 'error',
        mensaje: `La relación referencia la entidad de destino inexistente "${rel.destino}".`,
        explicacionConceptual:
          'No podés definir una relación hacia una entidad que no existe en tu modelo conceptual.',
        entidadesInvolucradas: [rel.destino],
        relacionInvolucrada: rel,
      });
    }
  }

  return obs;
}

/**
 * Detecta si existe una tabla intermedia entre dos entidades.
 */
function existeTablaIntermedia(modelo: Modelo, entidadA: string, entidadB: string): boolean {
  const aNorm = normalizarNombre(entidadA);
  const bNorm = normalizarNombre(entidadB);

  return modelo.entidades.some((ent) => {
    const entNorm = normalizarNombre(ent.nombre);
    if (entNorm === aNorm || entNorm === bNorm) return false;

    const entA = modelo.entidades.find((e) => normalizarNombre(e.nombre) === aNorm);
    const entB = modelo.entidades.find((e) => normalizarNombre(e.nombre) === bNorm);

    if (entA && entB) {
      const tieneFKA = tieneAtributoFK(ent, entA);
      const tieneFKB = tieneAtributoFK(ent, entB);
      if (tieneFKA && tieneFKB) return true;
    }

    const relsConA = modelo.relaciones.some(
      (r) =>
        (normalizarNombre(r.origen) === aNorm && normalizarNombre(r.destino) === entNorm) ||
        (normalizarNombre(r.destino) === aNorm && normalizarNombre(r.origen) === entNorm)
    );
    const relsConB = modelo.relaciones.some(
      (r) =>
        (normalizarNombre(r.origen) === bNorm && normalizarNombre(r.destino) === entNorm) ||
        (normalizarNombre(r.destino) === bNorm && normalizarNombre(r.origen) === entNorm)
    );

    return relsConA && relsConB;
  });
}

/**
 * Regla: Detecta relaciones de muchos a muchos (N:M) directas sin tabla asociativa intermedia.
 */
export function verificarRelacionesNM(modelo: Modelo): ObservacionValidacion[] {
  const obs: ObservacionValidacion[] = [];

  for (const rel of modelo.relaciones) {
    if (rel.cardinalidad === 'N:M') {
      const intermediaExiste = existeTablaIntermedia(modelo, rel.origen, rel.destino);

      if (!intermediaExiste) {
        obs.push({
          codigo: 'NM_SIN_TABLA_INTERMEDIA',
          gravedad: 'advertencia',
          mensaje: `Relación Muchos a Muchos (N:M) directa entre "${rel.origen}" y "${rel.destino}": requiere una tabla intermedia para bases de datos relacionales.`,
          explicacionConceptual:
            'En los motores relacionales (SQLite, PostgreSQL, MySQL), una fila de una tabla no puede contener una lista de IDs de otra tabla sin violar la 1ra Forma Normal. Para vincular dos entidades con cardinalidad N:M se utiliza una "tabla asociativa" o "puente" que guarda las claves foráneas de ambas.',
          entidadesInvolucradas: [rel.origen, rel.destino],
          relacionInvolucrada: rel,
          accionRapida: {
            tipo: 'crear_tabla_intermedia',
            descripcion: `Crear tabla asociativa "${rel.origen}_${rel.destino}" y descomponer la relación en dos de 1:N.`,
            relacion: rel,
          },
        });
      }
    }
  }

  return obs;
}

/**
 * Regla: Detecta claves foráneas faltantes en relaciones 1:N y 1:1.
 */
export function verificarClavesForaneas(modelo: Modelo): ObservacionValidacion[] {
  const obs: ObservacionValidacion[] = [];
  const mapaEntidades = new Map<string, Entidad>();
  for (const ent of modelo.entidades) {
    mapaEntidades.set(normalizarNombre(ent.nombre), ent);
  }

  for (const rel of modelo.relaciones) {
    const origenEnt = mapaEntidades.get(normalizarNombre(rel.origen));
    const destinoEnt = mapaEntidades.get(normalizarNombre(rel.destino));

    if (!origenEnt || !destinoEnt) {
      continue;
    }

    if (rel.cardinalidad === '1:N') {
      // En una relación 1:N (Origen=1 -> Destino=N), la entidad del lado N (destino)
      // debe contener un atributo FK apuntando a la PK del lado 1 (origen).
      const tieneFK = tieneAtributoFK(destinoEnt, origenEnt);
      if (!tieneFK) {
        const nombrePropuesto = obtenerNombreAtributoFKPropuesto(origenEnt);
        obs.push({
          codigo: 'FK_FALTANTE',
          gravedad: 'advertencia',
          mensaje: `Clave foránea (FK) faltante en "${destinoEnt.nombre}": en la relación 1:N con "${origenEnt.nombre}", "${destinoEnt.nombre}" debe tener un atributo para guardar la clave de "${origenEnt.nombre}".`,
          explicacionConceptual:
            `En una relación 1:N, cada registro del lado "muchos" (${destinoEnt.nombre}) necesita saber a cuál registro padre (${origenEnt.nombre}) corresponde. Para eso se agrega una columna de clave foránea (FK) como "${nombrePropuesto}".`,
          entidadesInvolucradas: [destinoEnt.nombre, origenEnt.nombre],
          relacionInvolucrada: rel,
          accionRapida: {
            tipo: 'agregar_fk',
            descripcion: `Agregar atributo "${nombrePropuesto}" en "${destinoEnt.nombre}" referenciando a "${origenEnt.nombre}".`,
            entidadDestino: destinoEnt.nombre,
            entidadOrigen: origenEnt.nombre,
            atributoPropuesto: nombrePropuesto,
            relacion: rel,
          },
        });
      }
    } else if (rel.cardinalidad === '1:1') {
      // En una relación 1:1, al menos una de las dos entidades debe tener FK apuntando a la otra.
      const fkEnDestino = tieneAtributoFK(destinoEnt, origenEnt);
      const fkEnOrigen = tieneAtributoFK(origenEnt, destinoEnt);

      if (!fkEnDestino && !fkEnOrigen) {
        const nombrePropuesto = obtenerNombreAtributoFKPropuesto(origenEnt);
        obs.push({
          codigo: 'FK_FALTANTE',
          gravedad: 'advertencia',
          mensaje: `Clave foránea faltante en relación 1:1 entre "${origenEnt.nombre}" y "${destinoEnt.nombre}": al menos una entidad debe guardar la clave de la otra.`,
          explicacionConceptual:
            'Para implementar una relación uno a uno (1:1), una de las dos entidades debe almacenar la clave primaria de la otra como clave foránea única.',
          entidadesInvolucradas: [origenEnt.nombre, destinoEnt.nombre],
          relacionInvolucrada: rel,
          accionRapida: {
            tipo: 'agregar_fk',
            descripcion: `Agregar atributo "${nombrePropuesto}" en "${destinoEnt.nombre}" referenciando a "${origenEnt.nombre}".`,
            entidadDestino: destinoEnt.nombre,
            entidadOrigen: origenEnt.nombre,
            atributoPropuesto: nombrePropuesto,
            relacion: rel,
          },
        });
      }
    }
  }

  return obs;
}

/**
 * Regla: Detecta relaciones redundantes o duplicadas entre el mismo par de entidades.
 */
export function verificarRelacionesDuplicadas(modelo: Modelo): ObservacionValidacion[] {
  const obs: ObservacionValidacion[] = [];
  const vistas = new Set<string>();

  for (const rel of modelo.relaciones) {
    const a = normalizarNombre(rel.origen);
    const b = normalizarNombre(rel.destino);
    const clavePar = `${a}->${b}`;
    const claveParInverso = `${b}->${a}`;

    if (vistas.has(clavePar) || (rel.cardinalidad === 'N:M' && vistas.has(claveParInverso))) {
      obs.push({
        codigo: 'RELACIONES_DUPLICADAS',
        gravedad: 'advertencia',
        mensaje: `Relación duplicada o redundante entre "${rel.origen}" y "${rel.destino}".`,
        explicacionConceptual:
          'Ya existe una relación registrada entre estas entidades con igual o similar sentido. Mantener relaciones duplicadas genera ambigüedad al momento de generar el DDL y las consultas.',
        entidadesInvolucradas: [rel.origen, rel.destino],
        relacionInvolucrada: rel,
      });
    } else {
      vistas.add(clavePar);
    }
  }

  return obs;
}

/**
 * Regla: Detecta atributos repetidos dentro de una misma entidad.
 */
export function verificarAtributosDuplicados(modelo: Modelo): ObservacionValidacion[] {
  const obs: ObservacionValidacion[] = [];

  for (const ent of modelo.entidades) {
    const nombresVistos = new Set<string>();
    for (const attr of ent.atributos) {
      const norm = normalizarNombre(attr.nombre);
      if (nombresVistos.has(norm)) {
        obs.push({
          codigo: 'ATRIBUTOS_DUPLICADOS',
          gravedad: 'error',
          mensaje: `Atributo duplicado en "${ent.nombre}": el atributo "${attr.nombre}" aparece más de una vez.`,
          explicacionConceptual:
            'Cada columna dentro de una misma tabla debe tener un nombre exclusivo para evitar conflictos en sentencias SQL.',
          entidadesInvolucradas: [ent.nombre],
        });
      } else {
        nombresVistos.add(norm);
      }
    }
  }

  return obs;
}

/**
 * Regla: Reconoce y valida positivamente las tablas intermedias presentes en el modelo.
 */
export function verificarTablasIntermedias(modelo: Modelo): ObservacionValidacion[] {
  const obs: ObservacionValidacion[] = [];
  if (modelo.entidades.length < 3) {
    return obs;
  }

  for (const ent of modelo.entidades) {
    const otrasEntidades = modelo.entidades.filter(
      (e) => normalizarNombre(e.nombre) !== normalizarNombre(ent.nombre)
    );

    const fksDetectadas = otrasEntidades.filter((otra) => tieneAtributoFK(ent, otra));
    if (fksDetectadas.length >= 2) {
      const nombresPadres = fksDetectadas.map((e) => e.nombre).join(' y ');
      obs.push({
        codigo: 'TABLA_INTERMEDIA_DETECTADA',
        gravedad: 'sugerencia',
        mensaje: `Tabla intermedia detectada: "${ent.nombre}" conecta adecuadamente a ${nombresPadres}.`,
        explicacionConceptual:
          'Excelente práctica de normalización: crear tablas asociativas permite registrar vínculos N:M y agregar atributos propios a la relación (como fecha, cantidad o estado).',
        entidadesInvolucradas: [ent.nombre, ...fksDetectadas.map((e) => e.nombre)],
      });
    }
  }

  return obs;
}

/**
 * Validador determinístico principal del Modelo.
 * Ejecuta todas las reglas en orden y categoriza los resultados por gravedad.
 */
export function validarModelo(modelo: Modelo): ResultadoValidacion {
  const observaciones: ObservacionValidacion[] = [
    ...verificarClavesPrimarias(modelo),
    ...verificarRelacionesEntidadesInexistentes(modelo),
    ...verificarAtributosDuplicados(modelo),
    ...verificarEntidadesAisladas(modelo),
    ...verificarRelacionesNM(modelo),
    ...verificarClavesForaneas(modelo),
    ...verificarRelacionesDuplicadas(modelo),
    ...verificarTablasIntermedias(modelo),
  ];

  const errores = observaciones.filter((o) => o.gravedad === 'error');
  const advertencias = observaciones.filter((o) => o.gravedad === 'advertencia');
  const sugerencias = observaciones.filter((o) => o.gravedad === 'sugerencia');

  return {
    valido: errores.length === 0,
    observaciones,
    errores,
    advertencias,
    sugerencias,
    resumen: {
      totalErrores: errores.length,
      totalAdvertencias: advertencias.length,
      totalSugerencias: sugerencias.length,
    },
  };
}

/**
 * Resuelve automáticamente una clave foránea faltante agregando el atributo correspondiente
 * en la entidad de destino.
 */
export function resolverFKFaltante(
  modelo: Modelo,
  entidadDestinoNombre: string,
  entidadOrigenNombre: string
): Modelo {
  const origenNorm = normalizarNombre(entidadOrigenNombre);
  const destinoNorm = normalizarNombre(entidadDestinoNombre);

  const entidadOrigen = modelo.entidades.find((e) => normalizarNombre(e.nombre) === origenNorm);
  if (!entidadOrigen) {
    return modelo;
  }

  const pkOrigen = entidadOrigen.atributos.find((a) => a.esClavePrimaria);
  const tipoOrigen = pkOrigen?.tipoConceptual ?? 'entero';
  const nombreFK = obtenerNombreAtributoFKPropuesto(entidadOrigen);

  const entidadesActualizadas = modelo.entidades.map((ent) => {
    if (normalizarNombre(ent.nombre) !== destinoNorm) {
      return ent;
    }

    if (tieneAtributoFK(ent, entidadOrigen)) {
      return ent;
    }

    return {
      ...ent,
      atributos: [
        ...ent.atributos,
        {
          nombre: nombreFK,
          tipoConceptual: tipoOrigen,
          obligatorio: true,
          unico: false,
          esClavePrimaria: false,
          justificacion: `Clave foránea (FK) que referencia a ${entidadOrigen.nombre}(${
            pkOrigen?.nombre ?? 'id'
          }).`,
        },
      ],
    };
  });

  return {
    ...modelo,
    entidades: entidadesActualizadas,
  };
}

/**
 * Descompone una relación directa N:M creando una tabla intermedia asociativa
 * y sustituyendo la relación original por dos relaciones 1:N.
 */
export function crearTablaIntermediaParaNM(modelo: Modelo, relacion: Relacion): Modelo {
  const nombreOrigen = relacion.origen.trim();
  const nombreDestino = relacion.destino.trim();
  const nombreIntermedia = `${nombreOrigen}_${nombreDestino}`;

  const entidadOrigen = modelo.entidades.find(
    (e) => normalizarNombre(e.nombre) === normalizarNombre(nombreOrigen)
  );
  const entidadDestino = modelo.entidades.find(
    (e) => normalizarNombre(e.nombre) === normalizarNombre(nombreDestino)
  );

  const pkOrigen = entidadOrigen?.atributos.find((a) => a.esClavePrimaria);
  const pkDestino = entidadDestino?.atributos.find((a) => a.esClavePrimaria);

  const fkOrigenNombre = entidadOrigen
    ? obtenerNombreAtributoFKPropuesto(entidadOrigen)
    : `id_${normalizarNombre(nombreOrigen)}`;
  const fkDestinoNombre = entidadDestino
    ? obtenerNombreAtributoFKPropuesto(entidadDestino)
    : `id_${normalizarNombre(nombreDestino)}`;

  const nuevaEntidadIntermedia: Entidad = {
    nombre: nombreIntermedia,
    descripcion: `Tabla intermedia asociativa que resuelve la relación N:M entre ${nombreOrigen} y ${nombreDestino}.`,
    atributos: [
      {
        nombre: `id_${normalizarNombre(nombreIntermedia)}`,
        tipoConceptual: 'entero',
        obligatorio: true,
        unico: true,
        esClavePrimaria: true,
        justificacion: `Clave primaria identificadora de cada registro asociativo en ${nombreIntermedia}.`,
      },
      {
        nombre: fkOrigenNombre,
        tipoConceptual: pkOrigen?.tipoConceptual ?? 'entero',
        obligatorio: true,
        unico: false,
        esClavePrimaria: false,
        justificacion: `Clave foránea (FK) que referencia a ${nombreOrigen}(${pkOrigen?.nombre ?? 'id'}).`,
      },
      {
        nombre: fkDestinoNombre,
        tipoConceptual: pkDestino?.tipoConceptual ?? 'entero',
        obligatorio: true,
        unico: false,
        esClavePrimaria: false,
        justificacion: `Clave foránea (FK) que referencia a ${nombreDestino}(${pkDestino?.nombre ?? 'id'}).`,
      },
      {
        nombre: 'fecha_registro',
        tipoConceptual: 'fecha',
        obligatorio: true,
        unico: false,
        esClavePrimaria: false,
        justificacion: 'Fecha en la que se estableció el vínculo entre ambas entidades.',
      },
    ],
  };

  // Reemplazar la relación N:M por dos relaciones 1:N
  const relacionesRestantes = modelo.relaciones.filter((r) => r !== relacion);

  const relacionOrigenAIntermedia: Relacion = {
    origen: nombreOrigen,
    destino: nombreIntermedia,
    cardinalidad: '1:N',
    descripcion: `Un(a) ${nombreOrigen} puede vincularse múltiples veces en ${nombreIntermedia}.`,
    obligatoriaEnOrigen: false,
    obligatoriaEnDestino: true,
  };

  const relacionDestinoAIntermedia: Relacion = {
    origen: nombreDestino,
    destino: nombreIntermedia,
    cardinalidad: '1:N',
    descripcion: `Un(a) ${nombreDestino} puede vincularse múltiples veces en ${nombreIntermedia}.`,
    obligatoriaEnOrigen: false,
    obligatoriaEnDestino: true,
  };

  return {
    ...modelo,
    entidades: [...modelo.entidades, nuevaEntidadIntermedia],
    relaciones: [
      ...relacionesRestantes,
      relacionOrigenAIntermedia,
      relacionDestinoAIntermedia,
    ],
  };
}

/**
 * Solicita a la IA tutora una propuesta pedagógica de relaciones entre las entidades confirmadas
 * basada en la descripción inicial del problema.
 */
export async function sugerirRelacionesConIA(params: {
  entidades: Entidad[];
  descripcionProblema: string;
  rondas?: RondaAclaracion[];
}): Promise<PropuestaRelaciones> {
  const contextoRondas = params.rondas ? formatearContextoRondas(params.rondas) : '';
  const resumenEntidades = params.entidades
    .map(
      (e) =>
        `- Entidad: ${e.nombre} (${e.descripcion})\n  Atributos: ${e.atributos
          .map((a) => `${a.nombre} (${a.tipoConceptual}${a.esClavePrimaria ? ', PK' : ''})`)
          .join(', ')}`
    )
    .join('\n');

  const prompt = `Como tutor de bases de datos, analizá las siguientes entidades conceptuales confirmadas por el estudiante y sugerí las RELACIONES y CARDINALIDADES adecuadas para su problema.
  
DESCRIPCIÓN DEL PROBLEMA:
"""
${params.descripcionProblema.trim()}
"""

HISTORIAL DE ACLARACIONES PREVIAS:
${contextoRondas || 'Sin rondas previas.'}

ENTIDADES CONFIRMADAS:
${resumenEntidades}

REGLAS PEDAGÓGICAS PARA LAS RELACIONES:
1. Usá únicamente nombres de entidades que existan exactamente en la lista confirmada.
2. Definí la cardinalidad precisa ("1:1", "1:N" o "N:M") y explicá en "descripcion" el sentido en lenguaje natural (ejemplo: "Un cliente puede registrar muchas mascotas").
3. Especificá si la relación es obligatoria u opcional en cada extremo (\`obligatoriaEnOrigen\` y \`obligatoriaEnDestino\`).
4. En \`justificacionGeneral\`, brindá una breve síntesis didáctica en español rioplatense explicando cómo se comunican las entidades en este modelo.

Respondé ÚNICAMENTE con un JSON válido con este esquema:
{
  "relaciones": [
    {
      "origen": "string",
      "destino": "string",
      "cardinalidad": "1:1" | "1:N" | "N:M",
      "descripcion": "string",
      "obligatoriaEnOrigen": boolean,
      "obligatoriaEnDestino": boolean
    }
  ],
  "justificacionGeneral": "string"
}`;

  return consultarGeminiEstructurado({
    prompt,
    schema: PropuestaRelacionesSchema,
    systemInstruction: systemTutorPrompt,
  });
}

/**
 * Solicita a la IA tutora explicaciones didácticas profundas con ejemplos concretos del dominio
 * para cada una de las observaciones detectadas por el validador determinístico.
 */
export async function explicarObservacionesConIA(params: {
  modelo: Modelo;
  observaciones: ObservacionValidacion[];
  descripcionProblema: string;
}): Promise<RespuestaExplicacionObservaciones> {
  if (params.observaciones.length === 0) {
    return {
      explicaciones: [],
      resumenTutor: 'Tu modelo no presenta observaciones. ¡El diseño relacional está consistente y listo para continuar!',
    };
  }

  const detalleObservaciones = params.observaciones
    .map(
      (obs, idx) =>
        `Observación #${idx + 1}:
  - Código: ${obs.codigo}
  - Gravedad: ${obs.gravedad}
  - Mensaje: ${obs.mensaje}
  - Entidades involucradas: ${obs.entidadesInvolucradas.join(', ')}`
    )
    .join('\n\n');

  const prompt = `Sos el tutor de bases de datos. El validador determinístico detectó las siguientes observaciones en el modelo relacional del estudiante.
  
PROBLEMA DEL ESTUDIANTE:
"""
${params.descripcionProblema.trim()}
"""

ENTIDADES DEL MODELO:
${JSON.stringify(
  params.modelo.entidades.map((e) => ({
    nombre: e.nombre,
    atributos: e.atributos.map((a) => a.nombre),
  })),
  null,
  2
)}

RELACIONES ACTUALES:
${JSON.stringify(params.modelo.relaciones, null, 2)}

OBSERVACIONES DETECTADAS POR EL VALIDADOR:
${detalleObservaciones}

INSTRUCCIONES DIDÁCTICAS:
Para cada una de las observaciones, proporcioná una explicación pedagógica en español rioplatense adaptada al caso del estudiante:
1. "explicacionPedagogica": Explicá el concepto teórico de forma simple y amigable (por ejemplo, qué significa una relación N:M o por qué falta la clave foránea).
2. "ejemploConcreto": Mostrá un ejemplo real usando datos de su dominio (por ej.: "Si tenés al cliente Juan y las mascotas Firulais y Michi...").
3. "comoResolverlo": Pasos claros y accionables para corregirlo.
4. "resumenTutor": Un mensaje alentador de síntesis pedagógica.

Respondé ÚNICAMENTE con un JSON con la siguiente estructura:
{
  "explicaciones": [
    {
      "codigo": "string",
      "mensaje": "string",
      "explicacionPedagogica": "string",
      "ejemploConcreto": "string",
      "comoResolverlo": "string"
    }
  ],
  "resumenTutor": "string"
}`;

  return consultarGeminiEstructurado({
    prompt,
    schema: RespuestaExplicacionObservacionesSchema,
    systemInstruction: systemTutorPrompt,
  });
}
