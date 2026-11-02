import { ProyectoEstado } from './schemas';

export type CategoriaGlosario = 'conceptual' | 'relacional' | 'nosql' | 'consultas';

export interface TerminoGlosario {
  id: string;
  termino: string;
  categoria: CategoriaGlosario;
  definicion: string;
  ejemploConcreto: string;
  esRelevanteParaProyecto?: (proyecto: ProyectoEstado) => boolean;
}

export const LISTA_GLOSARIO: readonly TerminoGlosario[] = [
  // --- CONCEPTUAL ---
  {
    id: 'entidad',
    termino: 'Entidad',
    categoria: 'conceptual',
    definicion:
      'Representa una clase de objeto del mundo real o concepto del negocio sobre el cual se desea registrar información estructurada.',
    ejemploConcreto: 'En una veterinaria: "Clientes", "Mascotas" o "Tratamientos".',
    esRelevanteParaProyecto: (p) => (p?.modelo?.entidades?.length ?? 0) > 0,
  },
  {
    id: 'atributo',
    termino: 'Atributo',
    categoria: 'conceptual',
    definicion:
      'Propiedad o característica que describe a una entidad, con un nombre único dentro de la entidad y un tipo de dato conceptual asociado.',
    ejemploConcreto: 'Para la entidad "Mascotas": "nombre" (texto), "fecha_nacimiento" (fecha), "peso_kg" (decimal).',
    esRelevanteParaProyecto: (p) =>
      Boolean(p?.modelo?.entidades?.some((e) => (e.atributos?.length ?? 0) > 0)),
  },
  {
    id: 'clave-primaria',
    termino: 'Clave Primaria (Primary Key / PK)',
    categoria: 'conceptual',
    definicion:
      'Atributo o combinación de atributos que identifica unívocamente a cada registro o fila dentro de una tabla. Debe ser obligatoria (NOT NULL) y única.',
    ejemploConcreto: '"id_cliente" con valor entero autoincremental único (1, 2, 3...) en la entidad "Clientes".',
    esRelevanteParaProyecto: (p) =>
      Boolean(p?.modelo?.entidades?.some((e) => e.atributos?.some((a) => a.esClavePrimaria))),
  },
  {
    id: 'clave-foranea',
    termino: 'Clave Foránea (Foreign Key / FK)',
    categoria: 'relacional',
    definicion:
      'Columna en una tabla que hace referencia a la clave primaria de otra tabla, estableciendo un vínculo referencial formal entre ambas.',
    ejemploConcreto: 'En la tabla "Mascotas", la columna "id_cliente" apunta a la PK "id_cliente" de la tabla "Clientes".',
    esRelevanteParaProyecto: (p) => (p?.modelo?.relaciones?.length ?? 0) > 0,
  },
  {
    id: 'clave-unica',
    termino: 'Clave Única (Unique Key / UK)',
    categoria: 'relacional',
    definicion:
      'Restricción que impide que dos filas distintas contengan el mismo valor para una columna determinada, permitiendo valores únicos sin ser la clave primaria.',
    ejemploConcreto: 'El atributo "email" en la entidad "Usuarios" o "isbn" en "Libros".',
    esRelevanteParaProyecto: (p) =>
      Boolean(p?.modelo?.entidades?.some((e) => e.atributos?.some((a) => a.unico && !a.esClavePrimaria))),
  },
  {
    id: 'cardinalidad',
    termino: 'Cardinalidad (1:1, 1:N, N:M)',
    categoria: 'conceptual',
    definicion:
      'Número de ocurrencias de una entidad que pueden estar asociadas con ocurrencias de otra entidad. Determina si la relación es Uno a Uno (1:1), Uno a Muchos (1:N) o Muchos a Muchos (N:M).',
    ejemploConcreto: '1:N entre Clientes y Mascotas (un cliente tiene muchas mascotas, cada mascota pertenece a un cliente).',
    esRelevanteParaProyecto: (p) => (p?.modelo?.relaciones?.length ?? 0) > 0,
  },
  {
    id: 'tabla-asociativa',
    termino: 'Tabla Asociativa / Intermedia',
    categoria: 'relacional',
    definicion:
      'Tabla relacional creada para materializar una relación Muchos a Muchos (N:M), descomponiéndola en dos relaciones 1:N y conteniendo las claves foráneas de ambas tablas principales.',
    ejemploConcreto: '"mascotas_tratamientos" con columnas (id_mascota, id_tratamiento, fecha_aplicacion).',
    esRelevanteParaProyecto: (p) =>
      Boolean(p?.modelo?.relaciones?.some((r) => r.cardinalidad === 'N:M')),
  },
  {
    id: 'normalizacion',
    termino: 'Normalización (1FN, 2FN, 3FN)',
    categoria: 'conceptual',
    definicion:
      'Proceso metodológico de diseño de bases de datos que organiza tablas y columnas para minimizar la redundancia de datos y evitar anomalías al insertar, actualizar o eliminar.',
    ejemploConcreto: 'Separar los datos de "editorial" de la tabla "libros" en su propia tabla para no repetir el nombre de la editorial en cada libro.',
    esRelevanteParaProyecto: () => true,
  },
  {
    id: 'integridad-referencial',
    termino: 'Integridad Referencial',
    categoria: 'relacional',
    definicion:
      'Principio del modelo relacional que garantiza que una clave foránea nunca contenga un valor inexistente en la tabla referenciada, evitando "registros huérfanos".',
    ejemploConcreto: 'No se puede insertar una mascota con id_cliente=99 si no existe un cliente con id=99.',
    esRelevanteParaProyecto: () => true,
  },

  // --- RELACIONAL ---
  {
    id: 'ddl',
    termino: 'DDL (Data Definition Language)',
    categoria: 'relacional',
    definicion:
      'Subconjunto del lenguaje SQL (como CREATE TABLE, ALTER TABLE, DROP TABLE) utilizado para crear y modificar la estructura física de la base de datos.',
    ejemploConcreto: 'CREATE TABLE clientes (id_cliente INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL);',
    esRelevanteParaProyecto: (p) => Boolean(p?.ddlGenerado),
  },
  {
    id: 'dml',
    termino: 'DML (Data Manipulation Language)',
    categoria: 'relacional',
    definicion:
      'Subconjunto de sentencias SQL (INSERT, UPDATE, DELETE) dedicadas a manipular los datos almacenados dentro de las tablas.',
    ejemploConcreto: "INSERT INTO clientes (nombre_completo, email) VALUES ('Juan Pérez', 'juan@ejemplo.com');",
    esRelevanteParaProyecto: (p) => Boolean(p?.datosEjemplo),
  },
  {
    id: 'acid',
    termino: 'Propiedades ACID (Transacciones)',
    categoria: 'relacional',
    definicion:
      'Conjunto de garantías de los motores relacionales: Atomicidad (todo o nada), Consistencia (respeta restricciones), Aislamiento (concurrencia segura) y Durabilidad (persistencia tras caída).',
    ejemploConcreto: 'Al transferir saldo bancario, se descuenta de una cuenta y se suma en otra de forma atómica; si algo falla, se revierte todo.',
    esRelevanteParaProyecto: () => true,
  },
  {
    id: 'check-constraint',
    termino: 'Restricción CHECK',
    categoria: 'relacional',
    definicion:
      'Cláusula SQL que valida que los valores insertados en una columna cumplan una condición booleana específica (rango de valores o lista permitida).',
    ejemploConcreto: "CHECK (especie IN ('Perro', 'Gato', 'Ave')) o CHECK (costo > 0)",
    esRelevanteParaProyecto: (p) =>
      Boolean(p?.modelo?.entidades?.some((e) => e.atributos?.some((a) => (a.valoresPermitidos?.length ?? 0) > 0))),
  },
  {
    id: 'acciones-referenciales',
    termino: 'Acciones Referenciales (ON DELETE / ON UPDATE)',
    categoria: 'relacional',
    definicion:
      'Reglas automáticas aplicadas al modificar o borrar una fila padre: CASCADE (propaga cambios), RESTRICT (bloquea la operación), SET NULL (convierte a nulo) o NO ACTION.',
    ejemploConcreto: 'ON DELETE CASCADE borra automáticamente todas las mascotas asociadas a un cliente cuando este es eliminado.',
    esRelevanteParaProyecto: (p) => (p?.modelo?.relaciones?.length ?? 0) > 0,
  },
  {
    id: 'pglite',
    termino: 'PGlite (PostgreSQL WebAssembly)',
    categoria: 'relacional',
    definicion:
      'Compilación oficial del motor de base de datos PostgreSQL en C hacia WebAssembly (WASM), permitiendo ejecutar un motor PostgreSQL real 100% en el navegador sin servidores.',
    ejemploConcreto: 'Ejecuta tipos SERIAL, TIMESTAMP y consultas information_schema directamente en un Web Worker en tu navegador.',
    esRelevanteParaProyecto: (p) => p?.motorSeleccionado === 'postgresql',
  },

  // --- NOSQL ---
  {
    id: 'documento-bson',
    termino: 'Documento BSON',
    categoria: 'nosql',
    definicion:
      'Estructura de almacenamiento de MongoDB en formato JSON binario. Soporta tipos enriquecidos como fechas, enteros de 32/64 bits y double, con un límite máximo de 16 MB por documento.',
    ejemploConcreto: '{ _id: ObjectId("..."), nombre: "Michi", especie: "Gato", edad: NumberInt(3) }',
    esRelevanteParaProyecto: (p) => p?.motorSeleccionado === 'mongodb',
  },
  {
    id: 'coleccion',
    termino: 'Colección (MongoDB)',
    categoria: 'nosql',
    definicion:
      'Agrupación de documentos dentro de MongoDB, equivalente conceptual a una tabla en el modelo relacional, pero con esquema dinámico o validado con JSON Schema.',
    ejemploConcreto: 'db.createCollection("mascotas", { validator: { $jsonSchema: { ... } } });',
    esRelevanteParaProyecto: (p) => p?.motorSeleccionado === 'mongodb',
  },
  {
    id: 'embeber-vs-referenciar',
    termino: 'Embeber vs. Referenciar (NoSQL)',
    categoria: 'nosql',
    definicion:
      'Dilema central en el diseño documental: Embeber guarda datos relacionados como subdocumentos dentro del mismo registro (lecturas atómicas, datos acotados); Referenciar guarda IDs de enlace e indexa para consultas desacopladas o de crecimiento ilimitado.',
    ejemploConcreto: 'Embeber las líneas de un pedido dentro de la orden vs. referenciar el id_cliente para no duplicar datos del cliente.',
    esRelevanteParaProyecto: (p) => p?.motorSeleccionado === 'mongodb',
  },
  {
    id: 'json-schema',
    termino: 'Validador $jsonSchema',
    categoria: 'nosql',
    definicion:
      'Mecanismo de validación estricta de MongoDB que define reglas de esquema para los documentos de una colección (campos requeridos, tipos BSON permitidos y enumeraciones).',
    ejemploConcreto: 'validator: { $jsonSchema: { bsonType: "object", required: ["nombre", "email"], properties: { ... } } }',
    esRelevanteParaProyecto: (p) => p?.motorSeleccionado === 'mongodb',
  },
  {
    id: 'lookup',
    termino: 'Agregación $lookup (MongoDB)',
    categoria: 'nosql',
    definicion:
      'Etapa del pipeline de agregación de MongoDB que realiza una combinación externa izquierda (LEFT OUTER JOIN) entre colecciones referenciadas.',
    ejemploConcreto: '{ $lookup: { from: "clientes", localField: "id_cliente", foreignField: "id_cliente", as: "dueño" } }',
    esRelevanteParaProyecto: (p) => p?.motorSeleccionado === 'mongodb',
  },

  // --- CONSULTAS ---
  {
    id: 'select',
    termino: 'Consulta SELECT',
    categoria: 'consultas',
    definicion:
      'Sentencia SQL declarativa empleada para consultar y recuperar datos desde una o más tablas en el catálogo.',
    ejemploConcreto: 'SELECT nombre, peso_kg FROM mascotas WHERE activo = 1 ORDER BY peso_kg DESC LIMIT 5;',
    esRelevanteParaProyecto: (p) => Boolean(p?.informes && p.informes.length > 0),
  },
  {
    id: 'join',
    termino: 'Cláusula JOIN',
    categoria: 'consultas',
    definicion:
      'Operación relacional que combina filas de dos o más tablas basándose en una columna relacionada común (típicamente PK = FK).',
    ejemploConcreto: 'SELECT m.nombre, c.nombre_completo FROM mascotas m JOIN clientes c ON m.id_cliente = c.id_cliente;',
    esRelevanteParaProyecto: (p) => (p?.modelo?.relaciones?.length ?? 0) > 0,
  },
  {
    id: 'group-by',
    termino: 'GROUP BY y Agregaciones',
    categoria: 'consultas',
    definicion:
      'Agrupa filas que tienen los mismos valores en columnas especificadas para calcular métricas resumen como COUNT(), SUM(), AVG(), MIN() o MAX().',
    ejemploConcreto: 'SELECT especie, COUNT(*) AS total, AVG(peso_kg) AS peso_promedio FROM mascotas GROUP BY especie;',
    esRelevanteParaProyecto: (p) => Boolean(p?.informes && p.informes.length > 0),
  },
] as const;

export const TERMINOS_GLOSARIO = LISTA_GLOSARIO;

export function obtenerTerminosGlosario(
  arg1?: CategoriaGlosario | 'todas' | ProyectoEstado,
  arg2?: ProyectoEstado | boolean,
  arg3 = false
): TerminoGlosario[] {
  let categoria: CategoriaGlosario | undefined;
  let proyecto: ProyectoEstado | undefined;
  let soloRelevantes = false;

  if (typeof arg1 === 'string') {
    if (arg1 !== 'todas') {
      categoria = arg1;
    }
    if (typeof arg2 === 'object') {
      proyecto = arg2;
      soloRelevantes = Boolean(arg3);
    } else if (typeof arg2 === 'boolean') {
      soloRelevantes = arg2;
    }
  } else if (typeof arg1 === 'object') {
    proyecto = arg1;
    if (typeof arg2 === 'boolean') {
      soloRelevantes = arg2;
    }
  }

  let lista: TerminoGlosario[] = [...LISTA_GLOSARIO];
  if (soloRelevantes && proyecto) {
    lista = lista.filter(
      (item) => !item.esRelevanteParaProyecto || item.esRelevanteParaProyecto(proyecto)
    );
  }
  if (categoria) {
    lista = lista.filter((item) => item.categoria === categoria);
  }
  return lista;
}

function normalizarBusqueda(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function buscarTerminosGlosario(
  query: string,
  categoria?: CategoriaGlosario,
  proyecto?: ProyectoEstado,
  soloRelevantes = false
): TerminoGlosario[] {
  const listaBase = obtenerTerminosGlosario(categoria, proyecto, soloRelevantes);
  const qLimpia = normalizarBusqueda(query.trim());

  return listaBase.filter((item) => {
    if (!qLimpia) return true;
    const coincideTexto =
      normalizarBusqueda(item.termino).includes(qLimpia) ||
      normalizarBusqueda(item.definicion).includes(qLimpia) ||
      normalizarBusqueda(item.ejemploConcreto).includes(qLimpia) ||
      normalizarBusqueda(item.id).includes(qLimpia);
    return coincideTexto;
  });
}
