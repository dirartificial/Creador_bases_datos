import React, { useEffect, useRef, useState } from 'react';
import {
  enmascararApiKey,
  guardarApiKey,
  obtenerApiKey,
  olvidarApiKey,
  validarFormatoKey,
  obtenerProveedorActivo,
  establecerProveedorActivo,
  ProveedorLLM,
} from './core/key';
import {
  clasificarErrorGemini,
  establecerModeloActivo,
  GEMINI_MODEL,
  MODELOS_ALTERNATIVOS,
  MODELOS_OPENROUTER_GRATIS_DEFAULT,
  OPENROUTER_MODEL_DEFAULT,
  obtenerModeloActivo,
  probarConexionGemini,
  listarModelosOpenRouterGratuitos,
  listarModelosOllamaLocales,
  MODELOS_OLLAMA_RECOMENDADOS,
  OLLAMA_MODEL_DEFAULT,
} from './core/gemini';
import {
  crearProyectoInicial,
  Decision,
  Entidad,
  ExplicacionDDL,
  Informe,
  Modelo,
  MotorBaseDatos,
  OpcionesGeneracionDDL,
  ProyectoEstado,
  RespuestaExplicacionObservaciones,
  RondaAclaracion,
} from './core/schemas';
import {
  evaluarClaridad,
  generarPropuestaModeloConceptual,
  MAX_RONDAS_ACLARACION,
} from './core/clarity';
import {
  explicarObservacionesConIA,
  sugerirRelacionesConIA,
  validarModelo,
} from './core/modelValidator';
import {
  cargarProyectoDesdeIndexedDB,
  crearRegistroDecision,
  exportarProyectoAJson,
  guardarProyectoEnIndexedDB,
  importarProyectoDesdeJson,
  reiniciarProyectoEnIndexedDB,
} from './core/storage';
import { generarDDLSQLite, pedirExplicacionDDLConIA } from './core/ddl/sqlite';
import { generarDDLPostgres, pedirExplicacionDDLPostgresConIA } from './core/ddl/postgres';
import { generarDDLMySQL, pedirExplicacionDDLMySQLConIA } from './core/ddl/mysql';
import { generarScriptMongo, pedirExplicacionDDLMongoConIA } from './core/ddl/mongo';
import {
  generarDatosEjemploConIA,
  generarDatosEjemploLocales,
  generarInsertStatementsSQLite,
} from './core/sampleData';
import { sqliteClient } from './core/workers/sqliteClient';
import { generarConsultaInformeConIA } from './core/reports';
import { generarAnalisisResumidoFallback } from './export/analisis';
import { Step1Problema } from './steps/Step1Problema';
import { Step2Aclaracion } from './steps/Step2Aclaracion';
import { Step3ModeloConceptual } from './steps/Step3ModeloConceptual';
import { Step4Relaciones } from './steps/Step4Relaciones';
import { Step5DiagramaER } from './steps/Step5DiagramaER';
import { Step6MotorDDL } from './steps/Step6MotorDDL';
import { Step7DatosEjemplo } from './steps/Step7DatosEjemplo';
import { Step8Informes } from './steps/Step8Informes';
import { StepEntregables } from './steps/StepEntregables';
import { GlossaryModal } from './steps/GlossaryModal';
import { LISTA_PRESETS, obtenerPresetPorId } from './core/presets';

const ETIQUETAS_PASOS = [
  { numero: 1, titulo: '1. Problema', subtitulo: 'Dominio y alcance' },
  { numero: 2, titulo: '2. Aclaración', subtitulo: 'Preguntas del tutor' },
  { numero: 3, titulo: '3. Modelo Conceptual', subtitulo: 'Entidades y PKs' },
  { numero: 4, titulo: '4. Relaciones', subtitulo: 'Cardinalidad y FKs' },
  { numero: 5, titulo: '5. Diagrama ER', subtitulo: 'Visualización Mermaid' },
  { numero: 6, titulo: '6. Motor y DDL', subtitulo: 'SQL / NoSQL explicado' },
  { numero: 7, titulo: '7. Datos de ejemplo', subtitulo: 'Población coherente' },
  { numero: 8, titulo: '8. Informes', subtitulo: 'Consultas SELECT' },
  { numero: 9, titulo: '9. Entregables', subtitulo: 'ZIP, PDF y Markdown' },
] as const;

export function App() {
  const [keyGuardada, setKeyGuardada] = useState<string | null>(() => obtenerApiKey());
  const [proveedorSeleccionado, setProveedorSeleccionado] = useState<ProveedorLLM>(() =>
    obtenerProveedorActivo()
  );
  const [inputKey, setInputKey] = useState<string>('');
  const [avisoAceptado, setAvisoAceptado] = useState<boolean>(false);
  const [probando, setProbando] = useState<boolean>(false);
  const [cargandoIA, setCargandoIA] = useState<boolean>(false);
  const [actividadIA, setActividadIA] = useState<string>('');
  const [modeloSeleccionado, setModeloSeleccionado] = useState<string>(() => obtenerModeloActivo());
  const [modelosOpciones, setModelosOpciones] = useState<string[]>(() => {
    const prov = obtenerProveedorActivo();
    if (prov === 'ollama') return [...MODELOS_OLLAMA_RECOMENDADOS];
    if (prov === 'openrouter') return [...MODELOS_OPENROUTER_GRATIS_DEFAULT];
    return [...MODELOS_ALTERNATIVOS];
  });
  const [estadoMensaje, setEstadoMensaje] = useState<{
    tipo: 'exito' | 'error';
    texto: string;
  } | null>(null);

  const [proyecto, setProyecto] = useState<ProyectoEstado>(() => crearProyectoInicial());
  const proyectoRef = useRef<ProyectoEstado>(proyecto);
  proyectoRef.current = proyecto;
  const [explicacionesIAPaso4, setExplicacionesIAPaso4] =
    useState<RespuestaExplicacionObservaciones | null>(null);
  const [cargadoDesdeIDB, setCargadoDesdeIDB] = useState<boolean>(false);
  const [ejecutandoSQLite, setEjecutandoSQLite] = useState<boolean>(false);
  const [mostrarGlosario, setMostrarGlosario] = useState<boolean>(false);
  const modificadoPorUsuarioRef = useRef<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Modo Oscuro / Claro persistido en localStorage con detección de preferencias del sistema
  const [tema, setTema] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      try {
        const guardado = localStorage.getItem('db_tutor_theme');
        if (guardado === 'light' || guardado === 'dark') return guardado;
        if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
      } catch {
        // Ignorar si localStorage está restringido
      }
    }
    return 'dark';
  });

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', tema);
    }
  }, [tema]);

  const toggleTema = () => {
    setTema((prev) => {
      const nuevo = prev === 'dark' ? 'light' : 'dark';
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('db_tutor_theme', nuevo);
        } catch {
          // Ignorar si localStorage está restringido
        }
      }
      return nuevo;
    });
  };

  const handleCargarPreset = (presetId: 'biblioteca' | 'veterinaria' | 'tienda') => {
    const preset = obtenerPresetPorId(presetId);
    if (!preset) return;
    const nuevoProyecto = preset.generarProyectoCompleto();
    void actualizarYGuardarProyecto(nuevoProyecto);
    setEstadoMensaje({
      tipo: 'exito',
      texto: `¡Se cargó con éxito el proyecto de demostración "${preset.titulo}"! Podés navegar libremente por todos sus pasos o descargar los entregables.`,
    });
  };

  // Cargar modelos de OpenRouter u Ollama si es el proveedor seleccionado
  useEffect(() => {
    let cancelado = false;
    if (proveedorSeleccionado === 'ollama') {
      listarModelosOllamaLocales().then((lista) => {
        if (!cancelado && lista.length > 0) {
          setModelosOpciones(lista);
          if (!lista.includes(modeloSeleccionado)) {
            const preferido = lista.includes(OLLAMA_MODEL_DEFAULT)
              ? OLLAMA_MODEL_DEFAULT
              : lista[0];
            establecerModeloActivo(preferido);
            setModeloSeleccionado(preferido);
          }
        }
      });
    } else if (proveedorSeleccionado === 'openrouter') {
      listarModelosOpenRouterGratuitos(keyGuardada ?? undefined).then((lista) => {
        if (!cancelado && lista.length > 0) {
          setModelosOpciones(lista);
          if (!lista.includes(modeloSeleccionado)) {
            const preferido = lista.includes(OPENROUTER_MODEL_DEFAULT)
              ? OPENROUTER_MODEL_DEFAULT
              : lista[0];
            establecerModeloActivo(preferido);
            setModeloSeleccionado(preferido);
          }
        }
      });
    } else {
      setModelosOpciones([...MODELOS_ALTERNATIVOS]);
    }
    return () => {
      cancelado = true;
    };
  }, [proveedorSeleccionado, keyGuardada]);

  // Cargar proyecto persistido en IndexedDB al montar
  useEffect(() => {
    let cancelado = false;
    cargarProyectoDesdeIndexedDB()
      .then((recuperado) => {
        if (!cancelado && !modificadoPorUsuarioRef.current) {
          proyectoRef.current = recuperado;
          setProyecto(recuperado);
          setCargadoDesdeIDB(true);
        }
      })
      .catch(() => {
        if (!cancelado) {
          setCargadoDesdeIDB(true);
        }
      });
    return () => {
      cancelado = true;
    };
  }, []);

  const actualizarYGuardarProyecto = async (
    nuevoEstado: ProyectoEstado | ((prev: ProyectoEstado) => ProyectoEstado)
  ) => {
    modificadoPorUsuarioRef.current = true;
    const estadoFinal =
      typeof nuevoEstado === 'function' ? nuevoEstado(proyectoRef.current) : nuevoEstado;
    proyectoRef.current = estadoFinal;
    setProyecto(estadoFinal);
    try {
      await guardarProyectoEnIndexedDB(estadoFinal);
    } catch {
      // En entornos sin IndexedDB completo mantenemos el estado en memoria
    }
  };

  const handleCambioModelo = (nuevo: string) => {
    establecerModeloActivo(nuevo);
    setModeloSeleccionado(nuevo);
  };

  const handleCambioProveedor = async (nuevoProv: ProveedorLLM) => {
    setProveedorSeleccionado(nuevoProv);
    establecerProveedorActivo(nuevoProv);
    setEstadoMensaje(null);

    if (nuevoProv === 'ollama') {
      const modelos = await listarModelosOllamaLocales();
      setModelosOpciones(modelos);
      const inicial = modelos.includes(OLLAMA_MODEL_DEFAULT)
        ? OLLAMA_MODEL_DEFAULT
        : modelos[0] || 'qwen2.5-coder:7b';
      handleCambioModelo(inicial);
    } else if (nuevoProv === 'openrouter') {
      const modelos = await listarModelosOpenRouterGratuitos(keyGuardada ?? undefined);
      setModelosOpciones(modelos);
      const inicial = modelos.includes(OPENROUTER_MODEL_DEFAULT)
        ? OPENROUTER_MODEL_DEFAULT
        : modelos[0] || 'google/gemini-2.0-flash-exp:free';
      handleCambioModelo(inicial);
    } else {
      setModelosOpciones([...MODELOS_ALTERNATIVOS]);
      handleCambioModelo(GEMINI_MODEL);
    }
  };

  const handleGuardarKey = (e: React.FormEvent) => {
    e.preventDefault();
    setEstadoMensaje(null);

    if (!avisoAceptado && !keyGuardada) {
      setEstadoMensaje({
        tipo: 'error',
        texto: 'Debés leer y aceptar el aviso de seguridad antes de continuar.',
      });
      return;
    }

    const keyParaGuardar =
      proveedorSeleccionado === 'ollama' && !inputKey.trim()
        ? 'ollama-local'
        : inputKey;

    const validacion = validarFormatoKey(keyParaGuardar, proveedorSeleccionado);
    if (!validacion.valida) {
      setEstadoMensaje({
        tipo: 'error',
        texto: validacion.mensaje ?? 'API key inválida.',
      });
      return;
    }

    try {
      guardarApiKey(keyParaGuardar, proveedorSeleccionado);
      const actual = obtenerApiKey();
      setKeyGuardada(actual);
      setInputKey('');
      setEstadoMensaje({
        tipo: 'exito',
        texto:
          proveedorSeleccionado === 'ollama'
            ? 'Conectado a Ollama Local en localhost:11434 exitosamente.'
            : `API key de ${proveedorSeleccionado === 'openrouter' ? 'OpenRouter' : 'Google Gemini'} guardada en esta pestaña.`,
      });
    } catch (err) {
      setEstadoMensaje({
        tipo: 'error',
        texto: err instanceof Error ? err.message : 'Error al guardar la key.',
      });
    }
  };

  const handleProbarConexion = async () => {
    setEstadoMensaje(null);
    const keyAProbar = keyGuardada ?? inputKey.trim();
    const validacion = validarFormatoKey(keyAProbar, proveedorSeleccionado);
    if (!validacion.valida) {
      setEstadoMensaje({
        tipo: 'error',
        texto: validacion.mensaje ?? 'Ingresá una API key válida antes de probar la conexión.',
      });
      return;
    }

    setProbando(true);
    setActividadIA(
      `Verificando tu API key y consultando modelos en ${
        proveedorSeleccionado === 'openrouter' ? 'OpenRouter' : 'Google Gemini'
      }...`
    );
    try {
      const resultado = await probarConexionGemini(keyAProbar, proveedorSeleccionado);
      setModeloSeleccionado(resultado.modelo);
      if (resultado.modelosDisponibles && resultado.modelosDisponibles.length > 0) {
        setModelosOpciones(resultado.modelosDisponibles);
      }
      setEstadoMensaje({
        tipo: resultado.ok ? 'exito' : 'error',
        texto: resultado.mensaje,
      });
    } finally {
      setProbando(false);
      setActividadIA('');
    }
  };

  const handleOlvidarKey = () => {
    olvidarApiKey();
    setKeyGuardada(null);
    setInputKey('');
    setEstadoMensaje({
      tipo: 'exito',
      texto: 'La API key fue eliminada de la memoria de esta pestaña.',
    });
  };

  // --- Paso 1: Confirmar descripción y evaluar claridad ---
  const handleConfirmarDescripcionPaso1 = async (descripcion: string) => {
    setEstadoMensaje(null);
    setCargandoIA(true);
    setActividadIA(
      'El tutor IA está analizando tu descripción para identificar entidades, reglas de negocio y posibles ambigüedades...'
    );
    try {
      const aclaracion = await evaluarClaridad(descripcion, proyecto.modelo, []);
      const decisionPaso1 = crearRegistroDecision({
        paso: 1,
        descripcion: `Planteó el problema inicial: "${descripcion}"`,
        origen: 'estudiante',
      });

      const nuevoEstado: ProyectoEstado = {
        ...proyecto,
        pasoActual: 2,
        descripcionProblema: descripcion,
        rondasAclaracion: [],
        ultimaAclaracion: aclaracion,
        claridadConfirmada: false,
        modeloConceptualConfirmado: false,
        bitacora: [...proyecto.bitacora, decisionPaso1],
      };

      await actualizarYGuardarProyecto(nuevoEstado);
    } catch (err) {
      const clasificado = clasificarErrorGemini(err, keyGuardada ?? undefined);
      setEstadoMensaje({
        tipo: 'error',
        texto: clasificado.mensaje,
      });
    } finally {
      setCargandoIA(false);
      setActividadIA('');
    }
  };


  // --- Paso 2: Responder una ronda de preguntas de aclaración ---
  const handleResponderRondaPaso2 = async (
    respuestas: Record<string, string>,
    supuestosAceptados: string[],
    supuestosRechazados: string[]
  ) => {
    if (!proyecto.ultimaAclaracion) return;
    setEstadoMensaje(null);
    setCargandoIA(true);
    setActividadIA(
      'El tutor IA está revisando tus respuestas para evaluar si la especificación ya es clara y completa...'
    );

    try {
      const numeroRonda = proyecto.rondasAclaracion.length + 1;
      const nuevaRonda: RondaAclaracion = {
        numeroRonda,
        preguntas: proyecto.ultimaAclaracion.preguntas,
        supuestos: proyecto.ultimaAclaracion.supuestosAConfirmar,
        respuestasEstudiante: respuestas,
        supuestosConfirmados: supuestosAceptados.length > 0,
      };

      const rondasActualizadas = [...proyecto.rondasAclaracion, nuevaRonda];
      const resumenRespuestas = nuevaRonda.preguntas
        .map((p, idx) => `${p} -> ${respuestas[String(idx)] ?? ''}`)
        .join(' | ');

      const nuevasDecisiones: Decision[] = [
        crearRegistroDecision({
          paso: 2,
          descripcion: `Respondió ronda ${numeroRonda} de aclaración: ${resumenRespuestas}`,
          origen: 'estudiante',
        }),
      ];

      for (const sup of supuestosAceptados) {
        nuevasDecisiones.push(
          crearRegistroDecision({
            paso: 2,
            descripcion: `Aceptó supuesto sugerido en ronda ${numeroRonda}: "${sup}"`,
            origen: 'ia_aceptada',
          })
        );
      }

      for (const sup of supuestosRechazados) {
        nuevasDecisiones.push(
          crearRegistroDecision({
            paso: 2,
            descripcion: `Rechazó supuesto sugerido en ronda ${numeroRonda}: "${sup}"`,
            origen: 'ia_rechazada',
          })
        );
      }

      let siguienteAclaracion = proyecto.ultimaAclaracion;
      if (rondasActualizadas.length < MAX_RONDAS_ACLARACION) {
        siguienteAclaracion = await evaluarClaridad(
          proyecto.descripcionProblema,
          proyecto.modelo,
          rondasActualizadas
        );
      } else {
        siguienteAclaracion = {
          suficiente: true,
          preguntas: [],
          supuestosAConfirmar: supuestosAceptados,
        };
      }

      const nuevoEstado: ProyectoEstado = {
        ...proyecto,
        rondasAclaracion: rondasActualizadas,
        ultimaAclaracion: siguienteAclaracion,
        bitacora: [...proyecto.bitacora, ...nuevasDecisiones],
      };

      await actualizarYGuardarProyecto(nuevoEstado);
    } catch (err) {
      const clasificado = clasificarErrorGemini(err, keyGuardada ?? undefined);
      setEstadoMensaje({
        tipo: 'error',
        texto: clasificado.mensaje,
      });
    } finally {
      setCargandoIA(false);
      setActividadIA('');
    }
  };


  // --- Paso 2 -> Paso 3: Confirmar aclaraciones y proponer Modelo Conceptual ---
  const handleConfirmarAclaracionPaso2 = async (
    supuestosAceptados: string[],
    supuestosRechazados: string[]
  ) => {
    setEstadoMensaje(null);
    setCargandoIA(true);
    setActividadIA(
      'El tutor IA está diseñando la propuesta de Modelo Conceptual (entidades, atributos, tipos y justificación de claves primarias)...'
    );

    try {
      const decisionesPaso2: Decision[] = [
        crearRegistroDecision({
          paso: 2,
          descripcion: 'Confirmó la etapa de aclaración guiada para avanzar al Modelo Conceptual.',
          origen: 'estudiante',
        }),
      ];

      for (const sup of supuestosAceptados) {
        decisionesPaso2.push(
          crearRegistroDecision({
            paso: 2,
            descripcion: `Confirmó supuesto de diseño: "${sup}"`,
            origen: 'ia_aceptada',
          })
        );
      }

      for (const sup of supuestosRechazados) {
        decisionesPaso2.push(
          crearRegistroDecision({
            paso: 2,
            descripcion: `Descartó supuesto de diseño: "${sup}"`,
            origen: 'ia_rechazada',
          })
        );
      }

      let entidadesPropuestas = proyecto.modelo.entidades;
      let explicacionModelo = proyecto.explicacionModelo ?? '';

      if (entidadesPropuestas.length === 0) {
        const propuesta = await generarPropuestaModeloConceptual({
          descripcion: proyecto.descripcionProblema,
          rondas: proyecto.rondasAclaracion,
          supuestosConfirmados: supuestosAceptados,
          modeloActual: proyecto.modelo,
        });
        entidadesPropuestas = propuesta.entidades;
        explicacionModelo = propuesta.explicacionGeneral;
      }

      const nuevoEstado: ProyectoEstado = {
        ...proyecto,
        pasoActual: 3,
        claridadConfirmada: true,
        modelo: {
          ...proyecto.modelo,
          entidades: entidadesPropuestas,
        },
        explicacionModelo,
        bitacora: [...proyecto.bitacora, ...decisionesPaso2],
      };

      await actualizarYGuardarProyecto(nuevoEstado);
    } catch (err) {
      const clasificado = clasificarErrorGemini(err, keyGuardada ?? undefined);
      setEstadoMensaje({
        tipo: 'error',
        texto: clasificado.mensaje,
      });
    } finally {
      setCargandoIA(false);
      setActividadIA('');
    }
  };


  // --- Paso 3: Edición manual y regeneración de entidades ---
  const handleActualizarEntidadesPaso3 = (
    nuevasEntidades: Entidad[],
    decisionOpcional?: { descripcion: string; origen: Decision['origen'] }
  ) => {
    const nuevasDecisiones = decisionOpcional
      ? [
          ...proyecto.bitacora,
          crearRegistroDecision({
            paso: 3,
            descripcion: decisionOpcional.descripcion,
            origen: decisionOpcional.origen,
          }),
        ]
      : proyecto.bitacora;

    const nuevoEstado: ProyectoEstado = {
      ...proyecto,
      modeloConceptualConfirmado: false,
      modelo: {
        ...proyecto.modelo,
        entidades: nuevasEntidades,
      },
      bitacora: nuevasDecisiones,
    };

    void actualizarYGuardarProyecto(nuevoEstado);
  };

  const handleRegenerarModeloConIA = async () => {
    setEstadoMensaje(null);
    setCargandoIA(true);
    setActividadIA(
      'Regenerando propuesta de entidades y atributos con el tutor IA a partir de tus aclaraciones...'
    );
    try {
      const propuesta = await generarPropuestaModeloConceptual({
        descripcion: proyecto.descripcionProblema,
        rondas: proyecto.rondasAclaracion,
        supuestosConfirmados: proyecto.ultimaAclaracion?.supuestosAConfirmar ?? [],
        modeloActual: proyecto.modelo,
      });

      const decisionRegen = crearRegistroDecision({
        paso: 3,
        descripcion: 'Solicitó al tutor IA regenerar la propuesta de entidades y atributos.',
        origen: 'ia_aceptada',
      });

      const nuevoEstado: ProyectoEstado = {
        ...proyecto,
        modeloConceptualConfirmado: false,
        modelo: {
          ...proyecto.modelo,
          entidades: propuesta.entidades,
        },
        explicacionModelo: propuesta.explicacionGeneral,
        bitacora: [...proyecto.bitacora, decisionRegen],
      };

      await actualizarYGuardarProyecto(nuevoEstado);
    } catch (err) {
      const clasificado = clasificarErrorGemini(err, keyGuardada ?? undefined);
      setEstadoMensaje({
        tipo: 'error',
        texto: clasificado.mensaje,
      });
    } finally {
      setCargandoIA(false);
      setActividadIA('');
    }
  };


  const handleConfirmarModeloPaso3 = () => {
    setEstadoMensaje(null);
    const nombresEntidades = proyecto.modelo.entidades.map((e) => e.nombre).join(', ');
    const decisionConfirmacion = crearRegistroDecision({
      paso: 3,
      descripcion: `Confirmó el Modelo Conceptual con las entidades: ${nombresEntidades}.`,
      origen: 'ia_aceptada',
    });

    const nuevoEstado: ProyectoEstado = {
      ...proyecto,
      modeloConceptualConfirmado: true,
      bitacora: [...proyecto.bitacora, decisionConfirmacion],
    };

    void actualizarYGuardarProyecto(nuevoEstado);
    setEstadoMensaje({
      tipo: 'exito',
      texto: 'Modelo Conceptual confirmado y guardado en tu navegador (IndexedDB). Podés continuar al Paso 4 (Relaciones).',
    });
  };

  // --- Paso 4: Relaciones y validador determinístico ---
  const handleActualizarModeloPaso4 = (
    nuevoModelo: Modelo,
    decisionOpcional?: { descripcion: string; origen: Decision['origen'] }
  ) => {
    const nuevasDecisiones = decisionOpcional
      ? [
          ...proyecto.bitacora,
          crearRegistroDecision({
            paso: 4,
            descripcion: decisionOpcional.descripcion,
            origen: decisionOpcional.origen,
          }),
        ]
      : proyecto.bitacora;

    const nuevoEstado: ProyectoEstado = {
      ...proyecto,
      relacionesConfirmadas: false,
      modelo: nuevoModelo,
      bitacora: nuevasDecisiones,
    };

    void actualizarYGuardarProyecto(nuevoEstado);
  };

  const handleSugerirRelacionesConIA = async () => {
    setEstadoMensaje(null);
    setCargandoIA(true);
    setActividadIA('Consultando al tutor IA para inferir relaciones y cardinalidades del modelo...');
    try {
      const propuesta = await sugerirRelacionesConIA({
        entidades: proyecto.modelo.entidades,
        descripcionProblema: proyecto.descripcionProblema,
        rondas: proyecto.rondasAclaracion,
      });

      const decisionSugerencia = crearRegistroDecision({
        paso: 4,
        descripcion: `El tutor IA sugirió ${propuesta.relaciones.length} relaciones entre las entidades confirmadas.`,
        origen: 'ia_aceptada',
      });

      const nuevoEstado: ProyectoEstado = {
        ...proyecto,
        relacionesConfirmadas: false,
        modelo: {
          ...proyecto.modelo,
          relaciones: propuesta.relaciones,
        },
        explicacionRelaciones: propuesta.justificacionGeneral,
        bitacora: [...proyecto.bitacora, decisionSugerencia],
      };

      await actualizarYGuardarProyecto(nuevoEstado);
      setEstadoMensaje({
        tipo: 'exito',
        texto: 'El tutor IA sugirió las relaciones del modelo con sus respectivas cardinalidades.',
      });
    } catch (err) {
      const clasificado = clasificarErrorGemini(err, keyGuardada ?? undefined);
      setEstadoMensaje({
        tipo: 'error',
        texto: clasificado.mensaje,
      });
    } finally {
      setCargandoIA(false);
      setActividadIA('');
    }
  };


  const handlePedirExplicacionIAPaso4 = async () => {
    setEstadoMensaje(null);
    const resultado = validarModelo(proyecto.modelo);
    if (resultado.observaciones.length === 0) {
      setEstadoMensaje({
        tipo: 'exito',
        texto: 'Tu modelo no tiene observaciones pendientes.',
      });
      return;
    }

    setCargandoIA(true);
    setActividadIA(
      'Solicitando al tutor IA explicaciones pedagógicas y ejemplos para tus observaciones...'
    );
    try {
      const resIA = await explicarObservacionesConIA({
        modelo: proyecto.modelo,
        observaciones: resultado.observaciones,
        descripcionProblema: proyecto.descripcionProblema,
      });

      setExplicacionesIAPaso4(resIA);

      const decisionExplicacion = crearRegistroDecision({
        paso: 4,
        descripcion: 'Consultó al tutor IA explicaciones pedagógicas de las observaciones de diseño.',
        origen: 'ia_aceptada',
      });

      await actualizarYGuardarProyecto({
        ...proyecto,
        bitacora: [...proyecto.bitacora, decisionExplicacion],
      });
    } catch (err) {
      const clasificado = clasificarErrorGemini(err, keyGuardada ?? undefined);
      setEstadoMensaje({
        tipo: 'error',
        texto: clasificado.mensaje,
      });
    } finally {
      setCargandoIA(false);
      setActividadIA('');
    }
  };


  const handleConfirmarRelacionesPaso4 = () => {
    setEstadoMensaje(null);
    const validacion = validarModelo(proyecto.modelo);
    if (!validacion.valido) {
      setEstadoMensaje({
        tipo: 'error',
        texto: 'Corregí los errores del modelo antes de confirmar las relaciones.',
      });
      return;
    }

    const decisionConfirmacion = crearRegistroDecision({
      paso: 4,
      descripcion: `Confirmó el diseño relacional con ${proyecto.modelo.relaciones.length} relaciones.`,
      origen: 'estudiante',
    });

    const nuevoEstado: ProyectoEstado = {
      ...proyecto,
      relacionesConfirmadas: true,
      bitacora: [...proyecto.bitacora, decisionConfirmacion],
    };

    void actualizarYGuardarProyecto(nuevoEstado);
    setEstadoMensaje({
      tipo: 'exito',
      texto: 'Diseño relacional y cardinalidades confirmadas correctamente. Podés avanzar al Paso 5 (Diagrama ER).',
    });
  };

  // --- Paso 5: Diagrama ER ---
  const handleConfirmarDiagramaPaso5 = () => {
    setEstadoMensaje(null);
    const decisionConfirmacion = crearRegistroDecision({
      paso: 5,
      descripcion: `Confirmó el Diagrama ER con ${proyecto.modelo.entidades.length} entidades y ${proyecto.modelo.relaciones.length} relaciones.`,
      origen: 'estudiante',
    });

    const nuevoEstado: ProyectoEstado = {
      ...proyecto,
      diagramaConfirmado: true,
      bitacora: [...proyecto.bitacora, decisionConfirmacion],
    };

    void actualizarYGuardarProyecto(nuevoEstado);
    setEstadoMensaje({
      tipo: 'exito',
      texto: 'Diagrama ER confirmado. Ya podés continuar al Paso 6 (Motor y DDL).',
    });
  };

  // --- Paso 6: Motor de Base de Datos y Generación de DDL ---
  const handleCambiarMotorPaso6 = (motor: MotorBaseDatos) => {
    const decisionMotor = crearRegistroDecision({
      paso: 6,
      descripcion: `Seleccionó el motor de base de datos: ${motor.toUpperCase()}.`,
      origen: 'estudiante',
    });

    void actualizarYGuardarProyecto({
      ...proyecto,
      motorSeleccionado: motor,
      bitacora: [...proyecto.bitacora, decisionMotor],
    });
  };

  const handleActualizarOpcionesDDLPaso6 = (opciones: OpcionesGeneracionDDL) => {
    void actualizarYGuardarProyecto({
      ...proyecto,
      opcionesDDL: opciones,
    });
  };

  function obtenerDDLDelProyecto(proj: ProyectoEstado): string {
    if (proj.ddlGenerado) return proj.ddlGenerado;
    switch (proj.motorSeleccionado) {
      case 'postgresql':
        return generarDDLPostgres(proj.modelo, proj.opcionesDDL);
      case 'mysql':
        return generarDDLMySQL(proj.modelo, proj.opcionesDDL);
      case 'mongodb':
        return generarScriptMongo(proj.modelo, proj.opcionesDDL);
      case 'sqlite':
      default:
        return generarDDLSQLite(proj.modelo, proj.opcionesDDL);
    }
  }

  const handlePedirExplicacionIAPaso6 = async (ddlActual: string) => {
    setEstadoMensaje(null);
    setCargandoIA(true);
    setActividadIA('El tutor IA está analizando tu script para explicarlo en detalle...');
    try {
      const motor = proyecto.motorSeleccionado ?? 'sqlite';
      let explicacion: ExplicacionDDL;

      if (motor === 'postgresql') {
        explicacion = await pedirExplicacionDDLPostgresConIA({
          ddl: ddlActual,
          modelo: proyecto.modelo,
        });
      } else if (motor === 'mysql') {
        explicacion = await pedirExplicacionDDLMySQLConIA({
          ddl: ddlActual,
          modelo: proyecto.modelo,
        });
      } else if (motor === 'mongodb') {
        explicacion = await pedirExplicacionDDLMongoConIA({
          script: ddlActual,
          modelo: proyecto.modelo,
        });
      } else {
        explicacion = await pedirExplicacionDDLConIA({
          ddl: ddlActual,
          modelo: proyecto.modelo,
        });
      }

      const decisionExp = crearRegistroDecision({
        paso: 6,
        descripcion: `Consultó al tutor IA para explicar en detalle las sentencias y estructura de ${motor.toUpperCase()}.`,
        origen: 'ia_aceptada',
      });

      await actualizarYGuardarProyecto((prev) => ({
        ...prev,
        ddlGenerado: ddlActual,
        explicacionDDL: explicacion,
        bitacora: [...prev.bitacora, decisionExp],
      }));
    } catch (err) {
      const clasificado = clasificarErrorGemini(err, keyGuardada ?? undefined);
      setEstadoMensaje({
        tipo: 'error',
        texto: clasificado.mensaje,
      });
    } finally {
      setCargandoIA(false);
      setActividadIA('');
    }
  };


  const handleConfirmarDDLPaso6 = (ddlActual: string) => {
    setEstadoMensaje(null);
    const motorNombre = (proyecto.motorSeleccionado ?? 'sqlite').toUpperCase();
    const decisionConfirmacion = crearRegistroDecision({
      paso: 6,
      descripcion: `Confirmó el script DDL de creación de tablas para ${motorNombre} (${proyecto.modelo.entidades.length} tablas).`,
      origen: 'estudiante',
    });

    const nuevoEstado: ProyectoEstado = {
      ...proyecto,
      pasoActual: 7,
      ddlGenerado: ddlActual,
      ddlConfirmado: true,
      bitacora: [...proyecto.bitacora, decisionConfirmacion],
    };

    void actualizarYGuardarProyecto(nuevoEstado);
    setEstadoMensaje({
      tipo: 'exito',
      texto: 'Script DDL confirmado. Podés avanzar al Paso 7 para poblar la base con datos de prueba coherentes.',
    });
  };

  // --- Paso 7: Datos de Ejemplo y Ejecución Real en SQLite ---
  const handleCambiarCantidadFilasPaso7 = (cantidad: number) => {
    void actualizarYGuardarProyecto((prev) => ({
      ...prev,
      cantidadFilasEjemplo: cantidad,
    }));
  };

  const handleGenerarDatosConIAPaso7 = async (cantidad: number) => {
    setEstadoMensaje(null);
    setCargandoIA(true);
    setActividadIA(
      `El tutor IA está generando ${cantidad} filas de prueba por tabla, respetando tipos y claves foráneas...`
    );

    try {
      const actual = proyectoRef.current;
      const datos = await generarDatosEjemploConIA({
        modelo: actual.modelo,
        cantidadFilas: cantidad,
        descripcionProblema: actual.descripcionProblema,
        rondasAclaracion: actual.rondasAclaracion,
      });

      const decisionDatos = crearRegistroDecision({
        paso: 7,
        descripcion: `Generó con tutor IA ${cantidad} filas de ejemplo por tabla coherentes con las relaciones.`,
        origen: 'ia_aceptada',
      });

      await actualizarYGuardarProyecto((prev) => ({
        ...prev,
        cantidadFilasEjemplo: cantidad,
        datosEjemplo: datos,
        datosConfirmados: false,
        baseSQLiteGenerada: false,
        bitacora: [...prev.bitacora, decisionDatos],
      }));
      setEstadoMensaje({
        tipo: 'exito',
        texto: `Se generaron exitosamente ${cantidad} filas de datos coherentes para cada tabla.`,
      });
    } catch (err) {
      const clasificado = clasificarErrorGemini(err, keyGuardada ?? undefined);
      setEstadoMensaje({
        tipo: 'error',
        texto: clasificado.mensaje,
      });
    } finally {
      setCargandoIA(false);
      setActividadIA('');
    }
  };

  const handleGenerarDatosLocalesPaso7 = (cantidad: number) => {
    setEstadoMensaje(null);
    try {
      const actual = proyectoRef.current;
      const datos = generarDatosEjemploLocales(actual.modelo, cantidad);
      const decisionDatos = crearRegistroDecision({
        paso: 7,
        descripcion: `Generó localmente ${cantidad} filas de prueba determinísticas por tabla con integridad referencial respetada (sin IA).`,
        origen: 'estudiante',
      });

      void actualizarYGuardarProyecto((prev) => ({
        ...prev,
        cantidadFilasEjemplo: cantidad,
        datosEjemplo: datos,
        datosConfirmados: false,
        baseSQLiteGenerada: false,
        bitacora: [...prev.bitacora, decisionDatos],
      }));

      setEstadoMensaje({
        tipo: 'exito',
        texto: `Se generaron localmente ${cantidad} filas de prueba coherentes para cada tabla respetando claves foráneas e integridad referencial.`,
      });
    } catch (err) {
      setEstadoMensaje({
        tipo: 'error',
        texto: err instanceof Error ? err.message : 'Error al generar los datos de prueba locales.',
      });
    }
  };

  const handleEjecutarEnSQLitePaso7 = async () => {
    setEstadoMensaje(null);
    setEjecutandoSQLite(true);
    setActividadIA('Inicializando WebAssembly y ejecutando DDL + INSERTs en SQLite...');

    try {
      const actual = proyectoRef.current;
      const ddlAEjecutar =
        actual.motorSeleccionado === 'sqlite' && actual.ddlGenerado
          ? actual.ddlGenerado
          : generarDDLSQLite(actual.modelo, actual.opcionesDDL);
      await sqliteClient.ejecutarDDL(ddlAEjecutar);

      if (actual.datosEjemplo) {
        const inserts = generarInsertStatementsSQLite(actual.datosEjemplo);
        await sqliteClient.insertarDatos(inserts);
      }

      const decisionEjecucion = crearRegistroDecision({
        paso: 7,
        descripcion: 'Compiló y ejecutó exitosamente el DDL y los datos en la base SQLite en memoria (sql.js WASM).',
        origen: 'estudiante',
      });

      await actualizarYGuardarProyecto((prev) => ({
        ...prev,
        baseSQLiteGenerada: true,
        bitacora: [...prev.bitacora, decisionEjecucion],
      }));

      setEstadoMensaje({
        tipo: 'exito',
        texto: '¡Base de datos SQLite creada y poblada exitosamente en tu navegador (WASM)!',
      });
    } catch (err) {
      setEstadoMensaje({
        tipo: 'error',
        texto: err instanceof Error ? `Error de SQLite: ${err.message}` : 'Error al ejecutar en SQLite.',
      });
    } finally {
      setEjecutandoSQLite(false);
      setActividadIA('');
    }
  };

  const handleDescargarSQLitePaso7 = async () => {
    try {
      const binario = await sqliteClient.exportarBinario();
      sqliteClient.descargarArchivoSQLite(binario, 'base_de_datos.sqlite');
      const dec = crearRegistroDecision({
        paso: 7,
        descripcion: 'Descargó el archivo binario de la base de datos (.sqlite) compilado en el navegador.',
        origen: 'estudiante',
      });
      void actualizarYGuardarProyecto((prev) => ({
        ...prev,
        bitacora: [...prev.bitacora, dec],
      }));
    } catch (err) {
      setEstadoMensaje({
        tipo: 'error',
        texto: err instanceof Error ? err.message : 'Error al exportar el archivo SQLite binario.',
      });
    }
  };

  const handleConfirmarDatosPaso7 = async () => {
    setEstadoMensaje(null);
    const actual = proyectoRef.current;

    // Asegurar que la base SQLite WASM se inicialice y ejecute en memoria
    let baseGenerada = actual.baseSQLiteGenerada;
    if (!baseGenerada) {
      try {
        const ddlAEjecutar =
          actual.motorSeleccionado === 'sqlite' && actual.ddlGenerado
            ? actual.ddlGenerado
            : generarDDLSQLite(actual.modelo, actual.opcionesDDL);
        await sqliteClient.ejecutarDDL(ddlAEjecutar);
        if (actual.datosEjemplo) {
          const inserts = generarInsertStatementsSQLite(actual.datosEjemplo);
          await sqliteClient.insertarDatos(inserts);
        }
        baseGenerada = true;
      } catch (err) {
        console.warn('Auto-ejecución SQLite en Paso 7:', err);
      }
    }

    const decisionConfirmacion = crearRegistroDecision({
      paso: 7,
      descripcion: `Confirmó los datos de ejemplo (${actual.cantidadFilasEjemplo ?? 3} filas por tabla) y dejó la base SQLite WASM lista.`,
      origen: 'estudiante',
    });

    await actualizarYGuardarProyecto((prev) => ({
      ...prev,
      datosConfirmados: true,
      baseSQLiteGenerada: baseGenerada ?? true,
      pasoActual: 8,
      bitacora: [...prev.bitacora, decisionConfirmacion],
    }));
    setEstadoMensaje({
      tipo: 'exito',
      texto: 'Datos de prueba confirmados. La base SQLite está activa para el Paso 8 (Informes y consultas).',
    });
  };

  // --- Paso 8: Informes Personalizados y Consultas SELECT ---
  const handleGenerarInformeConIAPaso8 = async (pedido: string): Promise<Informe> => {
    setCargandoIA(true);
    setActividadIA('El tutor IA está analizando tu pedido y generando una consulta SELECT segura...');

    try {
      const actual = proyectoRef.current;
      const propuesta = await generarConsultaInformeConIA({
        modelo: actual.modelo,
        pedidoEstudiante: pedido,
        descripcionProblema: actual.descripcionProblema,
      });

      const nuevoInforme: Informe = {
        id: `informe_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        titulo: propuesta.titulo,
        pedidoLenguajeNatural: pedido,
        consultaSQL: propuesta.consultaSQL,
        explicacionPasoAPaso: propuesta.explicacionPasoAPaso,
        tipoGrafico: propuesta.tipoGraficoSugerido,
        columnaEtiquetas: propuesta.columnaEtiquetas,
        columnaValores: propuesta.columnaValores,
        fechaCreacion: new Date().toISOString(),
      };

      const decisionInforme = crearRegistroDecision({
        paso: 8,
        descripcion: `Generó consulta SQL para: "${propuesta.titulo}" (${pedido}).`,
        origen: 'ia_aceptada',
      });

      await actualizarYGuardarProyecto((prev) => ({
        ...prev,
        informes: [...(prev.informes || []), nuevoInforme],
        bitacora: [...prev.bitacora, decisionInforme],
      }));

      return nuevoInforme;
    } finally {
      setCargandoIA(false);
      setActividadIA('');
    }
  };

  const handleGuardarOActualizarInformePaso8 = (informe: Informe) => {
    void actualizarYGuardarProyecto((prev) => {
      const listaActual = prev.informes || [];
      const existeIdx = listaActual.findIndex((inf) => inf.id === informe.id);
      let nuevaLista: Informe[];

      if (existeIdx >= 0) {
        nuevaLista = [...listaActual];
        nuevaLista[existeIdx] = informe;
      } else {
        nuevaLista = [...listaActual, informe];
      }

      return {
        ...prev,
        informes: nuevaLista,
      };
    });
  };

  const handleEliminarInformePaso8 = (id: string) => {
    void actualizarYGuardarProyecto((prev) => ({
      ...prev,
      informes: (prev.informes || []).filter((inf) => inf.id !== id),
      informesConfirmados: false,
    }));
  };

  const handleConfirmarInformesPaso8 = () => {
    setEstadoMensaje(null);
    const actual = proyectoRef.current;
    const totalInformes = actual.informes?.length || 0;
    const decisionConfirmacion = crearRegistroDecision({
      paso: 8,
      descripcion: `Confirmó los informes y consultas analíticas del proyecto (${totalInformes} informes diseñados).`,
      origen: 'estudiante',
    });

    const analisisInicial = actual.analisisResumido || generarAnalisisResumidoFallback(actual);

    void actualizarYGuardarProyecto((prev) => ({
      ...prev,
      informesConfirmados: true,
      analisisResumido: prev.analisisResumido || analisisInicial,
      pasoActual: 9,
      bitacora: [...prev.bitacora, decisionConfirmacion],
    }));
    setEstadoMensaje({
      tipo: 'exito',
      texto: '¡Felicitaciones! Has completado el ciclo de diseño. Avanzando a la pantalla de Entregables.',
    });
  };

  // --- Exportar / Importar / Reiniciar proyecto ---
  const handleExportarProyecto = () => {
    const jsonStr = exportarProyectoAJson(proyecto);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'proyecto.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportarArchivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEstadoMensaje(null);

    try {
      const texto = await file.text();
      const importado = importarProyectoDesdeJson(texto);
      await actualizarYGuardarProyecto(importado);
      setEstadoMensaje({
        tipo: 'exito',
        texto: 'Proyecto importado y validado correctamente.',
      });
    } catch (err) {
      setEstadoMensaje({
        tipo: 'error',
        texto: err instanceof Error ? err.message : 'Error al importar el proyecto.',
      });
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleReiniciarProyecto = async () => {
    const limpio = await reiniciarProyectoEnIndexedDB();
    setProyecto(limpio);
    setEstadoMensaje({
      tipo: 'exito',
      texto: 'Se inició un proyecto limpio desde el Paso 1.',
    });
  };

  const puedeIrAPaso = (numero: number): boolean => {
    if (numero === 1) return true;
    if (numero === 2) return proyecto.descripcionProblema.trim().length > 0;
    if (numero === 3) return proyecto.claridadConfirmada;
    if (numero === 4) return proyecto.modeloConceptualConfirmado;
    if (numero === 5) return Boolean(proyecto.relacionesConfirmadas);
    if (numero === 6) return Boolean(proyecto.diagramaConfirmado);
    if (numero === 7) return Boolean(proyecto.ddlConfirmado);
    if (numero === 8) return Boolean(proyecto.ddlConfirmado || proyecto.datosConfirmados || proyecto.datosEjemplo || proyecto.pasoActual >= 7);
    if (numero === 9) return Boolean(proyecto.modeloConceptualConfirmado);
    return false;
  };

  const irAPaso = (numero: number) => {
    if (puedeIrAPaso(numero)) {
      setEstadoMensaje(null);
      void actualizarYGuardarProyecto((prev) => ({
        ...prev,
        pasoActual: numero,
      }));
    }
  };

  const pasoCompletado = (numero: number): boolean => {
    if (numero === 1) return proyecto.descripcionProblema.trim().length > 0;
    if (numero === 2) return proyecto.claridadConfirmada;
    if (numero === 3) return proyecto.modeloConceptualConfirmado;
    if (numero === 4) return Boolean(proyecto.relacionesConfirmadas);
    if (numero === 5) return Boolean(proyecto.diagramaConfirmado);
    if (numero === 6) return Boolean(proyecto.ddlConfirmado);
    if (numero === 7) return Boolean(proyecto.datosConfirmados);
    if (numero === 8) return Boolean(proyecto.informesConfirmados);
    if (numero === 9) return Boolean(proyecto.analisisResumido);
    return false;
  };

  const totalAtributos = proyecto.modelo.entidades.reduce(
    (acc, ent) => acc + ent.atributos.length,
    0
  );

  const procesando = probando || cargandoIA;

  return (
    <div className="app-shell">
      {/* Salto de accesibilidad para lectores de pantalla y navegación por teclado */}
      <a href="#main-content" className="skip-link">
        Saltar al contenido principal
      </a>

      {/* Top Command Bar */}
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-logo" aria-hidden="true">
            DB
          </div>
          <div>
            <div className="brand-title-row">
              <h1 className="app-title">DB Tutor Studio</h1>
              <span className="tech-chip">BYOK · Local-First</span>
            </div>
            <p className="app-subtitle">
              Arquitectura conceptual, relacional y documental asistida por IA · Modelo activo:{' '}
              <code>{modeloSeleccionado}</code>
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setMostrarGlosario(true)}
            title="Abrir glosario pedagógico de bases de datos"
            aria-label="Abrir glosario de bases de datos"
            data-testid="open-glossary-btn"
          >
            📖 Glosario
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={toggleTema}
            title={`Cambiar a tema ${tema === 'dark' ? 'claro' : 'oscuro'}`}
            aria-label={`Cambiar a tema ${tema === 'dark' ? 'claro' : 'oscuro'}`}
            data-testid="theme-toggle-btn"
          >
            {tema === 'dark' ? '☀️ Modo Claro' : '🌙 Modo Oscuro'}
          </button>

          {keyGuardada && (
            <div className="key-status-bar" aria-label="Estado de la API key y proveedor">
              <span className="status-dot-online" aria-hidden="true" />
              <select
                className="select-input select-compact"
                value={proveedorSeleccionado}
                onChange={(e) => handleCambioProveedor(e.target.value as ProveedorLLM)}
                aria-label="Seleccionar proveedor de IA"
                disabled={procesando}
                style={{ fontWeight: 600 }}
                data-testid="selector-proveedor-header"
              >
                <option value="gemini">Google Gemini</option>
                <option value="openrouter">OpenRouter (Free)</option>
                <option value="ollama">Ollama Local (11434)</option>
              </select>
              <span className="key-label">Key:</span>
              <span className="key-badge" data-testid="masked-key">
                {enmascararApiKey(keyGuardada)}
              </span>
              <label htmlFor="selector-modelo-header" className="sr-only">
                Modelo de IA
              </label>
              <select
                id="selector-modelo-header"
                className="select-input select-compact"
                value={modeloSeleccionado}
                onChange={(e) => handleCambioModelo(e.target.value)}
                aria-label="Seleccionar modelo"
                disabled={procesando}
                style={{ maxWidth: '240px' }}
                data-testid="selector-modelo-header"
              >
                {modelosOpciones.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleProbarConexion}
                disabled={procesando}
              >
                {probando ? 'Probando...' : 'Probar conexión'}
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={handleOlvidarKey}
                disabled={procesando}
              >
                Olvidar key ahora
              </button>
            </div>
          )}
        </div>
      </header>

      {/* HUD de Actividad de IA en tiempo real (visible siempre que Gemini está pensando) */}
      {procesando && (
        <div
          className="ai-thinking-hud"
          role="status"
          aria-live="polite"
          data-testid="ai-thinking-indicator"
        >
          <div className="ai-spinner-orb" aria-hidden="true">
            <div className="ai-spinner-ring" />
            <div className="ai-spinner-core" />
          </div>
          <div className="ai-thinking-body">
            <div className="ai-thinking-title">
              <span>Gemini está procesando tu consulta</span>
              <span className="ai-thinking-model-tag">{modeloSeleccionado}</span>
            </div>
            <p className="ai-thinking-subtitle">
              {actividadIA || 'Analizando información y validando estructura JSON con Zod...'}
            </p>
            <div className="ai-progress-track" aria-hidden="true">
              <div className="ai-progress-bar" />
            </div>
          </div>
        </div>
      )}

      <main className="app-main" id="main-content" tabIndex={-1}>
        {!keyGuardada ? (
          /* Vista Modular de Onboarding (2 columnas: Escudo de Seguridad + Configuración BYOK) */
          <div className="onboarding-grid">
            <section
              className="security-notice"
              aria-labelledby="titulo-aviso-seguridad"
              data-testid="security-notice"
            >
              <div className="module-tag module-tag-warn">Seguridad BYOK · Lectura obligatoria</div>
              <h2 id="titulo-aviso-seguridad" className="security-notice-title">
                Aviso importante de seguridad y privacidad
              </h2>
              <div className="security-cards-grid">
                <div className="security-mini-card">
                  <strong>1. Guardado efímero</strong>
                  <p>
                    Tu API key se guarda <strong>únicamente en esta pestaña</strong> (
                    <code>sessionStorage</code>) y se destruye al cerrarla. Nunca se envía a
                    servidores propios.
                  </p>
                </div>
                <div className="security-mini-card">
                  <strong>2. Key exclusiva</strong>
                  <p>
                    Creá una API key en Google AI Studio exclusiva para este curso y eliminala al
                    terminar la materia.
                  </p>
                </div>
                <div className="security-mini-card">
                  <strong>3. Computadoras compartidas</strong>
                  <p>
                    En laboratorios o PCs compartidas: presioná{' '}
                    <em>&ldquo;Olvidar key ahora&rdquo;</em>, cerrá la pestaña y revocá la key en AI
                    Studio.
                  </p>
                </div>
                <div className="security-mini-card">
                  <strong>4. Sin datos sensibles</strong>
                  <p>
                    No cargues nombres, documentos ni datos reales de personas. Según los términos
                    del nivel gratuito de Gemini, Google puede usar los contenidos enviados.
                  </p>
                </div>
              </div>

              <label className="checkbox-row onboarding-accept-box">
                <input
                  type="checkbox"
                  checked={avisoAceptado}
                  onChange={(e) => setAvisoAceptado(e.target.checked)}
                  data-testid="accept-notice-checkbox"
                />
                <span>
                  Leí y comprendí las recomendaciones de seguridad y privacidad para usar mi API
                  key.
                </span>
              </label>
            </section>

            <section className="card onboarding-key-card" aria-labelledby="titulo-ingreso-key">
              <div className="module-tag">Conexión Directa en Navegador</div>
              <h2 id="titulo-ingreso-key" className="card-title">
                Configurar Proveedor y API Key (Free Tier)
              </h2>
              <form onSubmit={handleGuardarKey}>
                <div className="form-group">
                  <label htmlFor="selector-proveedor-onboarding" className="form-label">
                    Proveedor de Inteligencia Artificial
                  </label>
                  <select
                    id="selector-proveedor-onboarding"
                    className="select-input"
                    value={proveedorSeleccionado}
                    onChange={(e) => handleCambioProveedor(e.target.value as ProveedorLLM)}
                    data-testid="selector-proveedor-onboarding"
                  >
                    <option value="gemini">Google Gemini (Google AI Studio)</option>
                    <option value="openrouter">OpenRouter (Modelos Gratuitos :free)</option>
                    <option value="ollama">Ollama Local (localhost:11434 - Sin API Key)</option>
                  </select>
                  <p className="form-help">
                    {proveedorSeleccionado === 'ollama' ? (
                      <>
                        Ollama ejecuta modelos open-source directamente en tu PC (<code>localhost:11434</code>).
                        Recomendado para bases de datos: <code>qwen2.5-coder:7b</code> o <code>llama3.2:3b</code>. No requiere API key externa.
                      </>
                    ) : proveedorSeleccionado === 'openrouter' ? (
                      <>
                        Podés obtener tu clave gratuita en{' '}
                        <a
                          href="https://openrouter.ai/keys"
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: 'var(--color-primary, #2563eb)', textDecoration: 'underline' }}
                        >
                          openrouter.ai/keys
                        </a>
                        . Se listarán únicamente los modelos de tier gratuito (<code>:free</code>).
                      </>
                    ) : (
                      <>
                        Podés obtener tu clave gratuita en{' '}
                        <a
                          href="https://aistudio.google.com/app/apikey"
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: 'var(--color-primary, #2563eb)', textDecoration: 'underline' }}
                        >
                          Google AI Studio
                        </a>
                        .
                      </>
                    )}
                  </p>
                </div>

                <div className="form-group">
                  <label htmlFor="api-key-input" className="form-label">
                    {proveedorSeleccionado === 'ollama'
                      ? 'Servidor Local Ollama'
                      : proveedorSeleccionado === 'openrouter'
                        ? 'Pegá tu API key de OpenRouter'
                        : 'Pegá tu API key de Google AI Studio'}
                  </label>
                  <p className="form-help">
                    {proveedorSeleccionado === 'ollama'
                      ? 'Ollama no requiere API key. Se comunicará con tu instancia local en http://localhost:11434.'
                      : 'La clave permanece enmascarada en pantalla, reside solo en esta pestaña (sessionStorage) y jamás se incluye en archivos exportados.'}
                  </p>
                  <div className="input-row">
                    <input
                      id="api-key-input"
                      type={proveedorSeleccionado === 'ollama' ? 'text' : 'password'}
                      className="text-input"
                      placeholder={
                        proveedorSeleccionado === 'ollama'
                          ? 'http://localhost:11434 (Local)'
                          : proveedorSeleccionado === 'openrouter'
                            ? 'sk-or-v1-...'
                            : 'AIzaSy...'
                      }
                      value={proveedorSeleccionado === 'ollama' ? 'http://localhost:11434 (Local)' : inputKey}
                      onChange={(e) => setInputKey(e.target.value)}
                      disabled={proveedorSeleccionado === 'ollama'}
                      autoComplete="off"
                      spellCheck={false}
                      data-testid="api-key-input"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="selector-modelo-onboarding" className="form-label">
                    Modelo de {proveedorSeleccionado === 'ollama' ? 'Ollama Local' : proveedorSeleccionado === 'openrouter' ? 'OpenRouter (Gratuitos :free)' : 'Gemini'}
                  </label>
                  <select
                    id="selector-modelo-onboarding"
                    className="select-input"
                    value={modeloSeleccionado}
                    onChange={(e) => handleCambioModelo(e.target.value)}
                    data-testid="selector-modelo-onboarding"
                  >
                    {modelosOpciones.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="button-group">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={
                      !avisoAceptado ||
                      (proveedorSeleccionado !== 'ollama' && !inputKey.trim()) ||
                      procesando
                    }
                    data-testid="save-key-btn"
                  >
                    {proveedorSeleccionado === 'ollama'
                      ? 'Conectar con Ollama Local'
                      : 'Guardar key en esta pestaña'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleProbarConexion}
                    disabled={
                      procesando || (proveedorSeleccionado !== 'ollama' && !inputKey.trim())
                    }
                    data-testid="test-connection-btn"
                  >
                    {probando ? 'Probando conexión...' : 'Probar conexión'}
                  </button>
                </div>
              </form>

              {estadoMensaje && (
                <div
                  role="status"
                  className={`alert ${
                    estadoMensaje.tipo === 'exito' ? 'alert-success' : 'alert-error'
                  }`}
                  data-testid="status-message"
                >
                  {estadoMensaje.texto}
                </div>
              )}
            </section>
          </div>
        ) : (
          /* Workspace Modular de 3 Paneles (Sidebar Izquierdo + Estudio Central + Inspector Derecho) */
          <div className="workspace-grid" data-testid="ready-workspace">
            {/* Panel Izquierdo: Mapa de Ruta de 8 Pasos + Cápsula de Seguridad */}
            <aside className="workspace-sidebar" aria-label="Mapa de pasos del proyecto">
              <div className="card sidebar-card">
                <div className="sidebar-header">
                  <span className="module-tag">Ruta Pedagógica</span>
                  <h2 className="sidebar-title">Pasos de Diseño</h2>
                </div>

                <nav className="wizard-vertical-nav" aria-label="Pasos del asistente">
                  {ETIQUETAS_PASOS.map((paso) => {
                    const habilitado = puedeIrAPaso(paso.numero);
                    const activo = proyecto.pasoActual === paso.numero;
                    const completado = pasoCompletado(paso.numero);
                    return (
                      <button
                        key={paso.numero}
                        type="button"
                        className={`wizard-step-card ${activo ? 'active' : ''} ${
                          completado ? 'completed' : ''
                        } ${!habilitado ? 'locked' : ''}`}
                        disabled={!habilitado || procesando}
                        onClick={() =>
                          void actualizarYGuardarProyecto({
                            ...proyecto,
                            pasoActual: paso.numero,
                          })
                        }
                        data-testid={`wizard-step-btn-${paso.numero}`}
                      >
                        <span className="step-num-circle">
                          {completado ? '✓' : paso.numero}
                        </span>
                        <span className="step-card-text">
                          <span className="step-card-title">{paso.titulo}</span>
                          <span className="step-card-sub">{paso.subtitulo}</span>
                        </span>
                      </button>
                    );
                  })}
                </nav>

                <div className="sidebar-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm btn-block"
                    onClick={handleExportarProyecto}
                    disabled={procesando}
                    data-testid="export-project-btn"
                  >
                    ⬇ Exportar proyecto.json
                  </button>
                  <label className="btn btn-secondary btn-sm btn-block file-label-btn">
                    ⬆ Importar proyecto.json
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json,application/json"
                      className="sr-only"
                      onChange={handleImportarArchivo}
                      disabled={procesando}
                      data-testid="import-project-input"
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm btn-block"
                    onClick={handleReiniciarProyecto}
                    disabled={procesando}
                    data-testid="reset-project-btn"
                  >
                    ↺ Nuevo proyecto
                  </button>

                  <div style={{ marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(148, 163, 184, 0.2)' }}>
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, marginBottom: '0.35rem' }}>
                      Cargar Ejemplo Completo:
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.35rem' }}>
                      {LISTA_PRESETS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ fontSize: '0.72rem', padding: '0.3rem 0.2rem', textAlign: 'center' }}
                          onClick={() => handleCargarPreset(p.id)}
                          title={`Cargar demo completo: ${p.titulo}`}
                          data-testid={`sidebar-preset-${p.id}`}
                        >
                          {p.icono} {p.id.slice(0, 4)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Recordatorio de seguridad compacto en el sidebar */}
              <section
                className="security-notice security-notice-compact"
                aria-labelledby="titulo-aviso-seguridad"
                data-testid="security-notice"
              >
                <details>
                  <summary id="titulo-aviso-seguridad" className="security-compact-summary">
                    🛡️ Aviso de seguridad BYOK
                  </summary>
                  <ul className="security-notice-list">
                    <li>
                      Tu API key (<code data-testid="active-masked-key">{enmascararApiKey(keyGuardada)}</code>) se guarda{' '}
                      <strong>únicamente en esta pestaña</strong> (<code>sessionStorage</code>).
                    </li>
                    <li>Usá una key exclusiva para este curso.</li>
                    <li>
                      En <strong>Computadoras compartidas</strong>, tocá &ldquo;Olvidar key ahora&rdquo; y cerrá la pestaña.
                    </li>
                    <li>No cargues nombres, documentos ni datos reales de personas.</li>
                  </ul>
                </details>
              </section>
            </aside>

            {/* Panel Central: Estudio Activo */}
            <div className="workspace-center">
              {estadoMensaje && (
                <div
                  role="status"
                  className={`alert ${
                    estadoMensaje.tipo === 'exito' ? 'alert-success' : 'alert-error'
                  }`}
                  data-testid="status-message"
                >
                  {estadoMensaje.texto}
                </div>
              )}

              {proyecto.pasoActual === 1 && (
                <Step1Problema
                  descripcionInicial={proyecto.descripcionProblema}
                  cargando={cargandoIA}
                  onConfirmarDescripcion={handleConfirmarDescripcionPaso1}
                  onCargarPresetCompleto={handleCargarPreset}
                />
              )}

              {proyecto.pasoActual === 2 && (
                <Step2Aclaracion
                  descripcionProblema={proyecto.descripcionProblema}
                  rondasAclaracion={proyecto.rondasAclaracion}
                  ultimaAclaracion={proyecto.ultimaAclaracion}
                  cargando={cargandoIA}
                  onResponderRonda={handleResponderRondaPaso2}
                  onConfirmarAclaracion={handleConfirmarAclaracionPaso2}
                  onVolverPaso1={() =>
                    void actualizarYGuardarProyecto({ ...proyecto, pasoActual: 1 })
                  }
                />
              )}

              {proyecto.pasoActual === 3 && (
                <Step3ModeloConceptual
                  entidades={proyecto.modelo.entidades}
                  explicacionGeneral={proyecto.explicacionModelo}
                  modeloConfirmado={proyecto.modeloConceptualConfirmado}
                  cargando={cargandoIA}
                  onActualizarEntidades={handleActualizarEntidadesPaso3}
                  onRegenerarConIA={handleRegenerarModeloConIA}
                  onConfirmarModelo={handleConfirmarModeloPaso3}
                  onVolverPaso2={() =>
                    void actualizarYGuardarProyecto({ ...proyecto, pasoActual: 2 })
                  }
                />
              )}

              {proyecto.pasoActual === 4 && (
                <Step4Relaciones
                  modelo={proyecto.modelo}
                  relacionesConfirmadas={Boolean(proyecto.relacionesConfirmadas)}
                  explicacionRelaciones={proyecto.explicacionRelaciones}
                  cargando={cargandoIA}
                  onActualizarModelo={handleActualizarModeloPaso4}
                  onSugerirConIA={handleSugerirRelacionesConIA}
                  onPedirExplicacionIA={handlePedirExplicacionIAPaso4}
                  explicacionesIA={explicacionesIAPaso4}
                  onConfirmarRelaciones={handleConfirmarRelacionesPaso4}
                  onVolverPaso3={() =>
                    void actualizarYGuardarProyecto({ ...proyecto, pasoActual: 3 })
                  }
                />
              )}

              {proyecto.pasoActual === 5 && (
                <Step5DiagramaER
                  modelo={proyecto.modelo}
                  diagramaConfirmado={Boolean(proyecto.diagramaConfirmado)}
                  cargando={cargandoIA}
                  onConfirmarDiagrama={handleConfirmarDiagramaPaso5}
                  onVolverPaso4={() =>
                    void actualizarYGuardarProyecto({ ...proyecto, pasoActual: 4 })
                  }
                  onRegistrarDecision={(descripcion, origen) => {
                    const dec = crearRegistroDecision({ paso: 5, descripcion, origen });
                    void actualizarYGuardarProyecto((prev) => ({
                      ...prev,
                      bitacora: [...prev.bitacora, dec],
                    }));
                  }}
                />
              )}

              {proyecto.pasoActual === 6 && (
                <Step6MotorDDL
                  modelo={proyecto.modelo}
                  motorSeleccionado={proyecto.motorSeleccionado ?? 'sqlite'}
                  opcionesDDL={proyecto.opcionesDDL}
                  explicacionDDL={proyecto.explicacionDDL}
                  ddlConfirmado={Boolean(proyecto.ddlConfirmado)}
                  cargandoIA={cargandoIA}
                  onCambiarMotor={handleCambiarMotorPaso6}
                  onActualizarOpcionesDDL={handleActualizarOpcionesDDLPaso6}
                  onPedirExplicacionIA={handlePedirExplicacionIAPaso6}
                  onConfirmarDDL={handleConfirmarDDLPaso6}
                  onVolverPaso5={() =>
                    void actualizarYGuardarProyecto((prev) => ({ ...prev, pasoActual: 5 }))
                  }
                  onRegistrarDecision={(descripcion, origen) => {
                    const dec = crearRegistroDecision({ paso: 6, descripcion, origen });
                    void actualizarYGuardarProyecto((prev) => ({
                      ...prev,
                      bitacora: [...prev.bitacora, dec],
                    }));
                  }}
                />
              )}

              {proyecto.pasoActual === 7 && (
                <Step7DatosEjemplo
                  modelo={proyecto.modelo}
                  motorSeleccionado={proyecto.motorSeleccionado}
                  ddlGenerado={obtenerDDLDelProyecto(proyecto)}
                  cantidadFilas={proyecto.cantidadFilasEjemplo ?? 3}
                  datosEjemplo={proyecto.datosEjemplo}
                  datosConfirmados={Boolean(proyecto.datosConfirmados)}
                  baseSQLiteGenerada={Boolean(proyecto.baseSQLiteGenerada)}
                  cargandoIA={cargandoIA}
                  ejecutandoSQLite={ejecutandoSQLite}
                  onCambiarCantidadFilas={handleCambiarCantidadFilasPaso7}
                  onGenerarDatosConIA={handleGenerarDatosConIAPaso7}
                  onGenerarDatosLocales={handleGenerarDatosLocalesPaso7}
                  onEjecutarEnSQLite={handleEjecutarEnSQLitePaso7}
                  onDescargarSQLite={handleDescargarSQLitePaso7}
                  onConfirmarDatos={handleConfirmarDatosPaso7}
                  onVolverPaso6={() =>
                    void actualizarYGuardarProyecto((prev) => ({ ...prev, pasoActual: 6 }))
                  }
                  onRegistrarDecision={(descripcion, origen) => {
                    const dec = crearRegistroDecision({ paso: 7, descripcion, origen });
                    void actualizarYGuardarProyecto((prev) => ({
                      ...prev,
                      bitacora: [...prev.bitacora, dec],
                    }));
                  }}
                />
              )}

              {proyecto.pasoActual === 8 && (
                <Step8Informes
                  modelo={proyecto.modelo}
                  motorSeleccionado={proyecto.motorSeleccionado}
                  ddlGenerado={
                    proyecto.motorSeleccionado === 'sqlite' && proyecto.ddlGenerado
                      ? proyecto.ddlGenerado
                      : generarDDLSQLite(proyecto.modelo, proyecto.opcionesDDL)
                  }
                  datosEjemplo={proyecto.datosEjemplo}
                  informes={proyecto.informes || []}
                  informesConfirmados={Boolean(proyecto.informesConfirmados)}
                  cargandoIA={cargandoIA}
                  onGenerarInformeConIA={handleGenerarInformeConIAPaso8}
                  onGuardarOActualizarInforme={handleGuardarOActualizarInformePaso8}
                  onEliminarInforme={handleEliminarInformePaso8}
                  onConfirmarInformes={handleConfirmarInformesPaso8}
                  onBaseSQLiteInicializada={() => {
                    if (!proyectoRef.current.baseSQLiteGenerada) {
                      void actualizarYGuardarProyecto((prev) => ({
                        ...prev,
                        baseSQLiteGenerada: true,
                      }));
                    }
                  }}
                  onVolverPaso7={() =>
                    void actualizarYGuardarProyecto((prev) => ({ ...prev, pasoActual: 7 }))
                  }
                  onRegistrarDecision={(descripcion, origen) => {
                    const dec = crearRegistroDecision({ paso: 8, descripcion, origen });
                    void actualizarYGuardarProyecto((prev) => ({
                      ...prev,
                      bitacora: [...prev.bitacora, dec],
                    }));
                  }}
                />
              )}

              {proyecto.pasoActual === 9 && (
                <StepEntregables
                  proyecto={proyecto}
                  onActualizarProyecto={(cambios) =>
                    void actualizarYGuardarProyecto({ ...proyecto, ...cambios })
                  }
                  onVolver={() =>
                    void actualizarYGuardarProyecto({ ...proyecto, pasoActual: 8 })
                  }
                />
              )}
            </div>

            {/* Panel Derecho: Telemetría Local del Modelo + Bitácora de Decisiones */}
            <aside className="workspace-inspector" aria-label="Inspector del modelo y bitácora">
              <div className="card inspector-stats-card">
                <div className="module-tag">Estado en Vivo</div>
                <h2 className="sidebar-title">Resumen del Diseño</h2>
                <div className="stats-grid">
                  <button
                    type="button"
                    className="stat-tile clickable"
                    onClick={() => irAPaso(2)}
                    title="Paso 2: Rondas de aclaración realizadas"
                  >
                    <span className="stat-value">{proyecto.rondasAclaracion.length}/3</span>
                    <span className="stat-label">Rondas aclaración</span>
                  </button>
                  <button
                    type="button"
                    className="stat-tile clickable"
                    onClick={() => irAPaso(3)}
                    title="Paso 3: Entidades del modelo conceptual"
                  >
                    <span className="stat-value">{proyecto.modelo.entidades.length}</span>
                    <span className="stat-label">Entidades</span>
                  </button>
                  <button
                    type="button"
                    className="stat-tile clickable"
                    onClick={() => irAPaso(3)}
                    title="Paso 3: Atributos totales en el modelo"
                  >
                    <span className="stat-value">{totalAtributos}</span>
                    <span className="stat-label">Atributos</span>
                  </button>
                  <button
                    type="button"
                    className="stat-tile clickable"
                    onClick={() => irAPaso(4)}
                    title="Paso 4: Relaciones del modelo"
                  >
                    <span className="stat-value">{proyecto.modelo.relaciones.length}</span>
                    <span className="stat-label">Relaciones</span>
                  </button>
                  <button
                    type="button"
                    className="stat-tile clickable"
                    onClick={() => irAPaso(3)}
                    title="Paso 3: Confirmación del modelo conceptual"
                  >
                    <span
                      className={`stat-value ${
                        proyecto.modeloConceptualConfirmado ? 'status-online' : 'status-pending'
                      }`}
                    >
                      {proyecto.modeloConceptualConfirmado ? 'Sí' : 'Pend.'}
                    </span>
                    <span className="stat-label">Modelo conf.</span>
                  </button>
                  <button
                    type="button"
                    className="stat-tile clickable"
                    onClick={() => irAPaso(4)}
                    disabled={!puedeIrAPaso(4)}
                    title="Paso 4: Confirmación de relaciones y cardinalidad"
                  >
                    <span
                      className={`stat-value ${
                        proyecto.relacionesConfirmadas ? 'status-online' : 'status-pending'
                      }`}
                    >
                      {proyecto.relacionesConfirmadas ? 'Sí' : 'Pend.'}
                    </span>
                    <span className="stat-label">Rel. conf.</span>
                  </button>
                  <button
                    type="button"
                    className="stat-tile clickable"
                    onClick={() => irAPaso(5)}
                    disabled={!puedeIrAPaso(5)}
                    title="Paso 5: Visualización y confirmación del diagrama ER"
                  >
                    <span
                      className={`stat-value ${
                        proyecto.diagramaConfirmado ? 'status-online' : 'status-pending'
                      }`}
                    >
                      {proyecto.diagramaConfirmado ? 'Sí' : 'Pend.'}
                    </span>
                    <span className="stat-label">Diag. conf.</span>
                  </button>
                  <button
                    type="button"
                    className="stat-tile clickable"
                    onClick={() => irAPaso(6)}
                    disabled={!puedeIrAPaso(6)}
                    title="Paso 6: DDL y motor de base de datos"
                  >
                    <span
                      className={`stat-value ${
                        proyecto.ddlConfirmado ? 'status-online' : 'status-pending'
                      }`}
                    >
                      {proyecto.ddlConfirmado ? 'Sí' : 'Pend.'}
                    </span>
                    <span className="stat-label">DDL conf.</span>
                  </button>
                  <button
                    type="button"
                    className="stat-tile clickable"
                    onClick={() => irAPaso(7)}
                    disabled={!puedeIrAPaso(7)}
                    title="Paso 7: Datos de ejemplo"
                  >
                    <span
                      className={`stat-value ${
                        proyecto.datosConfirmados ? 'status-online' : 'status-pending'
                      }`}
                    >
                      {proyecto.datosConfirmados ? 'Sí' : 'Pend.'}
                    </span>
                    <span className="stat-label">Datos conf.</span>
                  </button>
                  <button
                    type="button"
                    className="stat-tile clickable"
                    onClick={() => irAPaso(7)}
                    disabled={!puedeIrAPaso(7)}
                    title="Paso 7: Estado del motor SQLite WASM en el navegador"
                  >
                    <span
                      className={`stat-value ${
                        proyecto.baseSQLiteGenerada ? 'status-online' : 'status-pending'
                      }`}
                    >
                      {proyecto.baseSQLiteGenerada ? 'Online' : 'Pend.'}
                    </span>
                    <span className="stat-label">SQLite WASM</span>
                  </button>
                  <button
                    type="button"
                    className="stat-tile clickable"
                    onClick={() => irAPaso(8)}
                    disabled={!puedeIrAPaso(8)}
                    title="Paso 8: Cantidad de informes generados"
                  >
                    <span className="stat-value">{proyecto.informes?.length || 0}</span>
                    <span className="stat-label">Informes</span>
                  </button>
                  <button
                    type="button"
                    className="stat-tile clickable"
                    onClick={() => irAPaso(9)}
                    disabled={!puedeIrAPaso(9)}
                    title="Paso 9: Análisis pedagógico estructurado"
                  >
                    <span
                      className={`stat-value ${
                        proyecto.analisisResumido ? 'status-online' : 'status-pending'
                      }`}
                    >
                      {proyecto.analisisResumido ? 'Listo' : 'Pend.'}
                    </span>
                    <span className="stat-label">Análisis</span>
                  </button>
                  <button
                    type="button"
                    className="stat-tile clickable"
                    onClick={() => irAPaso(8)}
                    disabled={!puedeIrAPaso(8)}
                    title="Paso 8: Informes analíticos confirmados"
                  >
                    <span
                      className={`stat-value ${
                        proyecto.informesConfirmados ? 'status-online' : 'status-pending'
                      }`}
                    >
                      {proyecto.informesConfirmados ? 'Sí' : 'Pend.'}
                    </span>
                    <span className="stat-label">Inf. conf.</span>
                  </button>
                </div>
                <div className="storage-pill">
                  <span className="status-dot-online" aria-hidden="true" />
                  <span>
                    {cargadoDesdeIDB
                      ? 'Sincronizado en IndexedDB local'
                      : 'Almacenamiento en memoria'}
                  </span>
                </div>
              </div>

              <section
                className="card decision-log-card"
                aria-labelledby="titulo-bitacora"
                data-testid="decision-log"
              >
                <div className="decision-log-header">
                  <span className="module-tag">Trazabilidad Pedagógica</span>
                  <h2 id="titulo-bitacora" className="sidebar-title">
                    Bitácora de Decisiones ({proyecto.bitacora.length})
                  </h2>
                </div>
                {proyecto.bitacora.length === 0 ? (
                  <p className="form-help">
                    Aquí se registran en vivo tus respuestas, supuestos aceptados/rechazados y
                    ediciones manuales del modelo.
                  </p>
                ) : (
                  <ul className="decision-log-list" data-testid="decision-log-list">
                    {proyecto.bitacora.map((dec, idx) => (
                      <li key={idx} className="decision-log-item">
                        <div className="decision-badges-row">
                          <span className="decision-step-badge">Paso {dec.paso}</span>
                          <span className={`decision-origin-badge origin-${dec.origen}`}>
                            {dec.origen === 'estudiante'
                              ? 'Estudiante'
                              : dec.origen === 'ia_aceptada'
                                ? 'IA aceptada'
                                : 'IA rechazada'}
                          </span>
                        </div>
                        <p className="decision-desc">{dec.descripcion}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </aside>
          </div>
        )}
      </main>

      {/* Modal accesible del Glosario de Bases de Datos */}
      <GlossaryModal
        abierto={mostrarGlosario}
        onCerrar={() => setMostrarGlosario(false)}
        proyecto={proyecto}
      />
    </div>
  );
}
