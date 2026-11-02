import { z } from 'zod';

/**
 * Tipos conceptuales permitidos para los atributos en el paso 3 del asistente.
 */
export const TipoConceptualSchema = z.enum([
  'texto',
  'entero',
  'decimal',
  'fecha',
  'fecha_hora',
  'booleano',
]);

export type TipoConceptual = z.infer<typeof TipoConceptualSchema>;

/**
 * Esquema de un atributo dentro de una entidad conceptual.
 * Incluye la justificación pedagógica de la sugerencia (por ej. por qué usar un ID numérico como PK).
 */
export const AtributoSchema = z.object({
  nombre: z.string().min(1, 'El nombre del atributo es obligatorio'),
  tipoConceptual: TipoConceptualSchema,
  obligatorio: z.boolean(),
  unico: z.boolean(),
  esClavePrimaria: z.boolean(),
  valoresPermitidos: z.array(z.string()).optional(),
  justificacion: z.string().min(1, 'La justificación pedagógica es obligatoria'),
});

export type Atributo = z.infer<typeof AtributoSchema>;

/**
 * Esquema de una entidad del modelo conceptual.
 */
export const EntidadSchema = z.object({
  nombre: z.string().min(1, 'El nombre de la entidad es obligatorio'),
  descripcion: z.string().min(1, 'La descripción de la entidad es obligatoria'),
  atributos: z.array(AtributoSchema).min(1, 'Cada entidad debe tener al menos un atributo'),
});

export type Entidad = z.infer<typeof EntidadSchema>;

/**
 * Cardinalidades permitidas entre dos entidades.
 */
export const CardinalidadSchema = z.enum(['1:1', '1:N', 'N:M']);

export type Cardinalidad = z.infer<typeof CardinalidadSchema>;

/**
 * Esquema de una relación conceptual entre dos entidades.
 */
export const RelacionSchema = z.object({
  origen: z.string().min(1, 'La entidad de origen es obligatoria'),
  destino: z.string().min(1, 'La entidad de destino es obligatoria'),
  cardinalidad: CardinalidadSchema,
  descripcion: z.string().min(1, 'La descripción de la relación es obligatoria'),
  obligatoriaEnOrigen: z.boolean(),
  obligatoriaEnDestino: z.boolean(),
});

export type Relacion = z.infer<typeof RelacionSchema>;

/**
 * Esquema del Modelo Conceptual completo.
 * El Modelo confirmado por el estudiante es la única fuente de verdad para los pasos siguientes.
 */
export const ModeloSchema = z.object({
  entidades: z.array(EntidadSchema),
  relaciones: z.array(RelacionSchema),
});

export type Modelo = z.infer<typeof ModeloSchema>;

/**
 * Esquema de respuesta de evaluación de claridad (Paso 2 — Aclaración guiada).
 * Devuelve un máximo de 5 preguntas concretas por ronda cuando la información no es suficiente.
 */
export const AclaracionSchema = z.object({
  suficiente: z.boolean(),
  preguntas: z.array(z.string().min(1)).max(5, 'Máximo 5 preguntas por ronda'),
  supuestosAConfirmar: z.array(z.string().min(1)),
});

export type Aclaracion = z.infer<typeof AclaracionSchema>;

/**
 * Esquema de una observación de diseño emitida por el validador o explicada por la IA.
 */
export const ObservacionDisenoSchema = z.object({
  gravedad: z.enum(['error', 'advertencia', 'sugerencia']),
  mensaje: z.string().min(1),
  explicacionConceptual: z.string().min(1),
});

export type ObservacionDiseno = z.infer<typeof ObservacionDisenoSchema>;

/**
 * Esquema de un registro en la bitácora de decisiones del estudiante.
 * Registra qué preguntó la IA, qué respondió el estudiante y qué cambios aceptó, editó o rechazó.
 */
export const DecisionSchema = z.object({
  paso: z.number().int().min(1).max(8),
  fecha: z.string().min(1),
  descripcion: z.string().min(1),
  origen: z.enum(['estudiante', 'ia_aceptada', 'ia_rechazada']),
});

export type Decision = z.infer<typeof DecisionSchema>;

/**
 * Esquema para registrar cada ronda de preguntas y respuestas durante el Paso 2.
 */
export const RondaAclaracionSchema = z.object({
  numeroRonda: z.number().int().min(1).max(3),
  preguntas: z.array(z.string()),
  supuestos: z.array(z.string()),
  respuestasEstudiante: z.record(z.string(), z.string()),
  supuestosConfirmados: z.boolean(),
});

export type RondaAclaracion = z.infer<typeof RondaAclaracionSchema>;

/**
 * Esquema de salida cuando la IA propone el modelo conceptual inicial en el Paso 3.
 */
export const PropuestaModeloConceptualSchema = z.object({
  entidades: z.array(EntidadSchema).min(1),
  explicacionGeneral: z.string().min(1),
});

export type PropuestaModeloConceptual = z.infer<typeof PropuestaModeloConceptualSchema>;

/**
 * Esquema de una explicación pedagógica generada por la IA para una observación del validador.
 */
export const ExplicacionObservacionSchema = z.object({
  codigo: z.string(),
  mensaje: z.string(),
  explicacionPedagogica: z.string().min(1),
  ejemploConcreto: z.string().min(1),
  comoResolverlo: z.string().min(1),
});

export type ExplicacionObservacion = z.infer<typeof ExplicacionObservacionSchema>;

/**
 * Respuesta completa de la IA al solicitar explicaciones pedagógicas de las observaciones.
 */
export const RespuestaExplicacionObservacionesSchema = z.object({
  explicaciones: z.array(ExplicacionObservacionSchema),
  resumenTutor: z.string().min(1),
});

export type RespuestaExplicacionObservaciones = z.infer<
  typeof RespuestaExplicacionObservacionesSchema
>;

/**
 * Esquema de salida cuando la IA propone relaciones conceptuales iniciales en el Paso 4.
 */
export const PropuestaRelacionesSchema = z.object({
  relaciones: z.array(RelacionSchema),
  justificacionGeneral: z.string().min(1),
});

export type PropuestaRelaciones = z.infer<typeof PropuestaRelacionesSchema>;

/**
 * Motores de bases de datos contemplados por el asistente pedagógico.
 */
export const MotorBaseDatosSchema = z.enum([
  'sqlite',
  'postgresql',
  'mysql',
  'mongodb',
]);

export type MotorBaseDatos = z.infer<typeof MotorBaseDatosSchema>;

/**
 * Acciones referenciales para claves foráneas (ON DELETE / ON UPDATE).
 */
export const AccionClaveForaneaSchema = z.enum([
  'CASCADE',
  'RESTRICT',
  'SET NULL',
  'NO ACTION',
]);

export type AccionClaveForanea = z.infer<typeof AccionClaveForaneaSchema>;

/**
 * Opciones pedagógicas y técnicas para la generación del script DDL.
 */
export const OpcionesGeneracionDDLSchema = z.object({
  onDelete: AccionClaveForaneaSchema.default('CASCADE'),
  onUpdate: AccionClaveForaneaSchema.default('CASCADE'),
  incluirComentarios: z.boolean().default(true),
  habilitarClavesForaneas: z.boolean().default(true),
});

export type OpcionesGeneracionDDL = z.infer<typeof OpcionesGeneracionDDLSchema>;

/**
 * Detalle explicativo de una tabla en el script DDL generado, con normalización tolerante
 * ante variaciones en la salida de los LLMs (ej: 'table', 'explanation', 'keys', etc.).
 */
export const ExplicacionDDLPorTablaSchema = z.preprocess(
  (val: any) => {
    if (!val || typeof val !== 'object') return val;
    const tabla =
      val.tabla ??
      val.table ??
      val.nombreTabla ??
      val.nombre ??
      val.name ??
      '';
    const explicacion =
      val.explicacion ??
      val.explanation ??
      val.proposito ??
      val.propositoDidactico ??
      val.descripcion ??
      val.explicacionTipos ??
      (Array.isArray(val.lineasClaveExplicadas)
        ? val.lineasClaveExplicadas.join(' ')
        : 'Estructura relacional definida.');
    const detalleClaves =
      val.detalleClaves ??
      val.claves ??
      val.keys ??
      val.justificacionClaves ??
      val.clavesPrimarias ??
      'Claves primarias y foráneas según el modelo.';
    return { tabla, explicacion, detalleClaves };
  },
  z.object({
    tabla: z.string(),
    explicacion: z.string(),
    detalleClaves: z.string(),
  })
);

export type ExplicacionDDLPorTabla = z.infer<typeof ExplicacionDDLPorTablaSchema>;

/**
 * Explicación línea por línea / pedagógica del script DDL generado por el tutor IA,
 * con normalización tolerante de sinónimos para Gemini y OpenRouter.
 */
export const ExplicacionDDLSchema = z.preprocess(
  (val: any) => {
    if (!val || typeof val !== 'object') return val;
    const resumenPedagogico =
      val.resumenPedagogico ??
      val.resumen ??
      val.resumenGeneral ??
      val.summary ??
      'El script DDL traduce el modelo conceptual al dialecto de base de datos objetivo con tipos y claves.';

    const explicacionPorTabla = Array.isArray(val.explicacionPorTabla)
      ? val.explicacionPorTabla
      : Array.isArray(val.tablas)
      ? val.tablas
      : Array.isArray(val.tables)
      ? val.tables
      : Array.isArray(val.explicaciones)
      ? val.explicaciones
      : typeof val.explicacionPorTabla === 'object' && val.explicacionPorTabla !== null
      ? Object.entries(val.explicacionPorTabla).map(([tabla, contenido]: [string, any]) => ({
          tabla,
          ...(typeof contenido === 'object' && contenido !== null
            ? contenido
            : { explicacion: String(contenido) }),
        }))
      : [];

    let observacionesTutor: string[] = [];
    const obsCrudas =
      val.observacionesTutor ??
      val.observaciones ??
      val.observacionesDidacticas ??
      val.advertenciasBuenasPracticas ??
      val.advertencias ??
      val.consejos ??
      val.tips;

    if (Array.isArray(obsCrudas)) {
      observacionesTutor = obsCrudas.map((item: any) => {
        if (typeof item === 'string') return item;
        if (typeof item === 'object' && item !== null) {
          return item.consejo ?? item.mensaje ?? item.texto ?? item.definicion ?? JSON.stringify(item);
        }
        return String(item);
      });
    } else if (typeof obsCrudas === 'string') {
      observacionesTutor = [obsCrudas];
    } else if (Array.isArray(val.conceptosClave)) {
      observacionesTutor = val.conceptosClave.map(
        (c: any) => `${c.concepto}: ${c.definicion || ''}`
      );
    }

    if (observacionesTutor.length === 0) {
      observacionesTutor = [
        'Asegurate de verificar la integridad referencial antes de poblar datos.',
      ];
    }

    return {
      resumenPedagogico,
      explicacionPorTabla,
      observacionesTutor,
    };
  },
  z.object({
    resumenPedagogico: z.string(),
    explicacionPorTabla: z.array(ExplicacionDDLPorTablaSchema),
    observacionesTutor: z.array(z.string()),
  })
);

export type ExplicacionDDL = z.infer<typeof ExplicacionDDLSchema>;

/**
 * Esquema de datos de ejemplo para una tabla particular, con normalización tolerante
 * ante variaciones en la salida de los LLMs (ej: 'table', 'name', 'rows', 'datos', etc.).
 */
export const TablaDatosEjemploSchema = z.preprocess((val: any) => {
  if (!val || typeof val !== 'object') return val;
  const tabla =
    val.tabla ??
    val.nombreTabla ??
    val.nombre ??
    val.table ??
    val.name ??
    val.entidad ??
    val.entity ??
    '';
  const filasCrudas = Array.isArray(val.filas)
    ? val.filas
    : Array.isArray(val.rows)
    ? val.rows
    : Array.isArray(val.data)
    ? val.data
    : Array.isArray(val.datos)
    ? val.datos
    : Array.isArray(val.registros)
    ? val.registros
    : Array.isArray(val.items)
    ? val.items
    : [];
  let columnas = Array.isArray(val.columnas)
    ? val.columnas
    : Array.isArray(val.columns)
    ? val.columns
    : [];

  // Si las filas vinieron como arreglos posicionales [[1, "Ana"], ...] y hay columnas, convertirlas a objetos
  const filas = filasCrudas.map((f: any) => {
    if (Array.isArray(f) && columnas.length > 0) {
      const obj: Record<string, any> = {};
      columnas.forEach((col: string, i: number) => {
        obj[col] = f[i] ?? null;
      });
      return obj;
    }
    return f && typeof f === 'object' ? f : {};
  });

  if (columnas.length === 0 && filas.length > 0 && typeof filas[0] === 'object') {
    columnas = Object.keys(filas[0]);
  }
  return {
    tabla: String(tabla),
    columnas,
    filas,
  };
}, z.object({
  tabla: z.string().min(1),
  columnas: z.array(z.string()),
  filas: z.array(z.record(z.string(), z.any())),
}));

export type TablaDatosEjemplo = z.infer<typeof TablaDatosEjemploSchema>;

/**
 * Conjunto completo de datos de ejemplo generado para todas las tablas del modelo,
 * con normalización tolerante para ordenInsercion, resumenDidactico y estructuras de tablas.
 */
export const ConjuntoDatosEjemploSchema = z.preprocess((val: any) => {
  if (!val || typeof val !== 'object') return val;

  let tablas: any[] = [];
  if (Array.isArray(val.tablas)) {
    tablas = val.tablas;
  } else if (Array.isArray(val.tables)) {
    tablas = val.tables;
  } else if (Array.isArray(val.datos)) {
    tablas = val.datos;
  } else if (Array.isArray(val.data)) {
    tablas = val.data;
  } else if (val.tablas && typeof val.tablas === 'object') {
    // Si el LLM devolvió un diccionario { nombreTabla: [filas...] }
    tablas = Object.entries(val.tablas).map(([nombre, contenido]: [string, any]) => {
      if (Array.isArray(contenido)) {
        return { tabla: nombre, filas: contenido };
      }
      if (contenido && typeof contenido === 'object') {
        return { tabla: nombre, ...contenido };
      }
      return { tabla: nombre, filas: [] };
    });
  }

  let ordenInsercion = Array.isArray(val.ordenInsercion)
    ? val.ordenInsercion
    : Array.isArray(val.insertionOrder)
    ? val.insertionOrder
    : [];
  if (ordenInsercion.length === 0 && tablas.length > 0) {
    ordenInsercion = tablas.map(
      (t: any) => t.tabla ?? t.nombreTabla ?? t.nombre ?? t.table ?? t.name ?? ''
    );
  }
  const resumenDidactico =
    val.resumenDidactico ??
    val.resumen ??
    val.summary ??
    'Conjunto de datos de prueba coherentes generados para el modelo.';
  return {
    tablas,
    ordenInsercion,
    resumenDidactico: String(resumenDidactico),
  };
}, z.object({
  tablas: z.array(TablaDatosEjemploSchema),
  ordenInsercion: z.array(z.string()),
  resumenDidactico: z.string(),
}));

export type ConjuntoDatosEjemplo = z.infer<typeof ConjuntoDatosEjemploSchema>;

/**
 * Tipos de gráficos soportados para la visualización de informes.
 */
export const TipoGraficoInformeSchema = z.enum([
  'ninguno',
  'barras',
  'torta',
  'lineas',
]);

export type TipoGraficoInforme = z.infer<typeof TipoGraficoInformeSchema>;

/**
 * Resultado estructurado de la ejecución de una consulta SELECT en SQLite.
 */
export const ResultadoInformeSchema = z.object({
  columnas: z.array(z.string()),
  filas: z.array(z.array(z.any())),
  totalFilas: z.number(),
  tiempoMs: z.number(),
});

export type ResultadoInforme = z.infer<typeof ResultadoInformeSchema>;

/**
 * Esquema de un informe personalizado (Paso 8 del asistente).
 */
export const InformeSchema = z.object({
  id: z.string(),
  titulo: z.string(),
  pedidoLenguajeNatural: z.string(),
  consultaSQL: z.string(),
  explicacionPasoAPaso: z.string(),
  tipoGrafico: TipoGraficoInformeSchema,
  columnaEtiquetas: z.string().optional(),
  columnaValores: z.string().optional(),
  resultado: ResultadoInformeSchema.optional(),
  fechaCreacion: z.string(),
});

export type Informe = z.infer<typeof InformeSchema>;

/**
 * Propuesta estructurada generada por el tutor IA al traducir una solicitud en lenguaje natural,
 * con normalización tolerante ante sinónimos devueltos por distintos LLMs.
 */
export const PropuestaInformeIASchema = z.preprocess((val: any) => {
  if (!val || typeof val !== 'object') return val;
  const titulo =
    val.titulo ??
    val.title ??
    val.nombre ??
    val.name ??
    'Informe de consulta analítica';
  const consultaSQL =
    val.consultaSQL ??
    val.consultaSql ??
    val.sql ??
    val.query ??
    val.consulta ??
    val.select ??
    '';
  const explicacionPasoAPaso =
    val.explicacionPasoAPaso ??
    val.explicacion ??
    val.explanation ??
    val.pasoAPaso ??
    (Array.isArray(val.pasos)
      ? val.pasos.join('\n')
      : 'Consulta SELECT estructurada sobre las tablas del modelo.');

  const rawGrafico = String(
    val.tipoGraficoSugerido ?? val.tipoGrafico ?? val.chartType ?? val.grafico ?? 'ninguno'
  ).toLowerCase();
  let tipoGraficoSugerido: TipoGraficoInforme = 'ninguno';
  if (rawGrafico.includes('barra') || rawGrafico.includes('bar')) {
    tipoGraficoSugerido = 'barras';
  } else if (
    rawGrafico.includes('torta') ||
    rawGrafico.includes('pie') ||
    rawGrafico.includes('donut') ||
    rawGrafico.includes('pastel')
  ) {
    tipoGraficoSugerido = 'torta';
  } else if (rawGrafico.includes('linea') || rawGrafico.includes('line')) {
    tipoGraficoSugerido = 'lineas';
  }

  const columnaEtiquetas =
    val.columnaEtiquetas ??
    val.labelColumn ??
    val.ejeX ??
    val.categoria ??
    undefined;
  const columnaValores =
    val.columnaValores ??
    val.valueColumn ??
    val.ejeY ??
    val.metrica ??
    undefined;
  const resumenDidactico =
    val.resumenDidactico ??
    val.resumen ??
    val.summary ??
    'Informe generado para responder la consulta sobre el modelo relacional.';

  return {
    titulo: String(titulo),
    consultaSQL: String(consultaSQL),
    explicacionPasoAPaso: String(explicacionPasoAPaso),
    tipoGraficoSugerido,
    ...(columnaEtiquetas ? { columnaEtiquetas: String(columnaEtiquetas) } : {}),
    ...(columnaValores ? { columnaValores: String(columnaValores) } : {}),
    resumenDidactico: String(resumenDidactico),
  };
}, z.object({
  titulo: z.string().min(1),
  consultaSQL: z.string().min(1),
  explicacionPasoAPaso: z.string(),
  tipoGraficoSugerido: TipoGraficoInformeSchema,
  columnaEtiquetas: z.string().optional(),
  columnaValores: z.string().optional(),
  resumenDidactico: z.string(),
}));

export type PropuestaInformeIA = z.infer<typeof PropuestaInformeIASchema>;

/**
 * Esquemas para el Análisis Resumido pedagógico (Entregables / Sección 8).
 * Diseñado como evidencia de aprendizaje para el docente.
 */
export const DecisionDisenoClaveSchema = z.object({
  decision: z.string(),
  justificacion: z.string(),
  origen: z.enum(['estudiante', 'ia_aceptada', 'ia_rechazada']),
});

export type DecisionDisenoClave = z.infer<typeof DecisionDisenoClaveSchema>;

export const ObservacionValidadorResolucionSchema = z.object({
  observacion: z.string(),
  resolucion: z.string(),
});

export type ObservacionValidadorResolucion = z.infer<typeof ObservacionValidadorResolucionSchema>;

export const ResumenInformeAnalisisSchema = z.object({
  titulo: z.string(),
  preguntaQueResponde: z.string(),
  consultaSql: z.string(),
});

export type ResumenInformeAnalisis = z.infer<typeof ResumenInformeAnalisisSchema>;

export const AnalisisResumidoSchema = z.object({
  problemaYAlcance: z.string(),
  decisionesDisenoClave: z.array(DecisionDisenoClaveSchema),
  observacionesValidadorYResolucion: z.array(ObservacionValidadorResolucionSchema),
  motorElegidoYJustificacion: z.string(),
  limitacionesDelMotor: z.string(),
  resumenInformes: z.array(ResumenInformeAnalisisSchema),
  puntosAMejorarYProximosPasos: z.array(z.string()),
});

export type AnalisisResumido = z.infer<typeof AnalisisResumidoSchema>;

/**
 * Esquema completo del proyecto persistido en IndexedDB o exportado/importado como JSON.
 * Nota de seguridad: strip() es el comportamiento por defecto de Zod para eliminar claves desconocidas,
 * y jamás incluye la API key.
 */
export const ProyectoEstadoSchema = z.object({
  version: z.literal(1),
  actualizadoEn: z.string(),
  pasoActual: z.number().int().min(1).max(9),
  descripcionProblema: z.string(),
  rondasAclaracion: z.array(RondaAclaracionSchema).max(3),
  ultimaAclaracion: AclaracionSchema.nullable(),
  claridadConfirmada: z.boolean(),
  modelo: ModeloSchema,
  explicacionModelo: z.string().optional(),
  modeloConceptualConfirmado: z.boolean(),
  relacionesConfirmadas: z.boolean().optional(),
  explicacionRelaciones: z.string().optional(),
  diagramaConfirmado: z.boolean().optional(),
  motorSeleccionado: MotorBaseDatosSchema.default('sqlite').optional(),
  opcionesDDL: OpcionesGeneracionDDLSchema.optional(),
  ddlGenerado: z.string().optional(),
  explicacionDDL: ExplicacionDDLSchema.optional(),
  ddlConfirmado: z.boolean().optional(),
  cantidadFilasEjemplo: z.number().int().min(1).max(20).optional(),
  datosEjemplo: ConjuntoDatosEjemploSchema.optional(),
  datosConfirmados: z.boolean().optional(),
  baseSQLiteGenerada: z.boolean().optional(),
  informes: z.array(InformeSchema).optional(),
  informesConfirmados: z.boolean().optional(),
  analisisResumido: AnalisisResumidoSchema.optional(),
  bitacora: z.array(DecisionSchema),
});

export type ProyectoEstado = z.infer<typeof ProyectoEstadoSchema>;

export function crearProyectoInicial(): ProyectoEstado {
  return {
    version: 1,
    actualizadoEn: new Date().toISOString(),
    pasoActual: 1,
    descripcionProblema: '',
    rondasAclaracion: [],
    ultimaAclaracion: null,
    claridadConfirmada: false,
    modelo: {
      entidades: [],
      relaciones: [],
    },
    explicacionModelo: '',
    modeloConceptualConfirmado: false,
    relacionesConfirmadas: false,
    explicacionRelaciones: '',
    diagramaConfirmado: false,
    motorSeleccionado: 'sqlite',
    opcionesDDL: {
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
      incluirComentarios: true,
      habilitarClavesForaneas: true,
    },
    ddlGenerado: '',
    ddlConfirmado: false,
    cantidadFilasEjemplo: 3,
    datosConfirmados: false,
    baseSQLiteGenerada: false,
    informes: [],
    informesConfirmados: false,
    bitacora: [],
  };
}
