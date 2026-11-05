import { useEffect, useId, useMemo, useState } from 'react';
import {
  ConjuntoDatosEjemplo,
  Informe,
  Modelo,
  MotorBaseDatos,
  ResultadoInforme,
  TipoGraficoInforme,
} from '../core/schemas';
import {
  ejecutarConsultaInforme,
  generarPropuestaInformeLocal,
  validarYNormalizarConsultaSelect,
} from '../core/reports';
import { generarDDLSQLite } from '../core/ddl/sqlite';
import {
  generarDatosEjemploLocales,
  generarInsertStatementsSQLite,
  sanitizarValorCSV,
} from '../core/sampleData';
import { sqliteClient } from '../core/workers/sqliteClient';
import { descargarArchivo } from '../export/svg';
import { ChartVisualizer, DatoGrafico } from './ChartVisualizer';

export interface Step8InformesProps {
  modelo: Modelo;
  motorSeleccionado?: MotorBaseDatos;
  ddlGenerado?: string;
  datosEjemplo?: ConjuntoDatosEjemplo;
  baseSQLiteGenerada?: boolean;
  informes: Informe[];
  informesConfirmados: boolean;
  cargandoIA?: boolean;
  onGenerarInformeConIA: (pedido: string) => Promise<Informe>;
  onGuardarOActualizarInforme: (informe: Informe) => void;
  onEliminarInforme?: (id: string) => void;
  onConfirmarInformes: () => void;
  onVolverPaso7: () => void;
  onBaseSQLiteInicializada?: () => void;
  onRegistrarDecision?: (
    descripcion: string,
    origen: 'estudiante' | 'ia_aceptada' | 'ia_rechazada'
  ) => void;
}

const EJEMPLOS_CONSULTAS_GENERICAS = [
  '¿Cuántos registros hay en cada categoría o grupo principal?',
  'Listar todos los datos combinados con sus entidades relacionadas (usando JOIN).',
  'Obtener los 5 registros más recientes o de mayor valor ordenados de forma descendente.',
  'Calcular totales y promedios agrupados con funciones de agregación (COUNT, SUM, AVG).',
];

/**
 * Genera sugerencias de consultas en lenguaje natural a partir del modelo confirmado,
 * para que el estudiante vea preguntas concretas sobre SUS tablas y relaciones.
 */
export function generarSugerenciasDesdeModelo(modelo: Modelo): string[] {
  const sugerencias: string[] = [];
  for (const rel of modelo.relaciones.slice(0, 2)) {
    if (rel.cardinalidad === '1:N') {
      sugerencias.push(`¿Cuántos registros de ${rel.destino} tiene cada ${rel.origen}?`);
      sugerencias.push(`Listar cada ${rel.destino} junto con los datos de su ${rel.origen} (JOIN).`);
    } else if (rel.cardinalidad === 'N:M') {
      sugerencias.push(`¿Qué ${rel.destino} están vinculados con cada ${rel.origen}?`);
    }
  }
  const entidadConNumero = modelo.entidades.find((e) =>
    e.atributos.some((a) => !a.esClavePrimaria && (a.tipoConceptual === 'decimal' || a.tipoConceptual === 'entero'))
  );
  if (entidadConNumero) {
    const atr = entidadConNumero.atributos.find(
      (a) => !a.esClavePrimaria && (a.tipoConceptual === 'decimal' || a.tipoConceptual === 'entero')
    );
    if (atr) {
      sugerencias.push(`Los 5 ${entidadConNumero.nombre} con mayor ${atr.nombre}, de mayor a menor.`);
    }
  }
  const entidadConFecha = modelo.entidades.find((e) =>
    e.atributos.some((a) => a.tipoConceptual === 'fecha' || a.tipoConceptual === 'fecha_hora')
  );
  if (entidadConFecha) {
    sugerencias.push(`Los ${entidadConFecha.nombre} más recientes ordenados por fecha.`);
  }
  const unicas = Array.from(new Set(sugerencias)).slice(0, 4);
  return unicas.length > 0 ? unicas : EJEMPLOS_CONSULTAS_GENERICAS;
}

/**
 * Convierte un informe en un documento Markdown explicativo (pedido, SQL, explicación y resumen del resultado).
 */
export function informeAMarkdown(informe: Informe): string {
  const lineas = [
    `# ${informe.titulo}`,
    '',
    `**Pedido en lenguaje natural:** ${informe.pedidoLenguajeNatural}`,
    '',
    '## Consulta SQL',
    '',
    '```sql',
    informe.consultaSQL,
    '```',
    '',
    '## Explicación paso a paso',
    '',
    informe.explicacionPasoAPaso,
    '',
  ];
  if (informe.resultado) {
    lineas.push(
      '## Resultado',
      '',
      `Filas devueltas: ${informe.resultado.totalFilas} (en ${informe.resultado.tiempoMs} ms).`,
      ''
    );
    if (informe.resultado.columnas.length > 0 && informe.resultado.filas.length > 0) {
      const escapar = (v: unknown) =>
        v === null || v === undefined ? 'NULL' : String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
      lineas.push(`| ${informe.resultado.columnas.map(escapar).join(' | ')} |`);
      lineas.push(`| ${informe.resultado.columnas.map(() => '---').join(' | ')} |`);
      for (const fila of informe.resultado.filas.slice(0, 20)) {
        lineas.push(`| ${fila.map(escapar).join(' | ')} |`);
      }
      lineas.push('');
    }
  }
  return lineas.join('\n');
}

export function Step8Informes({
  modelo,
  motorSeleccionado = 'sqlite',
  ddlGenerado,
  datosEjemplo,
  baseSQLiteGenerada = true,
  informes,
  informesConfirmados,
  cargandoIA = false,
  onGenerarInformeConIA,
  onGuardarOActualizarInforme,
  onEliminarInforme,
  onConfirmarInformes,
  onVolverPaso7,
  onBaseSQLiteInicializada,
  onRegistrarDecision,
}: Step8InformesProps) {
  const EJEMPLOS_CONSULTAS_SUGERIDAS = useMemo(() => generarSugerenciasDesdeModelo(modelo), [modelo]);
  const titleId = useId();

  const [pedidoTexto, setPedidoTexto] = useState('');
  const [informeSeleccionadoId, setInformeSeleccionadoId] = useState<string>('');
  const [sqlEditado, setSqlEditado] = useState('');
  const [ejecutandoSQL, setEjecutandoSQL] = useState(false);
  const [errorEjecucion, setErrorEjecucion] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  // Seleccionar automáticamente el informe activo o el más reciente
  const informeActivo: Informe | undefined = useMemo(() => {
    if (informes.length === 0) return undefined;
    return informes.find((inf) => inf.id === informeSeleccionadoId) ?? informes[informes.length - 1];
  }, [informes, informeSeleccionadoId]);

  // Sincronizar el editor SQL local con el informe seleccionado
  useEffect(() => {
    if (informeActivo) {
      setSqlEditado(informeActivo.consultaSQL);
      setErrorEjecucion(null);
    }
  }, [informeActivo?.id]);

  // Validación AST en tiempo real de la consulta SQL actual
  const validacionAST = useMemo(() => {
    if (!sqlEditado.trim()) return { valido: false, error: 'Ingresá una consulta SQL.' };
    return validarYNormalizarConsultaSelect(sqlEditado);
  }, [sqlEditado]);

  // Asegura que las tablas y los datos de prueba existan en la base SQLite en memoria (Web Worker)
  const asegurarSQLiteInicializado = async (): Promise<void> => {
    try {
      await sqliteClient.inicializar();
      const tablas = await sqliteClient.obtenerResumenTablas();
      const sinTablas = tablas.length === 0;
      const sinFilas = tablas.every((t) => t.totalFilas === 0);
      if (!baseSQLiteGenerada || sinTablas || sinFilas) {
        const ddl = ddlGenerado || generarDDLSQLite(modelo);
        if (ddl && ddl.trim()) {
          await sqliteClient.ejecutarDDL(ddl);
          const datosAPoblar =
            datosEjemplo && datosEjemplo.tablas.length > 0
              ? datosEjemplo
              : generarDatosEjemploLocales(modelo, 3);
          const inserts = generarInsertStatementsSQLite(datosAPoblar);
          if (inserts.length > 0) {
            await sqliteClient.insertarDatos(inserts);
          }
        }
      }
      onBaseSQLiteInicializada?.();
    } catch (err) {
      console.warn('Auto-inicialización de SQLite en informes:', err);
      // Fallback robusto: si falló la verificación de tablas, forzar DDL e inserts directamente
      try {
        const ddl = ddlGenerado || generarDDLSQLite(modelo);
        if (ddl && ddl.trim()) {
          await sqliteClient.ejecutarDDL(ddl);
          const datosAPoblar =
            datosEjemplo && datosEjemplo.tablas.length > 0
              ? datosEjemplo
              : generarDatosEjemploLocales(modelo, 3);
          const inserts = generarInsertStatementsSQLite(datosAPoblar);
          if (inserts.length > 0) {
            await sqliteClient.insertarDatos(inserts);
          }
        }
        onBaseSQLiteInicializada?.();
      } catch (innerErr) {
        console.error('Error al forzar inicialización DDL en SQLite:', innerErr);
      }
    }
  };

  // Al montar o cambiar de informe sin resultados, inicializar SQLite y ejecutar automáticamente
  useEffect(() => {
    let montado = true;
    void (async () => {
      await asegurarSQLiteInicializado();
      if (!montado) return;
      if (
        informeActivo &&
        !informeActivo.resultado &&
        validacionAST.valido &&
        validacionAST.sqlNormalizado
      ) {
        try {
          const res = await ejecutarConsultaInforme(validacionAST.sqlNormalizado);
          if (montado) {
            onGuardarOActualizarInforme({
              ...informeActivo,
              resultado: res,
            });
          }
        } catch {
          // Reintentar forzando inicialización completa de DDL y datos de prueba
          try {
            const ddl = ddlGenerado || generarDDLSQLite(modelo);
            if (ddl && ddl.trim()) {
              await sqliteClient.ejecutarDDL(ddl);
              const datosAPoblar =
                datosEjemplo && datosEjemplo.tablas.length > 0
                  ? datosEjemplo
                  : generarDatosEjemploLocales(modelo, 3);
              const inserts = generarInsertStatementsSQLite(datosAPoblar);
              if (inserts.length > 0) {
                await sqliteClient.insertarDatos(inserts);
              }
              const res = await ejecutarConsultaInforme(validacionAST.sqlNormalizado);
              if (montado) {
                onGuardarOActualizarInforme({
                  ...informeActivo,
                  resultado: res,
                });
              }
            }
          } catch {
            // Silencioso al montar
          }
        }
      }
    })();
    return () => {
      montado = false;
    };
  }, [ddlGenerado, datosEjemplo, informeActivo?.id]);

  // Preparar datos numéricos para el gráfico SVG
  const datosParaGrafico: DatoGrafico[] = useMemo(() => {
    if (!informeActivo?.resultado || !informeActivo.resultado.filas.length) return [];
    const res = informeActivo.resultado;

    const colEtiquetas = informeActivo.columnaEtiquetas || res.columnas[0] || 'Etiqueta';
    const colValores = informeActivo.columnaValores || res.columnas[1] || res.columnas[0];

    const idxEtiqueta = res.columnas.indexOf(colEtiquetas);
    const idxValor = res.columnas.indexOf(colValores);

    if (idxEtiqueta === -1 || idxValor === -1) {
      // Intentar buscar la primera columna numérica
      const primerIdxNum = res.columnas.findIndex((_, cIdx) =>
        res.filas.some((f) => typeof f[cIdx] === 'number')
      );
      if (primerIdxNum === -1) return [];

      return res.filas.map((f, rIdx) => ({
        etiqueta: String(f[0] ?? `Fila ${rIdx + 1}`),
        valor: Number(f[primerIdxNum]) || 0,
      }));
    }

    return res.filas.map((f) => ({
      etiqueta: String(f[idxEtiqueta] ?? ''),
      valor: Number(f[idxValor]) || 0,
    }));
  }, [informeActivo?.resultado, informeActivo?.columnaEtiquetas, informeActivo?.columnaValores]);

  // Generar consulta local rápida sin depender de IA
  const handleGenerarLocal = async (texto?: string) => {
    const solicitud = (texto ?? pedidoTexto).trim();
    if (!solicitud) return;

    setErrorEjecucion(null);
    try {
      await asegurarSQLiteInicializado();
      const propuesta = generarPropuestaInformeLocal(modelo, solicitud);
      const nuevoInforme: Informe = {
        id: `informe_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        titulo: propuesta.titulo,
        pedidoLenguajeNatural: solicitud,
        consultaSQL: propuesta.consultaSQL,
        explicacionPasoAPaso: propuesta.explicacionPasoAPaso,
        tipoGrafico: propuesta.tipoGraficoSugerido,
        columnaEtiquetas: propuesta.columnaEtiquetas,
        columnaValores: propuesta.columnaValores,
        fechaCreacion: new Date().toISOString(),
      };

      let resultado: ResultadoInforme | undefined;
      try {
        resultado = await ejecutarConsultaInforme(nuevoInforme.consultaSQL);
      } catch {
        const ddl = ddlGenerado || generarDDLSQLite(modelo);
        if (ddl && ddl.trim()) {
          await sqliteClient.ejecutarDDL(ddl);
          const datosAPoblar =
            datosEjemplo && datosEjemplo.tablas.length > 0
              ? datosEjemplo
              : generarDatosEjemploLocales(modelo, 3);
          const inserts = generarInsertStatementsSQLite(datosAPoblar);
          if (inserts.length > 0) {
            await sqliteClient.insertarDatos(inserts);
          }
        }
        try {
          resultado = await ejecutarConsultaInforme(nuevoInforme.consultaSQL);
        } catch (innerErr) {
          console.warn('Consulta local ejecutada con resultado parcial:', innerErr);
        }
      }

      onGuardarOActualizarInforme({
        ...nuevoInforme,
        resultado,
      });
      setInformeSeleccionadoId(nuevoInforme.id);
      setPedidoTexto('');
      onRegistrarDecision?.(
        `Generó consulta SQL local para: "${nuevoInforme.titulo}".`,
        'estudiante'
      );
    } catch (err) {
      setErrorEjecucion(
        err instanceof Error ? err.message : 'Error al generar la consulta SQL local.'
      );
    }
  };

  // Generar consulta desde lenguaje natural
  const handleGenerarDesdeNL = async (texto: string) => {
    const solicitud = texto.trim() || pedidoTexto.trim();
    if (!solicitud) return;

    setErrorEjecucion(null);
    try {
      await asegurarSQLiteInicializado();
      let nuevoInforme: Informe;
      try {
        nuevoInforme = await onGenerarInformeConIA(solicitud);
      } catch (iaErr) {
        console.warn('Tutor IA no disponible, recurriendo a consulta SQL local:', iaErr);
        const propuestaLocal = generarPropuestaInformeLocal(modelo, solicitud);
        nuevoInforme = {
          id: `informe_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          titulo: propuestaLocal.titulo,
          pedidoLenguajeNatural: solicitud,
          consultaSQL: propuestaLocal.consultaSQL,
          explicacionPasoAPaso: propuestaLocal.explicacionPasoAPaso,
          tipoGrafico: propuestaLocal.tipoGraficoSugerido,
          columnaEtiquetas: propuestaLocal.columnaEtiquetas,
          columnaValores: propuestaLocal.columnaValores,
          fechaCreacion: new Date().toISOString(),
        };
      }
      setInformeSeleccionadoId(nuevoInforme.id);
      setPedidoTexto('');

      // Ejecutar automáticamente la consulta en la base SQLite para mostrar resultados de inmediato
      try {
        await asegurarSQLiteInicializado();
        let resultado: ResultadoInforme;
        try {
          resultado = await ejecutarConsultaInforme(nuevoInforme.consultaSQL);
        } catch {
          // Reintentar asegurando DDL y datos
          const ddl = ddlGenerado || generarDDLSQLite(modelo);
          if (ddl && ddl.trim()) {
            await sqliteClient.ejecutarDDL(ddl);
            const datosAPoblar =
              datosEjemplo && datosEjemplo.tablas.length > 0
                ? datosEjemplo
                : generarDatosEjemploLocales(modelo, 3);
            const inserts = generarInsertStatementsSQLite(datosAPoblar);
            if (inserts.length > 0) {
              await sqliteClient.insertarDatos(inserts);
            }
          }
          resultado = await ejecutarConsultaInforme(nuevoInforme.consultaSQL);
        }
        onGuardarOActualizarInforme({
          ...nuevoInforme,
          resultado,
        });
      } catch (execErr) {
        // Si la consulta de la IA referenció una columna inexistente, usamos el generador local exacto sobre el modelo
        try {
          const respaldoLocal = generarPropuestaInformeLocal(modelo, solicitud);
          const resultadoRespaldo = await ejecutarConsultaInforme(respaldoLocal.consultaSQL);
          onGuardarOActualizarInforme({
            ...nuevoInforme,
            titulo: nuevoInforme.titulo || respaldoLocal.titulo,
            consultaSQL: respaldoLocal.consultaSQL,
            explicacionPasoAPaso: respaldoLocal.explicacionPasoAPaso,
            tipoGrafico: respaldoLocal.tipoGraficoSugerido,
            columnaEtiquetas: respaldoLocal.columnaEtiquetas,
            columnaValores: respaldoLocal.columnaValores,
            resultado: resultadoRespaldo,
          });
        } catch {
          onGuardarOActualizarInforme(nuevoInforme);
          setErrorEjecucion(
            execErr instanceof Error ? execErr.message : 'Error al ejecutar la consulta generada.'
          );
        }
      }

      onRegistrarDecision?.(
        `Generó informe "${nuevoInforme.titulo}" a partir de: "${solicitud}".`,
        'ia_aceptada'
      );
    } catch (err) {
      setErrorEjecucion(
        err instanceof Error ? err.message : 'Error al consultar al tutor IA sobre el informe.'
      );
    }
  };

  // Re-ejecutar la consulta actual (manual o editada por el estudiante)
  const handleEjecutarConsulta = async () => {
    if (!informeActivo || !validacionAST.valido || !validacionAST.sqlNormalizado) return;

    setEjecutandoSQL(true);
    setErrorEjecucion(null);

    try {
      await asegurarSQLiteInicializado();
      let res: ResultadoInforme;
      try {
        res = await ejecutarConsultaInforme(validacionAST.sqlNormalizado);
      } catch (firstErr) {
        // Si falló por falta de inicialización o tabla faltante, forzamos DDL y datos y reintentamos
        const ddl = ddlGenerado || generarDDLSQLite(modelo);
        if (ddl && ddl.trim()) {
          await sqliteClient.ejecutarDDL(ddl);
          const datosAPoblar =
            datosEjemplo && datosEjemplo.tablas.length > 0
              ? datosEjemplo
              : generarDatosEjemploLocales(modelo, 3);
          const inserts = generarInsertStatementsSQLite(datosAPoblar);
          if (inserts.length > 0) {
            await sqliteClient.insertarDatos(inserts);
          }
          res = await ejecutarConsultaInforme(validacionAST.sqlNormalizado);
        } else {
          throw firstErr;
        }
      }

      const informeActualizado: Informe = {
        ...informeActivo,
        consultaSQL: validacionAST.sqlNormalizado,
        resultado: res,
      };
      onGuardarOActualizarInforme(informeActualizado);
      onRegistrarDecision?.(
        `Ejecutó consulta SELECT personalizada en SQLite (${res.totalFilas} filas obtenidas en ${res.tiempoMs} ms).`,
        'estudiante'
      );
    } catch (err) {
      setErrorEjecucion(err instanceof Error ? err.message : 'Error al ejecutar la consulta SQL.');
    } finally {
      setEjecutandoSQL(false);
    }
  };

  // Copiar SQL
  const handleCopiarSQL = async () => {
    try {
      await navigator.clipboard.writeText(sqlEditado);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
      onRegistrarDecision?.('Copió la consulta SQL del informe al portapapeles.', 'estudiante');
    } catch {
      setCopiado(false);
    }
  };

  // Descargar explicación Markdown del informe
  const handleDescargarMarkdown = () => {
    if (!informeActivo) return;
    descargarArchivo(
      informeAMarkdown({ ...informeActivo, consultaSQL: sqlEditado || informeActivo.consultaSQL }),
      `informe_${informeActivo.titulo.toLowerCase().replace(/[^a-z0-9_-]+/g, '_')}.md`,
      'text/markdown;charset=utf-8;'
    );
    onRegistrarDecision?.(
      `Descargó la explicación Markdown del informe "${informeActivo.titulo}".`,
      'estudiante'
    );
  };

  // Eliminar informe activo (con confirmación)
  const handleEliminarInforme = () => {
    if (!informeActivo || !onEliminarInforme) return;
    const confirmado =
      typeof window === 'undefined' || typeof window.confirm !== 'function'
        ? true
        : window.confirm(`¿Eliminar el informe "${informeActivo.titulo}"?`);
    if (!confirmado) return;
    const titulo = informeActivo.titulo;
    onEliminarInforme(informeActivo.id);
    setInformeSeleccionadoId('');
    setErrorEjecucion(null);
    onRegistrarDecision?.(`Eliminó el informe "${titulo}".`, 'estudiante');
  };

  const usaDatosDeRespaldo = !datosEjemplo || datosEjemplo.tablas.length === 0;

  // Descargar SQL
  const handleDescargarSQL = () => {
    if (!informeActivo) return;
    descargarArchivo(
      sqlEditado,
      `informe_${informeActivo.titulo.toLowerCase().replace(/\s+/g, '_')}.sql`,
      'application/sql'
    );
    onRegistrarDecision?.(
      `Descargó archivo SQL del informe "${informeActivo.titulo}".`,
      'estudiante'
    );
  };

  // Descargar resultados CSV
  const handleDescargarCSVResultados = (resultado: ResultadoInforme) => {
    if (!informeActivo) return;
    const encabezados = resultado.columnas.map(sanitizarValorCSV).join(',');
    const filasCSV = resultado.filas.map((fila) =>
      fila.map((val) => sanitizarValorCSV(val)).join(',')
    );
    const contenido = [encabezados, ...filasCSV].join('\n');

    descargarArchivo(
      contenido,
      `resultado_${informeActivo.titulo.toLowerCase().replace(/\s+/g, '_')}.csv`,
      'text/csv;charset=utf-8;'
    );
    onRegistrarDecision?.(
      `Descargó CSV de resultados del informe "${informeActivo.titulo}".`,
      'estudiante'
    );
  };

  return (
    <section
      className="card studio-step-card"
      aria-labelledby={titleId}
      data-testid="step8-container"
    >
      {/* Encabezado Unificado del Paso */}
      <div className="step-header">
        <span className="step-badge">Paso 8 de 8</span>
        <div>
          <h2 id={titleId} className="card-title">
            8. Informes Personalizados y Consultas SELECT
          </h2>
          <p className="step-lead">
            Hacé preguntas en lenguaje natural sobre los datos de tu base. El tutor IA las traduce
            a consultas <code>SELECT</code> seguras y explicadas paso a paso, con visualización en
            tablas y gráficos.
          </p>
        </div>
      </div>

      {/* Caja Conceptual Pedagógica */}
      <details className="concept-box" data-testid="step8-concept-box">
        <summary className="concept-summary">
          💡 Explicación breve del concepto: ¿Cómo responde SQL a las preguntas del negocio?
        </summary>
        <div className="concept-content">
          <p>
            <strong>La anatomía de una consulta SELECT:</strong> Una base de datos relacional almacena
            datos estructurados; la sentencia <code>SELECT</code> es el lenguaje mediante el cual
            extraemos respuestas y conocimientos:
          </p>
          <ul>
            <li>
              <code>SELECT ... FROM ...</code>: Qué columnas queremos ver y de qué tabla base.
            </li>
            <li>
              <code>JOIN ... ON ...</code>: Vincula filas de dos tablas usando su relación de clave
              primaria y clave foránea (ej. un libro con su autor).
            </li>
            <li>
              <code>WHERE ...</code>: Filtra las filas que cumplen una condición lógica antes de
              procesar.
            </li>
            <li>
              <code>GROUP BY ...</code>: Agrupa registros idénticos en una categoría para calcular
              métricas agregadas (<code>COUNT</code>, <code>SUM</code>, <code>AVG</code>).
            </li>
            <li>
              <code>ORDER BY ... LIMIT ...</code>: Ordena los resultados (ascendente o descendente)
              y limita la cantidad devuelta para optimizar rendimiento y consumo de memoria.
            </li>
            <li>
              <strong>Seguridad en Informes (Whitelist estricto):</strong> Por diseño, esta pantalla
              rechaza cualquier sentencia de modificación (<code>DROP</code>, <code>INSERT</code>,{' '}
              <code>UPDATE</code>, <code>DELETE</code> o <code>ALTER</code>). Solo se permite
              lectura pura para garantizar que los datos permanezcan íntegros.
            </li>
          </ul>
        </div>
      </details>

      {/* Aviso pedagógico cuando el motor de diseño del proyecto no es SQLite */}
      {motorSeleccionado && motorSeleccionado !== 'sqlite' && (
        <div
          role="note"
          className="alert"
          style={{
            background: 'rgba(56, 189, 248, 0.08)',
            border: '1px solid rgba(56, 189, 248, 0.35)',
            color: 'var(--text-main)',
            borderRadius: '0.65rem',
            padding: '0.75rem 1rem',
            marginBottom: '1.25rem',
            fontSize: '0.85rem',
          }}
          data-testid="aviso-motor-destino"
        >
          💡 <strong>Motor de diseño: {motorSeleccionado.toUpperCase()}</strong>.
          Para que puedas explorar consultas analíticas y visualizar gráficos en tiempo real 100% en
          tu navegador sin requerir un servidor externo de {motorSeleccionado.toUpperCase()}, las consultas se
          procesan en el motor SQL relacional integrado en el cliente (WebAssembly). El esquema DDL original de{' '}
          {motorSeleccionado.toUpperCase()} se preserva completamente y está listo en los entregables finales.
        </div>
      )}

      {/* Aviso cuando todavía no se generaron datos de ejemplo en el Paso 7 */}
      {usaDatosDeRespaldo && (
        <div
          role="note"
          className="alert"
          style={{
            background: 'var(--bg-warning)',
            border: '1px solid var(--border-warning)',
            color: 'var(--text-warning)',
            borderRadius: '0.65rem',
            padding: '0.75rem 1rem',
            marginBottom: '1.25rem',
            fontSize: '0.85rem',
          }}
          data-testid="aviso-datos-respaldo"
        >
          ⚠️ Todavía no generaste datos de ejemplo en el Paso 7. Los informes se ejecutan sobre 3
          filas automáticas por tabla para que puedas practicar; volvé al Paso 7 para obtener datos
          más realistas.
        </div>
      )}

      {/* Entrada de Solicitud en Lenguaje Natural */}
      <div
        className="prompt-input-card"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          borderRadius: '0.75rem',
          padding: '1.25rem',
          marginBottom: '1.25rem',
        }}
      >
        <label htmlFor="prompt-informe-input" className="form-label" style={{ fontWeight: 700 }}>
          ¿Qué te gustaría averiguar o consultar de esta base de datos?
        </label>
        <textarea
          id="prompt-informe-input"
          className="form-control"
          rows={3}
          placeholder="Ej: Quiero ver cuántos libros escribió cada autor, ordenados del que más tiene al que menos..."
          value={pedidoTexto}
          onChange={(e) => setPedidoTexto(e.target.value)}
          disabled={cargandoIA || ejecutandoSQL}
          data-testid="prompt-informe-textarea"
        />

        {/* Sugerencias Rápidas */}
        <div style={{ marginTop: '0.65rem', display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Sugerencias:</span>
          {EJEMPLOS_CONSULTAS_SUGERIDAS.map((ej, idx) => (
            <button
              key={idx}
              type="button"
              className="btn btn-secondary btn-xs"
              style={{ fontSize: '0.74rem' }}
              onClick={() => {
                setPedidoTexto(ej);
                void handleGenerarDesdeNL(ej);
              }}
              disabled={cargandoIA || ejecutandoSQL}
            >
              💡 {ej}
            </button>
          ))}
        </div>

        <div style={{ marginTop: '0.85rem', display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleGenerarLocal(pedidoTexto)}
            disabled={!pedidoTexto.trim() || cargandoIA || ejecutandoSQL}
            data-testid="btn-generar-informe-local"
          >
            ⚡ Consulta Rápida (Local / sin IA)
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handleGenerarDesdeNL(pedidoTexto)}
            disabled={!pedidoTexto.trim() || cargandoIA || ejecutandoSQL}
            data-testid="btn-generar-informe-ia"
          >
            {cargandoIA ? '⏳ Analizando y generando SQL con Tutor IA...' : '🔍 Generar Informe con Tutor IA'}
          </button>
        </div>
      </div>

      {/* Error de ejecución visible aun si todavía no hay un informe activo */}
      {errorEjecucion && !informeActivo && (
        <div role="alert" className="alert alert-error" style={{ marginBottom: '1.25rem' }}>
          {errorEjecucion}
        </div>
      )}

      {/* Selector de Informes Guardados (Pestañas) */}
      {informes.length > 0 && (
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#93c5fd' }}>
              Informes generados ({informes.length}):
            </span>
            {informes.map((inf) => {
              const esActivo = inf.id === informeActivo?.id;
              return (
                <button
                  key={inf.id}
                  type="button"
                  className={`btn btn-xs ${esActivo ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ borderRadius: '0.4rem', padding: '0.35rem 0.65rem' }}
                  onClick={() => setInformeSeleccionadoId(inf.id)}
                  data-testid={`tab-informe-${inf.id}`}
                >
                  📄 {inf.titulo}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Visor y Editor de la Consulta SQL Activa */}
      {informeActivo && (
        <div
          className="active-report-block"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: '0.75rem',
            padding: '1.25rem',
            marginBottom: '1.25rem',
          }}
          data-testid="active-report-container"
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.75rem',
              marginBottom: '0.75rem',
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#f1f5f9' }}>
                {informeActivo.titulo}
              </h3>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Pedido: <em>&ldquo;{informeActivo.pedidoLenguajeNatural}&rdquo;</em>
              </p>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={handleCopiarSQL}
                data-testid="btn-copiar-sql"
              >
                {copiado ? '✓ Copiado' : '📋 Copiar SQL'}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={handleDescargarSQL}
                data-testid="btn-descargar-sql"
              >
                📥 Descargar .sql
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={handleDescargarMarkdown}
                data-testid="btn-descargar-md"
              >
                📝 Explicación .md
              </button>
              {onEliminarInforme && (
                <button
                  type="button"
                  className="btn btn-danger btn-xs"
                  onClick={handleEliminarInforme}
                  data-testid="btn-eliminar-informe"
                >
                  🗑️ Eliminar
                </button>
              )}
            </div>
          </div>

          {/* Validación AST y Botón de Ejecutar */}
          <div style={{ marginBottom: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            {validacionAST.valido ? (
              <span
                className="badge"
                style={{
                  background: 'rgba(16, 185, 129, 0.15)',
                  color: '#6ee7b7',
                  padding: '0.25rem 0.6rem',
                  borderRadius: '0.3rem',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                }}
                data-testid="ast-sql-valid"
              >
                ✓ Consulta SELECT validada por parser AST (Segura)
              </span>
            ) : (
              <span
                className="badge"
                style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: '#fca5a5',
                  padding: '0.25rem 0.6rem',
                  borderRadius: '0.3rem',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                }}
                data-testid="ast-sql-error"
              >
                ⚠️ {validacionAST.error}
              </span>
            )}
          </div>

          {/* Editor de Código SQL */}
          <div
            style={{
              background: '#090e1c',
              border: '1px solid var(--border-color)',
              borderRadius: '0.5rem',
              padding: '0.75rem',
              marginBottom: '0.85rem',
            }}
          >
            <textarea
              className="form-control"
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: '0.85rem',
                background: 'transparent',
                border: 'none',
                color: '#38bdf8',
                width: '100%',
                resize: 'vertical',
                minHeight: '85px',
              }}
              value={sqlEditado}
              onChange={(e) => setSqlEditado(e.target.value)}
              data-testid="sql-editor-textarea"
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleEjecutarConsulta}
              disabled={!validacionAST.valido || ejecutandoSQL}
              data-testid="btn-ejecutar-sql"
            >
              {ejecutandoSQL ? '⚙️ Ejecutando consulta...' : '▶️ Ejecutar Consulta'}
            </button>
          </div>

          {/* Error de ejecución si ocurrió */}
          {errorEjecucion && (
            <div role="alert" className="alert alert-error" style={{ marginBottom: '1rem' }}>
              {errorEjecucion}
            </div>
          )}

          {/* Explicación didáctica paso a paso de la consulta */}
          <div className="tutor-explanation-box" style={{ marginBottom: '1.25rem' }} data-testid="tutor-sql-explanation">
            <strong>Explicación paso a paso del Tutor IA:</strong>
            <p style={{ whiteSpace: 'pre-line' }}>{informeActivo.explicacionPasoAPaso}</p>
          </div>

          {/* Aviso didáctico si la consulta aún no tiene resultados calculados */}
          {!informeActivo.resultado && (
            <div
              style={{
                background: 'rgba(56, 189, 248, 0.08)',
                border: '1px dashed rgba(56, 189, 248, 0.35)',
                borderRadius: '0.65rem',
                padding: '1.25rem',
                marginBottom: '1.25rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '0.85rem',
              }}
              data-testid="informe-pending-execution-hint"
            >
              <div>
                <strong style={{ display: 'block', color: '#93c5fd', fontSize: '0.9rem', marginBottom: '0.2rem' }}>
                  ⚡ Consulta lista para procesar en el motor local
                </strong>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Hacé clic en &ldquo;Ejecutar Consulta&rdquo; para procesar las tablas y desplegar la grilla con los datos y el gráfico interactivo.
                </span>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleEjecutarConsulta}
                disabled={!validacionAST.valido || ejecutandoSQL}
              >
                {ejecutandoSQL ? '⚙️ Procesando...' : '▶️ Ejecutar ahora'}
              </button>
            </div>
          )}

          {/* Tabla de Resultados de la Consulta */}
          {informeActivo.resultado && (
            <div style={{ marginBottom: '1.25rem' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                  marginBottom: '0.65rem',
                }}
              >
                <div style={{ fontSize: '0.86rem', color: '#cbd5e1' }}>
                  📊 <strong>Resultado:</strong> {informeActivo.resultado.totalFilas} filas devueltas en{' '}
                  <code style={{ color: '#6ee7b7' }}>{informeActivo.resultado.tiempoMs} ms</code>
                </div>

                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={() => handleDescargarCSVResultados(informeActivo.resultado!)}
                  data-testid="btn-descargar-csv-resultado"
                >
                  📥 Descargar Resultado (.csv)
                </button>
              </div>

              {informeActivo.resultado.filas.length > 0 ? (
                <div className="table-responsive" style={{ maxHeight: '280px', overflowY: 'auto' }}>
                  <table className="model-table" data-testid="report-result-table">
                    <thead>
                      <tr>
                        {informeActivo.resultado.columnas.map((col) => (
                          <th key={col}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {informeActivo.resultado.filas.map((fila, rIdx) => (
                        <tr key={rIdx}>
                          {fila.map((val, cIdx) => (
                            <td key={cIdx} style={{ fontSize: '0.82rem' }}>
                              {val === null || val === undefined ? (
                                <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                  NULL
                                </span>
                              ) : (
                                String(val)
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="form-help">La consulta se ejecutó con éxito pero no devolvió filas.</p>
              )}
            </div>
          )}

          {/* Gráfico Opcional del Informe */}
          {informeActivo.resultado && (
            <div style={{ marginTop: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                <label htmlFor="select-tipo-grafico" className="form-label-sm" style={{ margin: 0 }}>
                  Tipo de gráfico:
                </label>
                <select
                  id="select-tipo-grafico"
                  className="form-control"
                  style={{ width: 'auto', minWidth: '140px' }}
                  value={informeActivo.tipoGrafico}
                  onChange={(e) =>
                    onGuardarOActualizarInforme({
                      ...informeActivo,
                      tipoGrafico: e.target.value as TipoGraficoInforme,
                    })
                  }
                  data-testid="select-chart-type"
                >
                  <option value="ninguno">Sin gráfico</option>
                  <option value="barras">📊 Gráfico de Barras</option>
                  <option value="torta">🥧 Gráfico de Torta / Donut</option>
                  <option value="lineas">📈 Gráfico de Líneas</option>
                </select>

                {informeActivo.tipoGrafico !== 'ninguno' && informeActivo.resultado.columnas.length > 1 && (
                  <>
                    <label htmlFor="select-col-etiqueta" className="form-label-sm" style={{ margin: 0 }}>
                      Categoría (Eje X):
                    </label>
                    <select
                      id="select-col-etiqueta"
                      className="form-control"
                      style={{ width: 'auto', minWidth: '130px' }}
                      value={informeActivo.columnaEtiquetas || informeActivo.resultado.columnas[0]}
                      onChange={(e) =>
                        onGuardarOActualizarInforme({
                          ...informeActivo,
                          columnaEtiquetas: e.target.value,
                        })
                      }
                      data-testid="select-chart-label-col"
                    >
                      {informeActivo.resultado.columnas.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>

                    <label htmlFor="select-col-valor" className="form-label-sm" style={{ margin: 0 }}>
                      Valor numérico (Eje Y):
                    </label>
                    <select
                      id="select-col-valor"
                      className="form-control"
                      style={{ width: 'auto', minWidth: '130px' }}
                      value={informeActivo.columnaValores || informeActivo.resultado.columnas[1]}
                      onChange={(e) =>
                        onGuardarOActualizarInforme({
                          ...informeActivo,
                          columnaValores: e.target.value,
                        })
                      }
                      data-testid="select-chart-value-col"
                    >
                      {informeActivo.resultado.columnas.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>

              {informeActivo.tipoGrafico !== 'ninguno' && (
                <ChartVisualizer
                  tipo={informeActivo.tipoGrafico}
                  datos={datosParaGrafico}
                  titulo={informeActivo.titulo}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Resumen pedagógico cuando no hay informes generados todavía */}
      {informes.length === 0 && (
        <div
          style={{
            padding: '2rem 1.5rem',
            textAlign: 'center',
            background: 'rgba(15, 23, 42, 0.4)',
            borderRadius: '0.75rem',
            border: '1px dashed var(--border-color)',
            color: 'var(--text-muted)',
            marginBottom: '1.25rem',
          }}
        >
          <div style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>💡</div>
          <p style={{ margin: 0, fontSize: '0.92rem', marginBottom: '1rem' }}>
            Escribí una pregunta en lenguaje natural o seleccioná una de las sugerencias arriba para
            crear tu primer informe analítico sobre el modelo <strong>{modelo.entidades.map((e) => e.nombre).join(', ')}</strong>.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              const sugerencia = EJEMPLOS_CONSULTAS_SUGERIDAS[0] || 'Listar registros';
              setPedidoTexto(sugerencia);
              void handleGenerarLocal(sugerencia);
            }}
            data-testid="btn-generar-informe-rapido-ejemplo"
          >
            ⚡ Generar Primer Informe Automático
          </button>
        </div>
      )}

      {/* Navegación Inferior Unificada */}
      <div className="button-group" style={{ marginTop: '1.5rem' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onVolverPaso7}
          data-testid="btn-volver-paso7"
        >
          ← Volver al Paso 7 (Datos de Ejemplo)
        </button>

        <button
          type="button"
          className="btn btn-primary"
          onClick={async () => {
            if (informes.length === 0) {
              const sugerencia = EJEMPLOS_CONSULTAS_SUGERIDAS[0] || 'Listar registros';
              await handleGenerarLocal(sugerencia);
            }
            onConfirmarInformes();
          }}
          data-testid="btn-confirmar-informes"
        >
          {informesConfirmados
            ? '✓ Informes Confirmados (Avanzar a Entregables)'
            : informes.length > 0
            ? 'Confirmar Informes y Avanzar a Entregables →'
            : 'Crear Informe y Avanzar a Entregables →'}
        </button>
      </div>
    </section>
  );
}
