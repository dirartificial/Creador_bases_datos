import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Modelo } from '../core/schemas';
import { generarMermaidEr } from '../core/erDiagram';
import { renderizarDiagramaMermaid } from '../core/mermaidRenderer';
import { descargarArchivo, exportarSvgAPng } from '../export/svg';

export interface Step5DiagramaERProps {
  modelo: Modelo;
  diagramaConfirmado: boolean;
  cargando?: boolean;
  onConfirmarDiagrama: () => void;
  onVolverPaso4: () => void;
  onRegistrarDecision?: (
    descripcion: string,
    origen: 'estudiante' | 'ia_aceptada' | 'ia_rechazada'
  ) => void;
}

export function Step5DiagramaER({
  modelo,
  diagramaConfirmado,
  cargando = false,
  onConfirmarDiagrama,
  onVolverPaso4,
  onRegistrarDecision,
}: Step5DiagramaERProps) {
  const containerId = useId();
  const [vistaActiva, setVistaActiva] = useState<'diagrama' | 'codigo'>('diagrama');
  const [svgSanitizado, setSvgSanitizado] = useState<string>('');
  const [errorRender, setErrorRender] = useState<string | null>(null);
  const [renderizando, setRenderizando] = useState<boolean>(true);
  const [copiado, setCopiado] = useState<boolean>(false);
  const [descargandoPng, setDescargandoPng] = useState<boolean>(false);
  const svgViewportRef = useRef<HTMLDivElement>(null);

  // Generación determinística del código fuente Mermaid (.mmd) desde el modelo confirmado
  const codigoMermaid = useMemo(() => {
    return generarMermaidEr(modelo);
  }, [modelo]);

  // Total de entidades y relaciones
  const totalEntidades = modelo.entidades.length;
  const totalRelaciones = modelo.relaciones.length;
  const totalAtributos = modelo.entidades.reduce(
    (acc, ent) => acc + ent.atributos.length,
    0
  );

  // Renderizado del diagrama Mermaid con sanitización estricta
  useEffect(() => {
    let cancelado = false;
    setRenderizando(true);
    setErrorRender(null);

    renderizarDiagramaMermaid(codigoMermaid)
      .then(({ svgSanitizado: svgLimpio }) => {
        if (!cancelado) {
          setSvgSanitizado(svgLimpio);
          setRenderizando(false);
        }
      })
      .catch((err) => {
        if (!cancelado) {
          setErrorRender(
            err instanceof Error
              ? err.message
              : 'Error inesperado al renderizar el diagrama Mermaid.'
          );
          setRenderizando(false);
        }
      });

    return () => {
      cancelado = true;
    };
  }, [codigoMermaid]);

  // Montaje seguro del SVG sanitizado en el contenedor DOM (sin dangerouslySetInnerHTML)
  useEffect(() => {
    if (vistaActiva === 'diagrama' && svgViewportRef.current && svgSanitizado) {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgSanitizado, 'image/svg+xml');
        const svgEl = doc.querySelector('svg');
        if (svgEl) {
          // Responsive styling para visualización óptima
          svgEl.setAttribute('width', '100%');
          svgEl.setAttribute('height', '100%');
          svgEl.style.maxWidth = '100%';
          svgEl.style.height = 'auto';
          svgEl.style.display = 'block';
          svgViewportRef.current.replaceChildren(svgEl);
        }
      } catch (err) {
        console.error('Error al insertar SVG sanitizado:', err);
      }
    }
  }, [svgSanitizado, vistaActiva]);

  // Copiar código Mermaid al portapapeles
  const handleCopiarMermaid = async () => {
    try {
      await navigator.clipboard.writeText(codigoMermaid);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
      onRegistrarDecision?.(
        'Copió el código fuente Mermaid (.mmd) del diagrama ER al portapapeles.',
        'estudiante'
      );
    } catch {
      // Fallback manual si clipboard API no está disponible
      setCopiado(false);
    }
  };

  // Descarga del fuente Mermaid (.mmd)
  const handleDescargarMmd = () => {
    descargarArchivo(codigoMermaid, 'diagrama-er.mmd', 'text/plain');
    onRegistrarDecision?.(
      'Descargó el archivo fuente de diagrama Mermaid (diagrama-er.mmd).',
      'estudiante'
    );
  };

  // Descarga del SVG sanitizado
  const handleDescargarSvg = () => {
    if (!svgSanitizado) return;
    descargarArchivo(svgSanitizado, 'diagrama-er.svg', 'image/svg+xml');
    onRegistrarDecision?.(
      'Descargó el diagrama en formato vectorial sanitizado (diagrama-er.svg).',
      'estudiante'
    );
  };

  // Descarga como imagen PNG en alta resolución (Canvas 2x)
  const handleDescargarPng = async () => {
    if (!svgSanitizado || descargandoPng) return;
    setDescargandoPng(true);
    try {
      const pngBlob = await exportarSvgAPng(svgSanitizado, 2);
      descargarArchivo(pngBlob, 'diagrama-er.png', 'image/png');
      onRegistrarDecision?.(
        'Descargó el diagrama en formato imagen de alta resolución (diagrama-er.png).',
        'estudiante'
      );
    } catch (err) {
      console.error('Error al exportar PNG:', err);
    } finally {
      setDescargandoPng(false);
    }
  };

  return (
    <section
      className="card studio-step-card"
      aria-labelledby="step5-title"
      data-testid="step5-container"
    >
      {/* Encabezado Pedagógico del Paso 5 (Homogéneo con Pasos 1 al 4) */}
      <div className="step-header">
        <span className="step-badge">Paso 5 de 8</span>
        <div>
          <h2 id="step5-title" className="card-title">
            Diagrama Entidad-Relación (ER)
          </h2>
          <p className="step-lead">
            Visualizá la arquitectura visual de tus datos generada en Mermaid estricto a partir del
            modelo confirmado, y exportala en formatos .mmd, .svg o .png.
          </p>
        </div>
      </div>

      {/* Guía Pedagógica Colapsable (Homogénea con concept-box) */}
      <details className="concept-box" data-testid="step5-concept-box">
        <summary className="concept-summary">
          💡 Explicación breve del concepto: Diagramas ER y Notación Crow&apos;s Foot (Pata de Gallo)
        </summary>
        <div className="concept-content">
          <ul>
            <li>
              <strong>¿Qué es un Diagrama ER?</strong> Es la representación gráfica estándar de una
              base de datos. Permite a los desarrolladores, arquitectos y docentes comprender de un
              vistazo qué entidades existen, cuáles son sus claves y cómo se vinculan entre sí.
            </li>
            <li>
              <strong>Notación Crow&apos;s Foot (Pata de Gallo):</strong>
              <ul>
                <li>
                  <code>||</code> <strong>Uno y exactamente uno (obligatorio):</strong> Cada registro
                  debe asociarse obligatoriamente con un único registro del otro extremo.
                </li>
                <li>
                  <code>|o</code> o <code>o|</code> <strong>Cero o uno (opcional):</strong> La
                  asociación es voluntaria (puede haber null en la clave foránea).
                </li>
                <li>
                  <code>|&#123;</code> <strong>Uno o más (muchos obligatorio):</strong> Debe haber al
                  menos un registro asociado.
                </li>
                <li>
                  <code>o&#123;</code> <strong>Cero o más (muchos opcional):</strong> Pueden existir
                  cero, uno o múltiples registros asociados.
                </li>
              </ul>
            </li>
            <li>
              <strong>Claves y Restricciones:</strong>
              <ul>
                <li>
                  <code>PK</code> (Primary Key): Identifica de forma única cada fila de la entidad.
                </li>
                <li>
                  <code>FK</code> (Foreign Key): Clave foránea que referencia la PK de otra tabla
                  para preservar la integridad referencial.
                </li>
                <li>
                  <code>UK</code> (Unique Key): Restricción de unicidad para columnas que no admiten
                  valores duplicados (ej.: email, código interno).
                </li>
              </ul>
            </li>
          </ul>
        </div>
      </details>

      {/* Explicación del Tutor IA (Homogénea con tutor-explanation-box) */}
      <div className="tutor-explanation-box" data-testid="tutor-er-summary">
        <strong>Análisis del Tutor IA sobre el diagrama visual:</strong>
        <p>
          Este diagrama fue generado de manera <strong>100% determinística</strong> a partir de tus
          entidades y relaciones confirmadas. Cuenta con {totalEntidades} entidades, {totalAtributos}{' '}
          atributos y {totalRelaciones} conexiones relacionales. Cada conector refleja las
          cardinalidades y reglas de obligatoriedad que validaste en el Paso 4.
        </p>
      </div>

      {/* Resumen de Métricas Rápidas */}
      <div className="stats-pills-row" style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <span className="tech-chip">Entidades: {totalEntidades}</span>
        <span className="tech-chip">Relaciones: {totalRelaciones}</span>
        <span className="tech-chip">Atributos totales: {totalAtributos}</span>
        <span className="tech-chip">Mermaid: securityLevel: &apos;strict&apos;</span>
      </div>

      {/* Barra de Herramientas y Exportación (Homogénea con toolbar-row) */}
      <div className="toolbar-row" data-testid="step5-toolbar">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setVistaActiva(vistaActiva === 'diagrama' ? 'codigo' : 'diagrama')}
          data-testid="toggle-view-btn"
        >
          {vistaActiva === 'diagrama' ? '💻 Ver código fuente Mermaid (.mmd)' : '📊 Ver Diagrama Gráfico'}
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleCopiarMermaid}
          data-testid="copy-mermaid-btn"
        >
          {copiado ? '✓ ¡Copiado al portapapeles!' : '📋 Copiar código Mermaid'}
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleDescargarMmd}
          data-testid="download-mmd-btn"
        >
          📥 Descargar .mmd
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleDescargarSvg}
          disabled={!svgSanitizado || renderizando}
          data-testid="download-svg-btn"
        >
          📥 Descargar .svg
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleDescargarPng}
          disabled={!svgSanitizado || renderizando || descargandoPng}
          data-testid="download-png-btn"
        >
          {descargandoPng ? '⏳ Generando PNG...' : '📥 Descargar .png'}
        </button>
      </div>

      {/* Visor Principal del Diagrama o Código */}
      {vistaActiva === 'diagrama' ? (
        <div
          className="diagram-card-container"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: '0.85rem',
            padding: '1.25rem',
            marginBottom: '1.25rem',
            minHeight: '340px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            boxShadow: '0 6px 24px rgba(0,0,0,0.3)',
          }}
          data-testid="diagram-card-container"
        >
          {renderizando && (
            <div
              className="loading-indicator"
              style={{ padding: '2rem', textAlign: 'center', color: 'var(--accent-cyan)' }}
              data-testid="diagram-loading"
            >
              <div className="spinner" aria-hidden="true" style={{ margin: '0 auto 0.75rem' }} />
              <p>Generando y renderizando diagrama Mermaid en modo seguro...</p>
            </div>
          )}

          {errorRender && (
            <div
              role="alert"
              className="alert alert-error"
              style={{ width: '100%' }}
              data-testid="diagram-error"
            >
              <strong>Error al renderizar el diagrama:</strong> {errorRender}
            </div>
          )}

          <div
            id={`mermaid-viewport-${containerId}`}
            ref={svgViewportRef}
            className="diagram-viewport"
            style={{
              width: '100%',
              overflowX: 'auto',
              padding: '0.5rem',
              display: renderizando || errorRender ? 'none' : 'block',
              background: '#ffffff',
              borderRadius: '0.6rem',
            }}
            data-testid="diagram-viewport"
          />
        </div>
      ) : (
        <div
          className="code-view-container"
          style={{
            background: 'var(--bg-input)',
            border: '1px solid var(--border-color)',
            borderRadius: '0.85rem',
            padding: '1rem',
            marginBottom: '1.25rem',
          }}
          data-testid="code-view-container"
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '0.5rem',
            }}
          >
            <span className="tech-chip">Sintaxis Mermaid erDiagram</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Compatible con GitHub, Notion y Mermaid Live Editor
            </span>
          </div>
          <pre
            data-testid="mermaid-code-pre"
            style={{
              margin: 0,
              padding: '1rem',
              background: 'rgba(0,0,0,0.4)',
              borderRadius: '0.5rem',
              overflowX: 'auto',
              fontSize: '0.88rem',
              lineHeight: 1.45,
              color: 'var(--text-main)',
              fontFamily: 'ui-monospace, monospace',
            }}
          >
            <code>{codigoMermaid}</code>
          </pre>
        </div>
      )}

      {/* Banner de Confirmación */}
      {diagramaConfirmado && (
        <div
          role="status"
          className="alert alert-success"
          data-testid="diagram-confirmed-banner"
          style={{ marginBottom: '1rem' }}
        >
          <strong>✓ Diagrama ER confirmado por el estudiante.</strong> La visualización
          arquitectónica está lista y podés avanzar al Paso 6 (Generación de Script y Motor).
        </div>
      )}

      {/* Navegación Inferior (Homogénea con button-group) */}
      <div className="button-group">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onVolverPaso4}
          disabled={cargando}
          data-testid="back-to-step4-btn"
        >
          ← Volver al Paso 4 (Relaciones)
        </button>

        <button
          type="button"
          className="btn btn-primary"
          onClick={onConfirmarDiagrama}
          disabled={cargando || Boolean(errorRender)}
          data-testid="confirm-step5-btn"
        >
          Confirmar Diagrama y Avanzar al Paso 6 (Motor y DDL) ✓
        </button>
      </div>
    </section>
  );
}
