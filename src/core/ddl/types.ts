import {
  AccionClaveForanea,
  MotorBaseDatos,
  OpcionesGeneracionDDL,
} from '../schemas';

export type { AccionClaveForanea, MotorBaseDatos, OpcionesGeneracionDDL };

/**
 * Información pedagógica y técnica sobre cada motor soportado.
 */
export interface InformacionMotor {
  id: MotorBaseDatos;
  nombre: string;
  etiqueta: string;
  descripcion: string;
  ejecutableEnNavegador: boolean;
  tecnologiaNavegador?: string;
  disponible: boolean;
  fase: number;
  notaPedagogica: string;
}

export const LISTA_MOTORES: readonly InformacionMotor[] = [
  {
    id: 'sqlite',
    nombre: 'SQLite',
    etiqueta: 'Recomendado para principiantes',
    descripcion:
      'Motor relacional embebido, liviano y sin configuración. Ideal para aprender SQL estándar.',
    ejecutableEnNavegador: true,
    tecnologiaNavegador: 'sql.js (WASM en Web Worker)',
    disponible: true,
    fase: 4,
    notaPedagogica:
      'Se ejecuta 100% en tu navegador mediante WebAssembly (WASM). No envía datos a ningún servidor y podés descargar la base de datos real (.sqlite) para abrirla en SQLite Viewer, DBeaver o VS Code.',
  },
  {
    id: 'postgresql',
    nombre: 'PostgreSQL',
    etiqueta: 'Estándar empresarial abierto',
    descripcion:
      'Motor relacional avanzado con soporte estricto de tipos, claves foráneas y extensiones.',
    ejecutableEnNavegador: true,
    tecnologiaNavegador: 'PGlite (WASM en navegador)',
    disponible: true,
    fase: 7,
    notaPedagogica:
      'Se ejecuta 100% en tu navegador mediante WebAssembly (WASM) utilizando PGlite (PostgreSQL real compilado a WASM). Soporta tipos nativos (SERIAL, TIMESTAMP, NUMERIC), constraints CHECK, comentarios del estándar y consultas relacionales avanzadas sin requerir ningún servidor externo.',
  },
  {
    id: 'mysql',
    nombre: 'MySQL',
    etiqueta: 'Motor relacional popular',
    descripcion:
      'Ampliamente utilizado en desarrollo web (LAMP/LEMP). Tipos estándar y dialecto propio.',
    ejecutableEnNavegador: false,
    disponible: true,
    fase: 7,
    notaPedagogica:
      'Generación de script DDL determinístico con dialecto específico de MySQL (InnoDB, ENGINE=InnoDB, AUTO_INCREMENT, DEFAULT CHARSET=utf8mb4). Por limitaciones arquitectónicas de su servidor original en C/C++, no es viable ejecutar MySQL completo dentro del navegador. El script generado está 100% validado con parser AST y listo para importar en phpMyAdmin, MySQL Workbench o consola.',
  },
  {
    id: 'mongodb',
    nombre: 'MongoDB',
    etiqueta: 'NoSQL Documental',
    descripcion:
      'Modelo no relacional basado en colecciones y documentos JSON/BSON. Cambia el paradigma relacional a embebido vs. referenciado.',
    ejecutableEnNavegador: false,
    tecnologiaNavegador: 'Script mongosh / Compass (.js)',
    disponible: true,
    fase: 8,
    notaPedagogica:
      'Generación de script determinístico para mongosh (.js) con esquemas de validación JSON Schema ($jsonSchema), colecciones tipadas en BSON, índices sugeridos (únicos y de referencia), documentos de ejemplo y análisis pedagógico de embeber vs. referenciar. Por limitaciones arquitectónicas de su servidor nativo en C++ (WiredTiger), MongoDB no se ejecuta directamente en el navegador estático. El script generado está 100% verificado y listo para ejecutar en mongosh, MongoDB Compass o MongoDB Atlas.',
  },
] as const;

/**
 * Representación intermedia de una columna SQL.
 */
export interface DefinicionColumnaSQL {
  nombre: string;
  tipoSQL: string;
  esPK: boolean;
  esAutoincrement: boolean;
  nullable: boolean;
  unico: boolean;
  checkExpr?: string;
  justificacion?: string;
}

/**
 * Representación intermedia de una clave foránea SQL.
 */
export interface DefinicionClaveForaneaSQL {
  columnaLocal: string;
  tablaReferenciada: string;
  columnaReferenciada: string;
  onDelete: AccionClaveForanea;
  onUpdate: AccionClaveForanea;
}

/**
 * Representación intermedia de una tabla SQL lista para emitir DDL.
 */
export interface DefinicionTablaSQL {
  nombre: string;
  columnas: DefinicionColumnaSQL[];
  clavesPrimarias: string[];
  clavesForaneas: DefinicionClaveForaneaSQL[];
  comentario?: string;
}
