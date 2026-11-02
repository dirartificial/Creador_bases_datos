import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { guardarApiKey } from '../src/core/key';
import { configurarClienteGeminiMock } from '../src/core/gemini';
import {
  AclaracionSchema,
  AtributoSchema,
  DecisionSchema,
  EntidadSchema,
  ModeloSchema,
  ObservacionDisenoSchema,
  RelacionSchema,
} from '../src/core/schemas';
import { evaluarClaridad } from '../src/core/clarity';
import {
  cargarProyectoDesdeIndexedDB,
  exportarProyectoAJson,
  guardarProyectoEnIndexedDB,
  importarProyectoDesdeJson,
  MAX_IMPORT_BYTES,
  reiniciarProyectoEnIndexedDB,
} from '../src/core/storage';

const FAKE_KEY = 'AIzaSyTestKeyFase1_1234567890abcdefXYZ';

describe('Fase 1 — Esquemas Zod (Sección 6)', () => {
  it('valida correctamente Atributo, Entidad, Relacion, Modelo, Aclaracion, ObservacionDiseno y Decision', () => {
    const attrValido = AtributoSchema.parse({
      nombre: 'id_mascota',
      tipoConceptual: 'entero',
      obligatorio: true,
      unico: true,
      esClavePrimaria: true,
      justificacion: 'Usamos id_mascota numérico porque dos mascotas pueden tener el mismo nombre.',
    });
    expect(attrValido.esClavePrimaria).toBe(true);

    const entidadValida = EntidadSchema.parse({
      nombre: 'Mascota',
      descripcion: 'Animales atendidos en la veterinaria',
      atributos: [attrValido],
    });
    expect(entidadValida.nombre).toBe('Mascota');

    const relacionValida = RelacionSchema.parse({
      origen: 'Cliente',
      destino: 'Mascota',
      cardinalidad: '1:N',
      descripcion: 'Un cliente puede ser dueño de varias mascotas',
      obligatoriaEnOrigen: false,
      obligatoriaEnDestino: true,
    });
    expect(relacionValida.cardinalidad).toBe('1:N');

    const modeloValido = ModeloSchema.parse({
      entidades: [entidadValida],
      relaciones: [relacionValida],
    });
    expect(modeloValido.entidades).toHaveLength(1);

    // Aclaracion rechaza más de 5 preguntas
    expect(() =>
      AclaracionSchema.parse({
        suficiente: false,
        preguntas: ['1', '2', '3', '4', '5', '6'],
        supuestosAConfirmar: [],
      })
    ).toThrow();

    const obs = ObservacionDisenoSchema.parse({
      gravedad: 'advertencia',
      mensaje: 'Entidad sin relaciones',
      explicacionConceptual: 'En un modelo relacional las entidades suelen vincularse entre sí.',
    });
    expect(obs.gravedad).toBe('advertencia');

    const dec = DecisionSchema.parse({
      paso: 1,
      fecha: new Date().toISOString(),
      descripcion: 'Describió el problema de la veterinaria',
      origen: 'estudiante',
    });
    expect(dec.origen).toBe('estudiante');
  });
});

describe('Fase 1 — evaluarClaridad y bloqueo ante ambigüedad', () => {
  it('ante "una base para una veterinaria" devuelve suficiente=false y preguntas concretas', async () => {
    guardarApiKey(FAKE_KEY);

    configurarClienteGeminiMock({
      generarContenido: async () =>
        JSON.stringify({
          suficiente: false,
          preguntas: [
            '¿Qué entidades principales querés registrar (por ejemplo: Clientes, Mascotas, Consultas, Veterinarios)?',
            '¿Qué datos específicos necesitás guardar de cada mascota y de cada dueño?',
            '¿Un dueño puede tener varias mascotas y una mascota puede ser atendida muchas veces?',
            '¿Qué datos son obligatorios o únicos (como DNI del dueño o matrícula del veterinario)?',
          ],
          supuestosAConfirmar: [
            'Solo se registran mascotas con un dueño responsable identificado.',
          ],
        }),
    });

    const resultado = await evaluarClaridad('una base para una veterinaria');
    expect(resultado.suficiente).toBe(false);
    expect(resultado.preguntas.length).toBeGreaterThanOrEqual(3);
    expect(resultado.preguntas.length).toBeLessThanOrEqual(5);
  });
});

describe('Fase 1 — Flujo de aceptación Pasos 1 a 3 ("una base para una veterinaria")', () => {
  it('pregunta ante "una base para una veterinaria", bloquea el avance hasta aclarar, permite editar el modelo y registra la bitácora en IndexedDB', async () => {
    await reiniciarProyectoEnIndexedDB();
    guardarApiKey(FAKE_KEY);

    configurarClienteGeminiMock({
      generarContenido: async (params: { prompt: string }) => {
        if (
          params.prompt.includes('ENTIDADES y ATRIBUTOS del Modelo Conceptual') ||
          params.prompt.includes('explicacionGeneral')
        ) {
          return JSON.stringify({
            explicacionGeneral:
              'Proponemos las entidades Cliente y Mascota con claves primarias numéricas.',
            entidades: [
              {
                nombre: 'Mascota',
                descripcion: 'Animal paciente atendido en la clínica veterinaria',
                atributos: [
                  {
                    nombre: 'id_mascota',
                    tipoConceptual: 'entero',
                    obligatorio: true,
                    unico: true,
                    esClavePrimaria: true,
                    justificacion:
                      'Se sugiere id_mascota entero como clave primaria y no nombre porque varias mascotas pueden llamarse igual.',
                  },
                  {
                    nombre: 'nombre',
                    tipoConceptual: 'texto',
                    obligatorio: true,
                    unico: false,
                    esClavePrimaria: false,
                    justificacion: 'Nombre de pila de la mascota para identificarla en la atención.',
                  },
                ],
              },
            ],
          });
        }

        if (params.prompt.includes('Ronda 1:')) {
          return JSON.stringify({
            suficiente: true,
            preguntas: [],
            supuestosAConfirmar: [
              'Cada mascota pertenece a un único cliente.',
              'Se registran consultas con fecha, motivo y diagnóstico.',
            ],
          });
        }

        // Caso inicial en Paso 1: evaluarClaridad -> insuficiente
        return JSON.stringify({
          suficiente: false,
          preguntas: [
            '¿Qué datos necesitás guardar de cada mascota y de su dueño?',
            '¿Querés registrar las consultas médicas y qué veterinario las atendió?',
            '¿Qué informes te gustaría obtener (por ejemplo, historial por mascota)?',
          ],
          supuestosAConfirmar: ['Cada mascota pertenece a un único dueño principal.'],
        });
      },
    });

    render(<App />);

    // Paso 1: Ingresar "una base para una veterinaria"
    const inputProblema = await screen.findByTestId('problem-description-input');
    fireEvent.change(inputProblema, {
      target: { value: 'una base para una veterinaria' },
    });

    fireEvent.click(screen.getByTestId('confirm-step1-btn'));

    // Paso 2: Debe mostrar las preguntas y bloquear el avance al Paso 3
    await waitFor(() => {
      expect(screen.getByTestId('step2-container')).toBeInTheDocument();
    });

    expect(screen.getByTestId('ambiguity-warning')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-step2-btn')).toBeDisabled();
    expect(screen.getByTestId('wizard-step-btn-3')).toBeDisabled();

    // Responder las 3 preguntas de la Ronda 1
    fireEvent.change(screen.getByTestId('answer-input-0'), {
      target: { value: 'Nombre, especie y fecha de nacimiento de mascota; DNI y teléfono del dueño.' },
    });
    fireEvent.change(screen.getByTestId('answer-input-1'), {
      target: { value: 'Sí, queremos guardar fecha, motivo y veterinario de cada consulta.' },
    });
    fireEvent.change(screen.getByTestId('answer-input-2'), {
      target: { value: 'Historial de atenciones por mascota y listado de turnos por día.' },
    });

    fireEvent.click(screen.getByTestId('submit-clarification-btn'));

    // Ahora evaluarClaridad devuelve suficiente=true y habilita confirmar para pasar al Paso 3
    await waitFor(
      () => {
        expect(screen.getByTestId('clarification-sufficient-panel')).toBeInTheDocument();
        expect(screen.getByTestId('confirm-step2-btn')).not.toBeDisabled();
      },
      { timeout: 3500 }
    );

    // Desmarcar el segundo supuesto para verificar registro de 'ia_rechazada' en bitácora
    const checkboxSupuesto1 = screen.getByTestId('assumption-checkbox-1');
    fireEvent.click(checkboxSupuesto1);

    const btnConfirmarPaso2 = screen.getByTestId('confirm-step2-btn');
    expect(btnConfirmarPaso2).not.toBeDisabled();
    fireEvent.click(btnConfirmarPaso2);

    // Paso 3: Se muestra la propuesta de Modelo Conceptual con la justificación pedagógica
    await waitFor(() => {
      expect(screen.getByTestId('step3-container')).toBeInTheDocument();
    });

    expect(screen.getByTestId('attr-justificacion-0-0')).toHaveValue(
      'Se sugiere id_mascota entero como clave primaria y no nombre porque varias mascotas pueden llamarse igual.'
    );

    // Edición manual: agregar un atributo y agregar una entidad manual
    fireEvent.click(screen.getByTestId('add-attr-btn-0'));
    expect(screen.getByTestId('attr-name-0-2')).toBeInTheDocument();

    // Confirmar el Modelo Conceptual
    fireEvent.click(screen.getByTestId('confirm-step3-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('model-confirmed-banner')).toBeInTheDocument();
    });

    // Verificar persistencia en IndexedDB y ausencia total de la API key
    const guardadoEnIDB = await cargarProyectoDesdeIndexedDB();
    expect(guardadoEnIDB.modeloConceptualConfirmado).toBe(true);
    expect(guardadoEnIDB.descripcionProblema).toBe('una base para una veterinaria');
    expect(guardadoEnIDB.rondasAclaracion).toHaveLength(1);
    expect(guardadoEnIDB.modelo.entidades[0].atributos).toHaveLength(3);

    // Verificar que la bitácora registró decisiones de estudiante, ia_aceptada e ia_rechazada
    const origenes = guardadoEnIDB.bitacora.map((d) => d.origen);
    expect(origenes).toContain('estudiante');
    expect(origenes).toContain('ia_aceptada');
    expect(origenes).toContain('ia_rechazada');

    const serializadoIDB = JSON.stringify(guardadoEnIDB);
    expect(serializadoIDB).not.toContain(FAKE_KEY);
  });
});

describe('Fase 1 — Persistencia en IndexedDB e Importación/Exportación Segura (Sección 3.4)', () => {
  it('ignora campos desconocidos (como una apiKey inyectada) al importar o exportar JSON y respeta el límite de tamaño', async () => {
    const actual = await cargarProyectoDesdeIndexedDB();
    const guardado = await guardarProyectoEnIndexedDB({
      ...actual,
      descripcionProblema: 'Biblioteca escolar',
    });

    const jsonExportado = exportarProyectoAJson(guardado);
    expect(jsonExportado).not.toContain(FAKE_KEY);

    // Simular JSON importado con campos desconocidos / maliciosos
    const jsonConCamposExtra = JSON.stringify({
      ...JSON.parse(jsonExportado),
      apiKey: FAKE_KEY,
      scriptMalicioso: '<script>alert(1)</script>',
    });

    const reimportado = importarProyectoDesdeJson(jsonConCamposExtra);
    expect(reimportado.descripcionProblema).toBe('Biblioteca escolar');
    expect('apiKey' in reimportado).toBe(false);
    expect('scriptMalicioso' in reimportado).toBe(false);
    expect(JSON.stringify(reimportado)).not.toContain(FAKE_KEY);

    // Rechazar archivo que supere MAX_IMPORT_BYTES
    const enorme = 'x'.repeat(MAX_IMPORT_BYTES + 100);
    expect(() => importarProyectoDesdeJson(enorme)).toThrow(/tamaño máximo permitido/i);
  });
});


describe('Fase 1 — Indicador visual en tiempo real mientras Gemini procesa', () => {
  it('muestra el HUD de procesamiento (ai-thinking-indicator) mientras espera la respuesta de Gemini', async () => {
    guardarApiKey(FAKE_KEY);

    let resolverPromesa: (val: string) => void = () => {};
    configurarClienteGeminiMock({
      generarContenido: () =>
        new Promise<string>((resolve) => {
          resolverPromesa = resolve;
        }),
    });

    render(<App />);

    const inputProblema = await screen.findByTestId('problem-description-input');
    fireEvent.change(inputProblema, {
      target: { value: 'una base para una veterinaria' },
    });

    fireEvent.click(screen.getByTestId('confirm-step1-btn'));

    // Mientras la promesa no se resuelve, debe mostrarse el indicador de pensamiento
    const hud = await screen.findByTestId('ai-thinking-indicator');
    expect(hud).toBeInTheDocument();
    expect(hud).toHaveTextContent(/Gemini está procesando tu consulta/i);

    // Resolver la llamada a Gemini
    resolverPromesa(
      JSON.stringify({
        suficiente: false,
        preguntas: ['¿Qué datos querés guardar de cada mascota?'],
        supuestosAConfirmar: [],
      })
    );

    await waitFor(() => {
      expect(screen.queryByTestId('ai-thinking-indicator')).not.toBeInTheDocument();
      expect(screen.getByTestId('step2-container')).toBeInTheDocument();
    });
  });
});
