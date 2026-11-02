import systemTutorPrompt from '../prompts/system_tutor.md?raw';
import { consultarGeminiEstructurado } from './gemini';
import {
  Aclaracion,
  AclaracionSchema,
  Modelo,
  PropuestaModeloConceptual,
  PropuestaModeloConceptualSchema,
  RondaAclaracion,
} from './schemas';

export const MAX_RONDAS_ACLARACION = 3;

/**
 * Construye un resumen legible de las rondas de aclaración ya respondidas por el estudiante.
 */
export function formatearContextoRondas(rondas: RondaAclaracion[]): string {
  if (!rondas || rondas.length === 0) {
    return 'Aún no se realizaron rondas de preguntas de aclaración.';
  }

  return rondas
    .map((ronda) => {
      const detalleRespuestas = ronda.preguntas
        .map((pregunta, idx) => {
          const respuesta = ronda.respuestasEstudiante[String(idx)]?.trim() || '(Sin respuesta)';
          return `  - Pregunta: ${pregunta}\n    Respuesta del estudiante: ${respuesta}`;
        })
        .join('\n');

      const detalleSupuestos =
        ronda.supuestos.length > 0
          ? `\n  - Supuestos confirmados: ${ronda.supuestos.join('; ')} (${
              ronda.supuestosConfirmados ? 'Sí' : 'No'
            })`
          : '';

      return `Ronda ${ronda.numeroRonda}:\n${detalleRespuestas}${detalleSupuestos}`;
    })
    .join('\n\n');
}

/**
 * Evalúa si la descripción del problema (más las respuestas de rondas previas y el modelo actual)
 * tiene suficiente claridad para construir el modelo conceptual sin adivinar ni asumir reglas de negocio.
 *
 * Firma según Sección 5 del Plan:
 * `evaluarClaridad(descripcion, modeloActual)` -> `{ suficiente, preguntas[], supuestosAConfirmar[] }`
 */
export async function evaluarClaridad(
  descripcion: string,
  modeloActual: Modelo = { entidades: [], relaciones: [] },
  rondasPrevias: RondaAclaracion[] = []
): Promise<Aclaracion> {
  const textoLimpio = descripcion.trim();
  if (!textoLimpio) {
    throw new Error('Escribí primero una descripción del problema que querés resolver.');
  }

  const contextoRondas = formatearContextoRondas(rondasPrevias);
  const resumenModelo =
    modeloActual.entidades.length > 0
      ? JSON.stringify(modeloActual, null, 2)
      : 'Sin entidades definidas todavía.';

  const prompt = `Analizá la siguiente descripción de un problema de base de datos planteado por un estudiante principiante:

DESCRIPCIÓN INICIAL DEL ESTUDIANTE:
"""
${textoLimpio}
"""

HISTORIAL DE ACLARACIONES PREVIAS (Ronda actual: ${rondasPrevias.length + 1} de ${MAX_RONDAS_ACLARACION}):
${contextoRondas}

MODELO ACTUAL EN BORRADOR:
${resumenModelo}

INSTRUCCIONES DE EVALUACIÓN:
1. Evaluá si la información provista hasta ahora define con claridad:
   - Qué entidades principales se necesitan guardar.
   - Qué datos (atributos) interesan de cada entidad.
   - Cómo se relacionan entre sí y con qué cardinalidad (ej. si un cliente puede tener muchas mascotas, si una atención involucra varios veterinarios, etc.).
   - Qué campos son obligatorios, únicos (ej. DNI, matrícula, email) o tienen valores permitidos fijos.
   - Qué informes o consultas se esperan obtener del sistema.
2. Si la descripción es breve o general (por ejemplo: "una base para una veterinaria", "una biblioteca escolar", "una tienda") y todavía faltan precisiones sobre cualquiera de los 5 puntos anteriores, debés devolver "suficiente": false y formular entre 3 y 5 preguntas concretas, claras y didácticas en español rioplatense.
3. Si ya se respondieron las preguntas clave o estamos en la ronda final con suficiente contexto, devolvé "suficiente": true, "preguntas": [] y listá en "supuestosAConfirmar" los supuestos de diseño explícitos que el estudiante debe confirmar antes de pasar al modelo conceptual.

Respondé ÚNICAMENTE con un objeto JSON válido con la siguiente estructura exacta:
{
  "suficiente": boolean,
  "preguntas": string[], // entre 3 y 5 preguntas si suficiente es false; array vacío si suficiente es true (máximo 5)
  "supuestosAConfirmar": string[] // supuestos claros a confirmar por el estudiante
}`;

  const resultado = await consultarGeminiEstructurado({
    prompt,
    schema: AclaracionSchema,
    systemInstruction: systemTutorPrompt,
  });

  // Garantizar tope de 5 preguntas y coherencia
  return {
    suficiente: resultado.suficiente,
    preguntas: resultado.preguntas.slice(0, 5),
    supuestosAConfirmar: resultado.supuestosAConfirmar,
  };
}

/**
 * Solicita a la IA tutora una propuesta inicial de Modelo Conceptual (Paso 3)
 * a partir de la descripción y las aclaraciones confirmadas por el estudiante.
 * Cada atributo incluye su justificación pedagógica (ej. por qué usar un ID numérico como clave primaria).
 */
export async function generarPropuestaModeloConceptual(params: {
  descripcion: string;
  rondas: RondaAclaracion[];
  supuestosConfirmados?: string[];
  modeloActual?: Modelo;
}): Promise<PropuestaModeloConceptual> {
  const contextoRondas = formatearContextoRondas(params.rondas);
  const listaSupuestos =
    params.supuestosConfirmados && params.supuestosConfirmados.length > 0
      ? params.supuestosConfirmados.map((s) => `- ${s}`).join('\n')
      : 'Ninguno adicional.';

  const prompt = `A partir del problema descripto por el estudiante y sus respuestas en la etapa de aclaración guiada, proponé las ENTIDADES y ATRIBUTOS del Modelo Conceptual (Paso 3).

DESCRIPCIÓN DEL PROBLEMA:
"""
${params.descripcion.trim()}
"""

RESPUESTAS DE ACLARACIÓN DEL ESTUDIANTE:
${contextoRondas}

SUPUESTOS CONFIRMADOS:
${listaSupuestos}

REGLAS PEDAGÓGICAS OBLIGATORIAS:
1. No inventes entidades fuera del alcance acordado con el estudiante.
2. Cada entidad debe incluir al menos una clave primaria (\`esClavePrimaria: true\`, \`obligatorio: true\`, \`unico: true\`).
3. En el campo \`justificacion\` de cada atributo explicá en 1 o 2 frases por qué se sugiere ese atributo, su tipo conceptual o por qué es (o no es) clave primaria (por ejemplo: "Se sugiere id_mascota entero como clave primaria porque dos mascotas pueden tener el mismo nombre").
4. Los valores válidos para \`tipoConceptual\` son únicamente: "texto", "entero", "decimal", "fecha", "fecha_hora", "booleano".
5. En \`explicacionGeneral\` definí brevemente qué es una entidad, un atributo y una clave primaria para un estudiante principiante, aplicado a su caso.

Respondé ÚNICAMENTE con un objeto JSON válido que cumpla este esquema:
{
  "entidades": [
    {
      "nombre": "string",
      "descripcion": "string",
      "atributos": [
        {
          "nombre": "string",
          "tipoConceptual": "texto" | "entero" | "decimal" | "fecha" | "fecha_hora" | "booleano",
          "obligatorio": boolean,
          "unico": boolean,
          "esClavePrimaria": boolean,
          "valoresPermitidos": ["string"] (opcional),
          "justificacion": "string"
        }
      ]
    }
  ],
  "explicacionGeneral": "string"
}`;

  return consultarGeminiEstructurado({
    prompt,
    schema: PropuestaModeloConceptualSchema,
    systemInstruction: systemTutorPrompt,
  });
}
