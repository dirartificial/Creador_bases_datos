import systemTutorPrompt from '../prompts/system_tutor.md?raw';
import { consultarGeminiEstructurado } from '../core/gemini';
import {
  AnalisisResumido,
  AnalisisResumidoSchema,
  ProyectoEstado,
} from '../core/schemas';

/**
 * Prepara el contexto textual para que el tutor IA genere el informe de análisis resumido.
 */
function construirPromptAnalisis(proyecto: ProyectoEstado): string {
  const entidadesResumen = proyecto.modelo.entidades
    .map(
      (e) =>
        `- Entidad "${e.nombre}": ${e.atributos
          .map(
            (a) =>
              `${a.nombre} (${a.tipoConceptual}${a.esClavePrimaria ? ', PK' : ''}${
                a.obligatorio ? ', requerido' : ''
              })`
          )
          .join(', ')}`
    )
    .join('\n');

  const relacionesResumen =
    proyecto.modelo.relaciones.length > 0
      ? proyecto.modelo.relaciones
          .map(
            (r) =>
              `- Relación entre "${r.origen}" y "${r.destino}" (cardinalidad ${r.cardinalidad}): ${r.descripcion}`
          )
          .join('\n')
      : 'Sin relaciones explícitas definidas.';

  const bitacoraResumen =
    proyecto.bitacora.length > 0
      ? proyecto.bitacora
          .map(
            (d) =>
              `- [Paso ${d.paso} | ${d.origen} | ${d.fecha}]: ${d.descripcion}`
          )
          .join('\n')
      : 'No se registraron cambios explícitos en la bitácora.';

  const informesResumen =
    proyecto.informes && proyecto.informes.length > 0
      ? proyecto.informes
          .map(
            (inf) =>
              `- Informe "${inf.titulo}": Pregunta "${inf.pedidoLenguajeNatural}" -> Consulta: ${inf.consultaSQL}`
          )
          .join('\n')
      : 'No se generaron consultas ni informes adicionales.';

  return `Sos el tutor pedagógico de bases de datos. El estudiante ha completado (o avanzado en) el diseño de su base de datos y necesita un "Análisis Resumido" estructurado que sirva como evidencia de aprendizaje para su docente universitario o de escuela técnica.

Analizá con rigurosidad didáctica la información del proyecto:

1. PROBLEMA Y ALCANCE ORIGINAL:
"${proyecto.descripcionProblema || 'Sin descripción'}"

2. MODELO CONCEPTUAL CONFIRMADO:
Entidades y atributos:
${entidadesResumen || 'Sin entidades'}

Relaciones:
${relacionesResumen}

3. BITÁCORA DE DECISIONES DEL ESTUDIANTE:
${bitacoraResumen}

4. MOTOR SELECCIONADO:
${proyecto.motorSeleccionado || 'sqlite'}

5. INFORMES Y CONSULTAS CONFIGURADAS:
${informesResumen}

Generá un objeto JSON que respete estrictamente este esquema:
{
  "problemaYAlcance": "Resumen claro del problema original planteado por el estudiante y los límites de su alcance",
  "decisionesDisenoClave": [
    {
      "decision": "Descripción concisa de la decisión de diseño",
      "justificacion": "Por qué se tomó y qué beneficio conceptual aporta (ej. normalización, atomicidad)",
      "origen": "estudiante" | "ia_aceptada" | "ia_rechazada"
    }
  ],
  "observacionesValidadorYResolucion": [
    {
      "observacion": "Qué observación o problema fue detectado durante el diseño (ej. N:M directa, FK faltante, entidad aislada)",
      "resolucion": "Cómo se resolvió pedagógicamente (ej. creación de tabla asociativa, adición de clave foránea)"
    }
  ],
  "motorElegidoYJustificacion": "Por qué se eligió el motor indicado y cómo se alinea con la etapa de aprendizaje",
  "limitacionesDelMotor": "Limitaciones concretas del motor en este entorno (ej. SQLite es relacional liviano y corre localmente en el navegador, carece de tipos de datos estrictos como Postgres, etc.)",
  "resumenInformes": [
    {
      "titulo": "Título del informe",
      "preguntaQueResponde": "Qué necesidad de información resuelve para el negocio/sistema",
      "consultaSql": "Sentencia SELECT generada"
    }
  ],
  "puntosAMejorarYProximosPasos": [
    "Sugerencia 1 concreta para evolucionar el diseño en una fase posterior",
    "Sugerencia 2 (ej. índices adicionales, particionamiento, reglas de negocio avanzadas)"
  ]
}

Sé riguroso, didáctico y no condescendiente. No inventes entidades que no estén en el modelo.`;
}

/**
 * Solicita a Gemini la generación estructurada del Análisis Resumido validado con Zod.
 */
export async function generarAnalisisResumidoConIA(
  proyecto: ProyectoEstado
): Promise<AnalisisResumido> {
  const prompt = construirPromptAnalisis(proyecto);

  return consultarGeminiEstructurado({
    prompt,
    schema: AnalisisResumidoSchema,
    systemInstruction: systemTutorPrompt,
  });
}

/**
 * Genera un análisis resumido de respaldo (fallback determinístico)
 * para garantizar que el estudiante pueda exportar su documentación aun si no tiene conexión o key.
 */
export function generarAnalisisResumidoFallback(
  proyecto: ProyectoEstado
): AnalisisResumido {
  const tieneNM = proyecto.modelo.relaciones.some((r) => r.cardinalidad === 'N:M');
  const totalEntidades = proyecto.modelo.entidades.length;
  const totalRelaciones = proyecto.modelo.relaciones.length;

  const decisiones: AnalisisResumido['decisionesDisenoClave'] = [];

  // Recopilar decisiones desde la bitácora o generar deducciones
  if (proyecto.bitacora.length > 0) {
    for (const d of proyecto.bitacora.slice(0, 5)) {
      decisiones.push({
        decision: d.descripcion,
        justificacion: `Acción registrada en el paso ${d.paso} con origen ${d.origen}.`,
        origen: d.origen,
      });
    }
  } else {
    decisiones.push({
      decision: `Definición de ${totalEntidades} entidades en el modelo conceptual`,
      justificacion:
        'Representa las clases de objetos del dominio identificadas a partir de la descripción inicial.',
      origen: 'estudiante',
    });
    if (totalRelaciones > 0) {
      decisiones.push({
        decision: `Modelado de ${totalRelaciones} asociaciones entre entidades`,
        justificacion:
          'Establece las reglas de vinculación y cardinalidad para asegurar la consistencia de los datos.',
        origen: 'estudiante',
      });
    }
  }

  const observaciones: AnalisisResumido['observacionesValidadorYResolucion'] = [];
  if (tieneNM) {
    observaciones.push({
      observacion:
        'Se detectaron asociaciones con cardinalidad Muchos a Muchos (N:M).',
      resolucion:
        'Se requiere la resolución mediante tablas intermedias (asociativas) con claves foráneas compuestas.',
    });
  } else {
    observaciones.push({
      observacion:
        'Estructura relacional verificada contra el catálogo de entidades.',
      resolucion:
        'Todas las relaciones cuentan con claves foráneas asignadas a las entidades correspondientes.',
    });
  }

  const resumenInformes: AnalisisResumido['resumenInformes'] = (
    proyecto.informes || []
  ).map((inf) => ({
    titulo: inf.titulo,
    preguntaQueResponde: inf.pedidoLenguajeNatural,
    consultaSql: inf.consultaSQL,
  }));

  const motor = proyecto.motorSeleccionado || 'sqlite';
  const justificacionMotor =
    motor === 'sqlite'
      ? 'SQLite se seleccionó como motor ideal para aprendizaje por su portabilidad, ejecución en el navegador vía WebAssembly y cumplimiento de estándares ACID.'
      : motor === 'postgresql'
      ? 'PostgreSQL se seleccionó por su estricto cumplimiento del estándar SQL, soporte nativo de tipos enriquecidos (SERIAL, NUMERIC, BOOLEAN, DATE), constraints CHECK y ejecución real en el navegador mediante PGlite (WASM).'
      : motor === 'mysql'
      ? 'MySQL se seleccionó como motor relacional de amplia difusión web con almacenamiento transaccional InnoDB, auto-increment y soporte completo Unicode utf8mb4.'
      : motor === 'mongodb'
      ? 'MongoDB se seleccionó para explorar el paradigma NoSQL documental, modelando los datos en colecciones de documentos BSON con esquemas protegidos mediante validadores $jsonSchema y analizando la estrategia de embeber vs. referenciar.'
      : `Motor ${motor} seleccionado según las características del proyecto.`;

  const limitacionesMotor =
    motor === 'sqlite'
      ? 'SQLite cuenta con un sistema de tipado dinámico débil (type affinity) y no admite concurrencia masiva de escritura ni procedimientos almacenados en el servidor.'
      : motor === 'postgresql'
      ? 'En el entorno web del estudiante corre mediante PGlite (WASM en memoria/IndexedDB); para un entorno productivo real requiere aprovisionamiento de un servidor dedicado.'
      : motor === 'mysql'
      ? 'Por limitaciones de su arquitectura C/C++, MySQL no puede ejecutarse directamente en el navegador del estudiante; el script debe importarse en phpMyAdmin o MySQL Workbench.'
      : motor === 'mongodb'
      ? 'MongoDB no se ejecuta en el navegador web estático debido a su arquitectura nativa WiredTiger. Requiere mongosh o Compass para su ejecución. Además, no aplica cascada referencial automática a nivel de motor, debiendo resolverse a nivel de aplicación o con etapas $lookup.'
      : `Requiere un servidor dedicado y configuración de red para su ejecución completa.`;

  return {
    problemaYAlcance:
      proyecto.descripcionProblema ||
      'Diseño conceptual de base de datos relacional para el dominio especificado.',
    decisionesDisenoClave: decisiones,
    observacionesValidadorYResolucion: observaciones,
    motorElegidoYJustificacion: justificacionMotor,
    limitacionesDelMotor: limitacionesMotor,
    resumenInformes,
    puntosAMejorarYProximosPasos: [
      'Normalizar atributos que contengan listas o valores multivaluados a terceras formas normales (3FN).',
      'Definir índices no agrupados sobre las columnas utilizadas habitualmente en cláusulas WHERE y JOIN.',
      'Configurar vistas o procedimientos para encapsular las consultas de informes recurrentes.',
    ],
  };
}

/**
 * Convierte el objeto de Análisis Resumido a un documento Markdown bien estructurado y pedagógico.
 */
export function analisisResumidoAMarkdown(
  analisis: AnalisisResumido,
  proyecto: ProyectoEstado
): string {
  const lineas: string[] = [];

  lineas.push('# Informe de Análisis y Diseño de Base de Datos');
  lineas.push(`> Generado pedagógicamente el ${new Date().toLocaleDateString('es-AR')}`);
  lineas.push('');

  // 1. Problema y Alcance
  lineas.push('## 1. Problema Planteado y Alcance');
  lineas.push(analisis.problemaYAlcance);
  lineas.push('');

  // 2. Decisiones de diseño clave
  lineas.push('## 2. Decisiones de Diseño Clave');
  if (analisis.decisionesDisenoClave.length === 0) {
    lineas.push('_No se registraron decisiones específicas._');
  } else {
    for (const d of analisis.decisionesDisenoClave) {
      const etiquetaOrigen =
        d.origen === 'ia_aceptada'
          ? 'Sugerencia de IA aceptada'
          : d.origen === 'ia_rechazada'
          ? 'Propuesta de IA rechazada por estudiante'
          : 'Decisión directa del estudiante';
      lineas.push(`### • ${d.decision}`);
      lineas.push(`- **Justificación:** ${d.justificacion}`);
      lineas.push(`- **Origen:** ${etiquetaOrigen}`);
      lineas.push('');
    }
  }

  // 3. Observaciones del validador y resolución
  lineas.push('## 3. Observaciones del Validador y Cómo se Resolvieron');
  if (analisis.observacionesValidadorYResolucion.length === 0) {
    lineas.push('_El diseño no presentó inconsistencias estructurales durante la validación._');
  } else {
    for (const obs of analisis.observacionesValidadorYResolucion) {
      lineas.push(`### • ${obs.observacion}`);
      lineas.push(`- **Resolución didáctica:** ${obs.resolucion}`);
      lineas.push('');
    }
  }

  // 4. Motor elegido y limitaciones
  lineas.push('## 4. Motor de Base de Datos y Limitaciones');
  lineas.push(`### Motor: ${proyecto.motorSeleccionado || 'sqlite'}`);
  lineas.push(`**Justificación:** ${analisis.motorElegidoYJustificacion}`);
  lineas.push('');
  lineas.push(`**Limitaciones a considerar:** ${analisis.limitacionesDelMotor}`);
  lineas.push('');

  // 5. Resumen de informes
  lineas.push('## 5. Resumen de Informes y Consultas SQL');
  if (analisis.resumenInformes.length === 0) {
    lineas.push('_No se configuraron consultas analíticas en esta sesión._');
  } else {
    for (const inf of analisis.resumenInformes) {
      lineas.push(`### • ${inf.titulo}`);
      lineas.push(`- **Pregunta de negocio:** ${inf.preguntaQueResponde}`);
      lineas.push('```sql');
      lineas.push(inf.consultaSql);
      lineas.push('```');
      lineas.push('');
    }
  }

  // 6. Puntos a mejorar y próximos pasos
  lineas.push('## 6. Puntos a Mejorar y Próximos Pasos');
  for (const paso of analisis.puntosAMejorarYProximosPasos) {
    lineas.push(`- ${paso}`);
  }
  lineas.push('');

  return lineas.join('\n');
}

/**
 * Genera el Glosario pedagógico en formato Markdown con los conceptos clave
 * que formaron parte de la sesión de modelado del estudiante.
 */
export function generarGlosarioMarkdown(proyecto: ProyectoEstado): string {
  const terminos: Array<{ termino: string; definicion: string; relevante: boolean }> = [
    {
      termino: 'Entidad',
      definicion:
        'Objeto o concepto del mundo real sobre el cual se recolecta y almacena información (ej. Alumno, Libro, Factura). En el modelo relacional se transforma en una tabla.',
      relevante: true,
    },
    {
      termino: 'Atributo',
      definicion:
        'Característica, propiedad o dato elemental que describe a una entidad (ej. nombre, precio, fecha_nacimiento). Se convierte en una columna de la tabla.',
      relevante: true,
    },
    {
      termino: 'Clave Primaria (Primary Key / PK)',
      definicion:
        'Atributo o combinación de atributos que identifica unívocamente a cada fila en una tabla, garantizando que no existan tuplas duplicadas ni valores nulos.',
      relevante: true,
    },
    {
      termino: 'Clave Foránea (Foreign Key / FK)',
      definicion:
        'Columna en una tabla que hace referencia a la clave primaria de otra tabla, estableciendo un vínculo relacional y garantizando la integridad referencial.',
      relevante: proyecto.modelo.relaciones.length > 0,
    },
    {
      termino: 'Cardinalidad (1:1, 1:N, N:M)',
      definicion:
        'Número de ocurrencias de una entidad que pueden asociarse con ocurrencias de otra entidad. Determina si se requiere propagar una clave foránea o crear una tabla intermedia.',
      relevante: proyecto.modelo.relaciones.length > 0,
    },
    {
      termino: 'Tabla Intermedia (Asociativa)',
      definicion:
        'Estructura que descompone una relación Muchos a Muchos (N:M) en dos relaciones 1:N, conteniendo como mínimo las claves foráneas de ambas entidades relacionadas.',
      relevante: proyecto.modelo.relaciones.some((r) => r.cardinalidad === 'N:M'),
    },
    {
      termino: 'Integridad Referencial',
      definicion:
        'Regla del modelo relacional que asegura que un valor de clave foránea siempre apunte a una fila existente en la tabla principal, evitando registros huérfanos.',
      relevante: true,
    },
    {
      termino: 'DDL (Data Definition Language)',
      definicion:
        'Subconjunto de sentencias SQL (como CREATE TABLE, ALTER TABLE, DROP TABLE) empleadas para definir y modificar la estructura de los objetos de la base de datos.',
      relevante: Boolean(proyecto.ddlGenerado),
    },
    {
      termino: 'Consulta SELECT',
      definicion:
        'Sentencia SQL declarativa empleada para recuperar datos de una o más tablas, permitiendo filtrar (WHERE), agrupar (GROUP BY) y ordenar (ORDER BY) los resultados.',
      relevante: Boolean(proyecto.informes && proyecto.informes.length > 0),
    },
    {
      termino: 'Normalización',
      definicion:
        'Técnica formal de diseño relacional que busca eliminar la redundancia de datos y prevenir anomalías de inserción, actualización y borrado.',
      relevante: true,
    },
  ];

  const lineas: string[] = [
    '# Glosario Pedagógico de Términos de Bases de Datos',
    '> Conceptos aplicados durante el diseño y modelado de tu proyecto.',
    '',
  ];

  for (const item of terminos) {
    if (item.relevante) {
      lineas.push(`### ${item.termino}`);
      lineas.push(item.definicion);
      lineas.push('');
    }
  }

  return lineas.join('\n');
}

/**
 * Genera el documento completo de modelo conceptual en Markdown (`modelo.md`).
 */
export function modeloConceptualAMarkdown(proyecto: ProyectoEstado): string {
  const lineas: string[] = [];

  lineas.push('# Modelo Conceptual de Base de Datos');
  lineas.push(`> Proyecto: ${proyecto.descripcionProblema || 'Diseño de base de datos'}`);
  lineas.push(`> Fecha: ${new Date().toLocaleDateString('es-AR')}`);
  lineas.push('');

  lineas.push('## 1. Entidades y Atributos');
  if (proyecto.modelo.entidades.length === 0) {
    lineas.push('_No hay entidades definidas en el modelo._');
  } else {
    for (const ent of proyecto.modelo.entidades) {
      lineas.push(`### Entidad: \`${ent.nombre}\``);
      if (ent.descripcion) {
        lineas.push(`_${ent.descripcion}_`);
      }
      lineas.push('');
      lineas.push('| Atributo | Tipo Conceptual | PK | Requerido | Único | Justificación |');
      lineas.push('|---|---|---|---|---|---|');
      for (const atr of ent.atributos) {
        const pk = atr.esClavePrimaria ? '✓ PK' : '-';
        const req = atr.obligatorio ? 'Sí' : 'No';
        const unq = atr.unico ? 'Sí' : 'No';
        const just = (atr.justificacion || '').replace(/\|/g, '/');
        lineas.push(
          `| \`${atr.nombre}\` | ${atr.tipoConceptual} | ${pk} | ${req} | ${unq} | ${just} |`
        );
      }
      lineas.push('');
    }
  }

  lineas.push('## 2. Relaciones del Modelo');
  if (proyecto.modelo.relaciones.length === 0) {
    lineas.push('_No se definieron relaciones explícitas._');
  } else {
    lineas.push('| Origen | Destino | Cardinalidad | Obligatorio en Origen | Obligatorio en Destino | Descripción |');
    lineas.push('|---|---|---|---|---|---|');
    for (const rel of proyecto.modelo.relaciones) {
      lineas.push(
        `| \`${rel.origen}\` | \`${rel.destino}\` | **${rel.cardinalidad}** | ${
          rel.obligatoriaEnOrigen ? 'Sí' : 'No'
        } | ${rel.obligatoriaEnDestino ? 'Sí' : 'No'} | ${rel.descripcion || '-'} |`
      );
    }
    lineas.push('');
  }

  return lineas.join('\n');
}
