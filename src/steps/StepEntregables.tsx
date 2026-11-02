import React, { useState } from 'react';
import { ProyectoEstado, AnalisisResumido } from '../core/schemas';
import {
  generarAnalisisResumidoConIA,
  generarAnalisisResumidoFallback,
  analisisResumidoAMarkdown,
  generarGlosarioMarkdown,
  modeloConceptualAMarkdown,
} from '../export/analisis';
import {
  descargarPaqueteCompletoZip,
  OpcionesExportacionZip,
  OPCIONES_ZIP_POR_DEFECTO,
} from '../export/zip';
import { generarPdfAnalisisResumido } from '../export/pdf';
import { descargarArchivo } from '../export/svg';
import { exportarProyectoAJson } from '../core/storage';
import { obtenerApiKey } from '../core/key';

export interface StepEntregablesProps {
  proyecto: ProyectoEstado;
  onActualizarProyecto: (cambios: Partial<ProyectoEstado>) => void;
  onVolver: () => void;
  svgDiagrama?: string;
  binarioSQLite?: Uint8Array | null;
  svgsInformes?: Record<string, string>;
}

export const StepEntregables: React.FC<StepEntregablesProps> = ({
  proyecto,
  onActualizarProyecto,
  onVolver,
  svgDiagrama,
  binarioSQLite,
  svgsInformes = {},
}) => {
  const [opciones, setOpciones] = useState<Required<OpcionesExportacionZip>>(OPCIONES_ZIP_POR_DEFECTO);
  const [cargandoIA, setCargandoIA] = useState(false);
  const [mensajeEstado, setMensajeEstado] = useState<string | null>(null);
  const [errorAnalisis, setErrorAnalisis] = useState<string | null>(null);
  const [vistaPrevia, setVistaPrevia] = useState<'analisis' | 'glosario' | 'modelo'>('analisis');

  const analisisActual: AnalisisResumido =
    proyecto.analisisResumido || generarAnalisisResumidoFallback(proyecto);

  // Inicializar automáticamente el análisis de respaldo si aún no existe al ingresar a Entregables
  React.useEffect(() => {
    if (!proyecto.analisisResumido) {
      const fallback = generarAnalisisResumidoFallback(proyecto);
      onActualizarProyecto({
        analisisResumido: fallback,
      });
    }
  }, [proyecto.analisisResumido]);

  const toggleOpcion = (clave: keyof OpcionesExportacionZip) => {
    setOpciones((prev) => ({
      ...prev,
      [clave]: !prev[clave],
    }));
  };

  const handleUsarAnalisisLocal = () => {
    const fallback = generarAnalisisResumidoFallback(proyecto);
    onActualizarProyecto({
      analisisResumido: fallback,
      bitacora: [
        ...proyecto.bitacora,
        {
          paso: 9,
          fecha: new Date().toISOString(),
          descripcion: 'Confirmó y actualizó el análisis pedagógico estructurado deductivo (local).',
          origen: 'estudiante',
        },
      ],
    });
    setMensajeEstado('¡Análisis pedagógico deductivo guardado y actualizado con éxito!');
  };

  const handleGenerarAnalisisIA = async () => {
    setCargandoIA(true);
    setErrorAnalisis(null);
    setMensajeEstado('El tutor IA está elaborando el análisis pedagógico estructurado...');

    try {
      const nuevoAnalisis = await generarAnalisisResumidoConIA(proyecto);
      onActualizarProyecto({
        analisisResumido: nuevoAnalisis,
        bitacora: [
          ...proyecto.bitacora,
          {
            paso: 8,
            fecha: new Date().toISOString(),
            descripcion: 'Generación del informe de análisis resumido con tutor IA.',
            origen: 'ia_aceptada',
          },
        ],
      });
      setMensajeEstado('¡Análisis pedagógico generado exitosamente con el tutor IA!');
    } catch (err) {
      console.warn('Error al generar con IA, aplicando análisis deductivo de respaldo:', err);
      const fallback = generarAnalisisResumidoFallback(proyecto);
      onActualizarProyecto({
        analisisResumido: fallback,
      });
      setErrorAnalisis(
        `No se pudo conectar con Gemini (${err instanceof Error ? err.message : String(err)}). Se generó el análisis pedagógico mediante deducción local estructurada.`
      );
    } finally {
      setCargandoIA(false);
    }
  };

  const handleDescargarZip = () => {
    try {
      const keySesion = obtenerApiKey() ?? undefined;
      descargarPaqueteCompletoZip({
        proyecto,
        svgDiagrama,
        binarioSQLite,
        svgsInformes,
        opciones,
        apiKeySesion: keySesion,
      });
      setMensajeEstado('¡Paquete ZIP generado y descargado con éxito!');
    } catch (err) {
      setErrorAnalisis(
        `Error al empaquetar el ZIP: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleDescargarPdf = () => {
    try {
      const bytes = generarPdfAnalisisResumido(analisisActual, proyecto);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      descargarArchivo(blob, 'analisis_diseno_base_datos.pdf', 'application/pdf');
    } catch (err) {
      setErrorAnalisis(`Error al generar el PDF: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDescargarMarkdownAnalisis = () => {
    const md = analisisResumidoAMarkdown(analisisActual, proyecto);
    descargarArchivo(md, 'analisis.md', 'text/markdown');
  };

  const handleDescargarProyectoJson = () => {
    const json = exportarProyectoAJson(proyecto);
    descargarArchivo(json, 'proyecto.json', 'application/json');
  };

  const handleDescargarScriptSQL = () => {
    if (!proyecto.ddlGenerado) return;
    const extension = proyecto.motorSeleccionado === 'mongodb' ? 'js' : 'sql';
    descargarArchivo(proyecto.ddlGenerado, `esquema.${extension}`, 'text/plain');
  };

  const handleDescargarBaseSQLite = () => {
    if (!binarioSQLite) return;
    const blob = new Blob([binarioSQLite], { type: 'application/x-sqlite3' });
    descargarArchivo(blob, 'base_de_datos.sqlite', 'application/x-sqlite3');
  };

  return (
    <section
      className="card studio-step-card"
      aria-labelledby="step-entregables-title"
      data-testid="step-entregables-container"
    >
      {/* Encabezado unificado */}
      <div className="step-header">
        <span className="step-badge">Entregables</span>
        <div>
          <h2 id="step-entregables-title" className="card-title">
            Paquete de Entregables del Proyecto
          </h2>
          <p className="step-lead">
            Generá y descargá toda la documentación técnica, código SQL, base SQLite y el análisis
            resumido pedagógico para entregar a tu docente.
          </p>
        </div>
      </div>

      {/* Caja conceptual pedagógica */}
      <details className="concept-box" data-testid="step-entregables-concept-box">
        <summary className="concept-summary">
          💡 Explicación breve del concepto: Portabilidad y Evidencia de Aprendizaje
        </summary>
        <div className="concept-content">
          <p>
            En ingeniería de software y administración de datos, el entregable de un diseño no es solo un
            script SQL. Un paquete profesional completo debe incluir:
          </p>
          <ul>
            <li>
              <strong>El modelo conceptual:</strong> Qué entidades existen, sus atributos y por qué se
              eligió cada tipo de dato y clave.
            </li>
            <li>
              <strong>El diagrama de relaciones:</strong> La estructura visual de cardinalidades e
              integridad referencial.
            </li>
            <li>
              <strong>La justificación de decisiones:</strong> Por qué se eligió un motor específico, cómo
              se normalizó y qué concesiones de diseño se realizaron.
            </li>
            <li>
              <strong>Datos de prueba y consultas analíticas:</strong> Evidencia empírica de que la base
              soporta los requerimientos del negocio.
            </li>
          </ul>
        </div>
      </details>

      {/* Bloque del tutor IA */}
      <div className="tutor-explanation-box">
        <strong>Tutor Pedagógico IA:</strong>
        <p>
          {proyecto.analisisResumido
            ? 'Tu informe de análisis pedagógico ya está generado y listo para su inclusión en el paquete ZIP o descarga individual en PDF.'
            : 'Podés pedirle al tutor IA que elabore un informe estructurado de 1 a 2 páginas con las decisiones tomadas durante la sesión, o descargar el paquete generado localmente.'}
        </p>
      </div>

      {/* Avisos de estado o error */}
      {mensajeEstado && (
        <div className="status-banner status-banner-success" role="status">
          ✓ {mensajeEstado}
        </div>
      )}
      {errorAnalisis && (
        <div className="status-banner status-banner-warning" role="alert">
          ⚠ {errorAnalisis}
        </div>
      )}

      {/* Selector de qué incluir en el ZIP */}
      <div className="panel-seccion" style={{ marginTop: '1.25rem' }}>
        <h3 style={{ fontSize: '1.05rem', marginBottom: '0.5rem', fontWeight: 600 }}>
          Archivos a incluir en el paquete ZIP
        </h3>
        <p className="step-lead" style={{ fontSize: '0.875rem', marginBottom: '0.75rem' }}>
          Seleccioná los entregables que querés empaquetar:
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: '0.6rem',
            padding: '0.85rem',
            background: 'var(--bg-surface, #0c1222)',
            color: 'var(--text-main, #f1f5f9)',
            borderRadius: '8px',
            border: '1px solid var(--border-color, rgba(148, 163, 184, 0.2))',
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-main, inherit)' }}>
            <input
              type="checkbox"
              checked={opciones.incluirProyectoJson}
              onChange={() => toggleOpcion('incluirProyectoJson')}
            />
            <span><code>proyecto.json</code> (Reimportar)</span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-main, inherit)' }}>
            <input
              type="checkbox"
              checked={opciones.incluirModelo}
              onChange={() => toggleOpcion('incluirModelo')}
            />
            <span><code>modelo.md</code> y <code>.json</code></span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-main, inherit)' }}>
            <input
              type="checkbox"
              checked={opciones.incluirDiagrama}
              onChange={() => toggleOpcion('incluirDiagrama')}
            />
            <span>Diagrama ER (<code>.mmd</code> / <code>.svg</code>)</span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-main, inherit)' }}>
            <input
              type="checkbox"
              checked={opciones.incluirScriptDDL}
              onChange={() => toggleOpcion('incluirScriptDDL')}
            />
            <span>Script de creación (<code>.sql</code> / <code>.js</code> mongosh)</span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-main, inherit)' }}>
            <input
              type="checkbox"
              checked={opciones.incluirBaseSQLite}
              disabled={!binarioSQLite}
              onChange={() => toggleOpcion('incluirBaseSQLite')}
            />
            <span>Base <code>.sqlite</code> binaria {binarioSQLite ? '(Lista)' : '(No generada)'}</span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-main, inherit)' }}>
            <input
              type="checkbox"
              checked={opciones.incluirDatos}
              disabled={!proyecto.datosEjemplo}
              onChange={() => toggleOpcion('incluirDatos')}
            />
            <span>Datos en CSV por tabla</span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-main, inherit)' }}>
            <input
              type="checkbox"
              checked={opciones.incluirInformes}
              disabled={!proyecto.informes || proyecto.informes.length === 0}
              onChange={() => toggleOpcion('incluirInformes')}
            />
            <span>Informes y Consultas ({proyecto.informes?.length || 0})</span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-main, inherit)' }}>
            <input
              type="checkbox"
              checked={opciones.incluirAnalisis}
              onChange={() => toggleOpcion('incluirAnalisis')}
            />
            <span>Análisis Resumido (<code>.pdf</code> / <code>.md</code>)</span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-main, inherit)' }}>
            <input
              type="checkbox"
              checked={opciones.incluirGlosario}
              onChange={() => toggleOpcion('incluirGlosario')}
            />
            <span>Glosario Pedagógico (<code>.md</code>)</span>
          </label>
        </div>
      </div>

      {/* Botón principal de descarga del ZIP */}
      <div className="toolbar-row" style={{ marginTop: '1.25rem', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          onClick={handleDescargarZip}
          style={{ fontSize: '1rem', padding: '0.65rem 1.25rem' }}
          data-testid="boton-descargar-zip"
        >
          📦 Descargar Paquete Completo (.ZIP)
        </button>

        <button
          className="btn btn-secondary"
          onClick={handleUsarAnalisisLocal}
          data-testid="boton-usar-analisis-local"
        >
          ⚡ Análisis Local (sin IA)
        </button>

        <button
          className="btn btn-secondary"
          onClick={handleGenerarAnalisisIA}
          disabled={cargandoIA}
          data-testid="boton-generar-analisis-ia"
        >
          {cargandoIA ? '⏳ Analizando con IA...' : '🤖 Generar con Tutor IA'}
        </button>
      </div>

      {/* Pestañas de Vista Previa */}
      <div style={{ marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-color, rgba(148, 163, 184, 0.2))', paddingBottom: '0.25rem' }}>
          <button
            type="button"
            className={`btn ${vistaPrevia === 'analisis' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }}
            onClick={() => setVistaPrevia('analisis')}
          >
            Vista previa: Análisis Resumido
          </button>
          <button
            type="button"
            className={`btn ${vistaPrevia === 'modelo' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }}
            onClick={() => setVistaPrevia('modelo')}
          >
            Vista previa: Modelo Markdown
          </button>
          <button
            type="button"
            className={`btn ${vistaPrevia === 'glosario' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }}
            onClick={() => setVistaPrevia('glosario')}
          >
            Vista previa: Glosario
          </button>
        </div>

        <div
          style={{
            marginTop: '0.75rem',
            padding: '1rem',
            background: 'var(--bg-input, #090e1c)',
            color: 'var(--text-main, #f1f5f9)',
            border: '1px solid var(--border-color, rgba(148, 163, 184, 0.2))',
            borderRadius: '6px',
            maxHeight: '320px',
            overflowY: 'auto',
            fontFamily: 'monospace',
            fontSize: '0.85rem',
            whiteSpace: 'pre-wrap',
          }}
          data-testid="vista-previa-contenido"
        >
          {vistaPrevia === 'analisis' && analisisResumidoAMarkdown(analisisActual, proyecto)}
          {vistaPrevia === 'modelo' && modeloConceptualAMarkdown(proyecto)}
          {vistaPrevia === 'glosario' && generarGlosarioMarkdown(proyecto)}
        </div>
      </div>

      {/* Descargas individuales */}
      <div style={{ marginTop: '1.5rem' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem', fontWeight: 600 }}>
          Descargas individuales
        </h3>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={handleDescargarPdf} title="Descargar análisis en PDF">
            📄 Análisis en PDF
          </button>
          <button className="btn btn-secondary" onClick={handleDescargarMarkdownAnalisis} title="Descargar análisis en Markdown">
            📝 Análisis en Markdown
          </button>
          <button className="btn btn-secondary" onClick={handleDescargarProyectoJson} title="Descargar JSON para reimportar">
            💾 Proyecto JSON
          </button>
          {proyecto.ddlGenerado && (
            <button className="btn btn-secondary" onClick={handleDescargarScriptSQL} title="Descargar script DDL">
              📜 Script DDL SQL
            </button>
          )}
          {binarioSQLite && (
            <button className="btn btn-secondary" onClick={handleDescargarBaseSQLite} title="Descargar archivo SQLite">
              🗄️ Base de datos .sqlite
            </button>
          )}
        </div>
      </div>

      {/* Nota de Seguridad BYOK */}
      <div
        style={{
          marginTop: '1.5rem',
          padding: '0.75rem 1rem',
          background: 'var(--bg-success, rgba(16, 185, 129, 0.12))',
          border: '1px solid var(--border-success, #10b981)',
          borderRadius: '6px',
          color: 'var(--text-success, #6ee7b7)',
          fontSize: '0.85rem',
        }}
        data-testid="banner-seguridad-byok"
      >
        🔒 <strong>Garantía de Seguridad BYOK:</strong> Todo el paquete ZIP se procesa localmente en
        tu navegador. La API key de Gemini nunca se incluye en ningún archivo exportado, los CSVs
        tienen protección contra inyección de fórmulas y ningún dato es enviado a servidores externos.
      </div>

      {/* Navegación inferior */}
      <div className="button-group" style={{ marginTop: '1.75rem' }}>
        <button
          className="btn btn-secondary"
          onClick={onVolver}
          data-testid="boton-volver-paso-anterior"
        >
          ← Volver a Informes
        </button>
      </div>
    </section>
  );
};
