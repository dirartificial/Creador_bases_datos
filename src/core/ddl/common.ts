import { Entidad, Modelo, OpcionesGeneracionDDL, Relacion, TipoConceptual } from '../schemas';
import {
  DefinicionClaveForaneaSQL,
  DefinicionColumnaSQL,
  DefinicionTablaSQL,
} from './types';

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
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Genera variantes normalizadas (singular/plural) del nombre de una entidad
 * para reconocer claves foráneas creadas manualmente (ej.: "clientes" <-> "id_cliente").
 */
export function obtenerVariantesNombreEntidad(nombreEntidad: string): string[] {
  const base = normalizar(nombreEntidad).replace(/[\s-]+/g, '_');
  const variantes = new Set<string>([base]);

  if (base.length > 3) {
    if (base.endsWith('es') && base.length > 4) {
      variantes.add(base.slice(0, -2));
    }
    if (base.endsWith('s')) {
      variantes.add(base.slice(0, -1));
    } else {
      variantes.add(`${base}s`);
      variantes.add(`${base}es`);
    }
  }

  return Array.from(variantes).filter(Boolean);
}

/**
 * Detecta si una entidad ya tiene un atributo que funcione como clave foránea
 * apuntando a la entidad padre, priorizando los campos explícitamente indicados en la relación.
 */
export function buscarAtributoFK(
  entidadHijo: Entidad,
  entidadPadre: Entidad,
  relacion?: Relacion
): { atributoLocal: string; columnaPadre: string } | null {
  const pkPadre = entidadPadre.atributos.find((a) => a.esClavePrimaria);
  let nombrePKPadre = pkPadre ? pkPadre.nombre : entidadPadre.atributos[0]?.nombre ?? 'id';

  // Si la relación especifica explícitamente qué campo de la entidad padre se referencia:
  if (relacion?.campoOrigen) {
    const campoOrigenNorm = normalizar(relacion.campoOrigen);
    const attrPadreExplicito = entidadPadre.atributos.find(
      (a) => normalizar(a.nombre) === campoOrigenNorm
    );
    if (attrPadreExplicito) {
      nombrePKPadre = attrPadreExplicito.nombre;
    }
  }

  // 1. Prioridad máxima: si la relación especifica explícitamente el campo foráneo en la tabla destino
  if (relacion?.campoDestino) {
    const campoDestinoNorm = normalizar(relacion.campoDestino);
    const attrHijoExplicito = entidadHijo.atributos.find(
      (a) => normalizar(a.nombre) === campoDestinoNorm
    );
    if (attrHijoExplicito) {
      return {
        atributoLocal: attrHijoExplicito.nombre,
        columnaPadre: nombrePKPadre,
      };
    }
  }

  const variantesPadre = obtenerVariantesNombreEntidad(entidadPadre.nombre);
  const nombrePKPadreNorm = normalizar(nombrePKPadre);
  const totalPKsHijo = entidadHijo.atributos.filter((a) => a.esClavePrimaria).length;

  for (const attr of entidadHijo.atributos) {
    const nom = normalizar(attr.nombre).replace(/[\s-]+/g, '_');
    const esPKExclusivaHijo = attr.esClavePrimaria && totalPKsHijo === 1;

    // Coincidencia exacta con el nombre de la PK del padre (ej: id_cliente) cuando no es su propia PK simple
    if (
      nombrePKPadreNorm &&
      nombrePKPadreNorm !== 'id' &&
      nom === nombrePKPadreNorm &&
      !esPKExclusivaHijo
    ) {
      return { atributoLocal: attr.nombre, columnaPadre: nombrePKPadre };
    }

    // Coincidencia con cualquiera de las variantes singular/plural de la entidad padre
    for (const variante of variantesPadre) {
      if (
        nom === `id_${variante}` ||
        nom === `id${variante}` ||
        nom === `${variante}_id` ||
        nom === `${variante}id` ||
        nom === `cod_${variante}` ||
        nom === `${variante}_cod` ||
        nom === `codigo_${variante}` ||
        nom === `${variante}_codigo` ||
        nom === `fk_${variante}` ||
        nom === `${variante}_fk` ||
        nom === `${variante}fk` ||
        (!esPKExclusivaHijo && nom === variante)
      ) {
        return { atributoLocal: attr.nombre, columnaPadre: nombrePKPadre };
      }

      if (
        !esPKExclusivaHijo &&
        (nom.startsWith('id_') ||
          nom.endsWith('_id') ||
          nom.includes('fk') ||
          nom.startsWith('cod_') ||
          nom.endsWith('_cod')) &&
        nom.includes(variante)
      ) {
        return { atributoLocal: attr.nombre, columnaPadre: nombrePKPadre };
      }
    }
  }

  return null;
}

/**
 * Verifica si en el modelo conceptual ya existe una entidad asociativa intermedia
 * que resuelva la relación N:M entre dos entidades.
 */
export function existeTablaIntermediaEnModelo(
  modelo: Modelo,
  origen: string,
  destino: string
): boolean {
  const origenNorm = normalizar(origen);
  const destinoNorm = normalizar(destino);

  return modelo.entidades.some((ent) => {
    const nom = normalizar(ent.nombre);
    const contieneAmbos =
      (nom.includes(origenNorm) && nom.includes(destinoNorm)) ||
      nom === `${origenNorm}_${destinoNorm}` ||
      nom === `${destinoNorm}_${origenNorm}`;

    if (!contieneAmbos) return false;

    // Verificar si tiene referencias o atributos que apunten a ambas
    const tieneFKOrigen = ent.atributos.some((a) =>
      normalizar(a.nombre).includes(origenNorm)
    );
    const tieneFKDestino = ent.atributos.some((a) =>
      normalizar(a.nombre).includes(destinoNorm)
    );
    return tieneFKOrigen || tieneFKDestino || ent.atributos.length >= 2;
  });
}

/**
 * Construye la representación intermedia de tablas SQL para cualquier motor relacional.
 */
export function construirDefinicionesTablasBase(
  modelo: Modelo,
  mapearTipo: (tipo: TipoConceptual) => string,
  opciones?: Partial<OpcionesGeneracionDDL>,
  generarCheckBooleano?: (columnaSanitizada: string) => string
): DefinicionTablaSQL[] {
  const onDelete = opciones?.onDelete ?? 'CASCADE';
  const onUpdate = opciones?.onUpdate ?? 'CASCADE';

  const tablas: DefinicionTablaSQL[] = [];
  const entidadesMap = new Map<string, Entidad>();
  modelo.entidades.forEach((e) => entidadesMap.set(normalizar(e.nombre), e));

  // 1. Entidades declaradas en el modelo
  for (const ent of modelo.entidades) {
    const pks = ent.atributos.filter((a) => a.esClavePrimaria);
    const esSinglePK = pks.length === 1;

    const columnas: DefinicionColumnaSQL[] = ent.atributos.map((attr) => {
      const tipoSQL = mapearTipo(attr.tipoConceptual);
      const esPK = attr.esClavePrimaria;
      const esAutoincrement = esPK && esSinglePK && attr.tipoConceptual === 'entero';

      let checkExpr: string | undefined;
      const colSanitizada = sanitizarIdentificadorSQL(attr.nombre);

      if (attr.tipoConceptual === 'booleano' && generarCheckBooleano) {
        checkExpr = generarCheckBooleano(colSanitizada);
      } else if (attr.valoresPermitidos && attr.valoresPermitidos.length > 0) {
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

    // Claves foráneas basadas en relaciones 1:N y 1:1
    for (const rel of modelo.relaciones) {
      if (rel.cardinalidad === '1:N' || rel.cardinalidad === '1:1') {
        if (normalizar(rel.destino) === normalizar(ent.nombre)) {
          const padreEnt = entidadesMap.get(normalizar(rel.origen));
          if (padreEnt) {
            const fkEncontrada = buscarAtributoFK(ent, padreEnt, rel);
            if (fkEncontrada) {
              const colLocalSanitizada = sanitizarIdentificadorSQL(fkEncontrada.atributoLocal);
              const tablaRefSanitizada = sanitizarIdentificadorSQL(padreEnt.nombre);
              if (
                !clavesForaneas.some(
                  (fk) =>
                    fk.columnaLocal === colLocalSanitizada &&
                    fk.tablaReferenciada === tablaRefSanitizada
                )
              ) {
                clavesForaneas.push({
                  columnaLocal: colLocalSanitizada,
                  tablaReferenciada: tablaRefSanitizada,
                  columnaReferenciada: sanitizarIdentificadorSQL(fkEncontrada.columnaPadre),
                  onDelete,
                  onUpdate,
                });
              }
            }
          }
        } else if (rel.cardinalidad === '1:1' && normalizar(rel.origen) === normalizar(ent.nombre)) {
          // En relaciones 1:1, si la tabla destino no tiene la FK pero la tabla origen sí la tiene,
          // permitimos registrar la referencia desde el origen hacia el destino
          const otraEnt = entidadesMap.get(normalizar(rel.destino));
          if (otraEnt) {
            const fkEnDestino = buscarAtributoFK(otraEnt, ent, rel);
            if (!fkEnDestino) {
              const fkEnOrigen = buscarAtributoFK(ent, otraEnt);
              if (fkEnOrigen) {
                const colLocalSanitizada = sanitizarIdentificadorSQL(fkEnOrigen.atributoLocal);
                const tablaRefSanitizada = sanitizarIdentificadorSQL(otraEnt.nombre);
                if (
                  !clavesForaneas.some(
                    (fk) =>
                      fk.columnaLocal === colLocalSanitizada &&
                      fk.tablaReferenciada === tablaRefSanitizada
                  )
                ) {
                  clavesForaneas.push({
                    columnaLocal: colLocalSanitizada,
                    tablaReferenciada: tablaRefSanitizada,
                    columnaReferenciada: sanitizarIdentificadorSQL(fkEnOrigen.columnaPadre),
                    onDelete,
                    onUpdate,
                  });
                }
              }
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

  // 2. Relaciones N:M que no tienen tabla asociativa en el modelo conceptual
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
                tipoSQL: pkOrigen ? mapearTipo(pkOrigen.tipoConceptual) : 'INTEGER',
                esPK: true,
                esAutoincrement: false,
                nullable: false,
                unico: false,
                justificacion: `Clave foránea referenciando a la entidad padre "${entOrigen.nombre}".`,
              },
              {
                nombre: colDestino,
                tipoSQL: pkDestino ? mapearTipo(pkDestino.tipoConceptual) : 'INTEGER',
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
    const yaAgregadas = new Set(orden.map((t) => t.nombre.toLowerCase()));
    for (const t of tablas) {
      if (!yaAgregadas.has(t.nombre.toLowerCase())) {
        orden.push(t);
      }
    }
  }

  return { tablasOrdenadas: orden, hayCiclo };
}
