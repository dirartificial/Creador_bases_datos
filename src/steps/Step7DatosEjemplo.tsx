import { useId, useMemo, useState } from 'react';
import { ConjuntoDatosEjemplo, Modelo, MotorBaseDatos, TablaDatosEjemplo } from '../core/schemas';
import {
  generarInsertStatementsSQLite,
  sanitizarValorCSV,
  validarIntegridadReferencialDatos,
} from '../core/sampleData';
import { generarDocumentosEjemploMongo } from '../core/ddl/mongo';
import { descargarArchivo } from '../export/svg';

export interface Step7DatosEjemploProps {
  modelo: Modelo;
  motorSeleccionado?: MotorBaseDatos;
  ddlGenerado?: string;
  cantidadFilas?: number;
  datosEjemplo?: ConjuntoDatosEjemplo;
  datosConfirmados: boolean;
  baseSQLiteGenerada: boolean;
  cargandoIA?: boolean;
  ejecutandoSQLite?: boolean;
  onCambiarCantidadFilas: (cantidad: number) => void;
  onGenerarDatosConIA: (cantidad: number) => Promise<void>;
  onGenerarDatosLocales?: (cantidad: number) => void;
  onEjecutarEnSQLite: () => Promise<void>;
  onDescargarSQLite: () => void;
  onConfirmarDatos: () => void;
  onVolverPaso6: () => void;
  onRegistrarDecision?: (
    descripcion: string,
    origen: 'estudiante' | 'ia_aceptada' | 'ia_rechazada'
  ) => void;
}

export function Step7DatosEjemplo({
  modelo,
  motorSeleccionado = 'sqlite',
  ddlGenerado: _ddlGenerado,
  cantidadFilas = 3,
  datosEjemplo,
  datosConfirmados,
  baseSQLiteGenerada,
  cargandoIA = false,
  ejecutandoSQLite = false,
  onCambiarCantidadFilas,
  onGenerarDatosConIA,
  onGenerarDatosLocales,
  onEjecutarEnSQLite,
  onDescargarSQLite,
  onConfirmarDatos,
  onVolverPaso6,
  onRegistrarDecision,
}: Step7DatosEjemploProps) {
  const titleId = useId();
  const [tablaActiva, setTablaActiva] = useState<string>('');

  // Validación determinística de integridad referencial sobre los datos generados
  const validacionIntegridad = useMemo(() => {
    if (!datosEjemplo) return null;
    return validarIntegridadReferencialDatos(datosEjemplo, modelo);
  }, [datosEjemplo, modelo]);

  // Selección inicial de la primera tabla al generarse los datos (tolerante a mayúsculas/minúsculas)
  const nombrePrimeraTabla = datosEjemplo?.tablas[0]?.tabla ?? '';
  const tablaSeleccionada = useMemo(() => {
    if (!datosEjemplo || datosEjemplo.tablas.length === 0) return '';
    if (tablaActiva) {
      const match = datosEjemplo.tablas.find(
        (t) => t.tabla.toLowerCase() === tablaActiva.toLowerCase()
      );
      if (match) return match.tabla;
    }
    return nombrePrimeraTabla;
  }, [datosEjemplo, tablaActiva, nombrePrimeraTabla]);

  const datosTablaActual: TablaDatosEjemplo | undefined = useMemo(() => {
    if (!datosEjemplo || datosEjemplo.tablas.length === 0) return undefined;
    return (
      datosEjemplo.tablas.find(
        (t) => t.tabla.toLowerCase() === tablaSeleccionada.toLowerCase()
      ) ?? datosEjemplo.tablas[0]
    );
  }, [datosEjemplo, tablaSeleccionada]);

  // Columnas seguras para renderizar y exportar (fallback a claves de la primera fila si vienen vacías)
  const columnasVisibles = useMemo(() => {
    if (!datosTablaActual) return [];
    if (datosTablaActual.columnas && datosTablaActual.columnas.length > 0) {
      return datosTablaActual.columnas;
    }
    if (datosTablaActual.filas && datosTablaActual.filas.length > 0) {
      return Object.keys(datosTablaActual.filas[0]);
    }
    return [];
  }, [datosTablaActual]);

  // Total de filas generadas en todas las tablas
  const totalFilasGeneradas = useMemo(() => {
    if (!datosEjemplo) return 0;
    return datosEjemplo.tablas.reduce((acc, t) => acc + t.filas.length, 0);
  }, [datosEjemplo]);

  // Exportar la tabla activa a CSV seguro con protección anti-fórmulas
  const handleDescargarCSVTabla = (tabla: TablaDatosEjemplo) => {
    const cols =
      tabla.columnas && tabla.columnas.length > 0
        ? tabla.columnas
        : Object.keys(tabla.filas[0] || {});
    const encabezados = cols.map(sanitizarValorCSV).join(',');
    const filasCSV = tabla.filas.map((fila) =>
      cols.map((col) => sanitizarValorCSV(fila[col])).join(',')
    );
    const contenidoCSV = [encabezados, ...filasCSV].join('\n');

    descargarArchivo(
      contenidoCSV,
      `datos_${tabla.tabla.toLowerCase()}.csv`,
      'text/csv;charset=utf-8;'
    );

    onRegistrarDecision?.(
      `Descargó archivo CSV seguro con protección anti-fórmulas de la tabla "${tabla.tabla}".`,
      'estudiante'
    );
  };

  // Descarga de las sentencias INSERT SQL
  const handleDescargarInsertsSQL = () => {
    if (!datosEjemplo) return;
    const sentencias = generarInsertStatementsSQLite(datosEjemplo);
    const contenido = [
      '-- Sentencias INSERT generadas por DB Tutor',
      '-- Ordenadas respetando la integridad referencial de claves foráneas',
      '',
      ...sentencias,
    ].join('\n');

    descargarArchivo(contenido, 'datos_ejemplo.sql', 'application/sql');
    onRegistrarDecision?.(
      'Descargó el script de datos de ejemplo (datos_ejemplo.sql).',
      'estudiante'
    );
  };

  // Descarga de documentos de ejemplo en formato JSON para MongoDB
  const handleDescargarMongoJSON = () => {
    if (!datosEjemplo) return;
    const docs = generarDocumentosEjemploMongo(modelo, datosEjemplo);
    descargarArchivo(
      JSON.stringify(docs, null, 2),
      'datos_mongodb.json',
      'application/json'
    );
    onRegistrarDecision?.(
      'Descargó los documentos de ejemplo estructurados en formato JSON para MongoDB (datos_mongodb.json).',
      'estudiante'
    );
  };

  const handleGenerarDatos = async () => {
    await onGenerarDatosConIA(cantidadFilas);
    onRegistrarDecision?.(
      `Solicitó al tutor IA generar un conjunto de ${cantidadFilas} filas de ejemplo por tabla con claves foráneas coherentes.`,
      'ia_aceptada'
    );
  };

  const handleProbarEnSQLite = async () => {
    await onEjecutarEnSQLite();
    onRegistrarDecision?.(
      'Ejecutó el DDL y los datos de ejemplo dentro del motor SQLite WASM en el navegador.',
      'estudiante'
    );
  };

  return (
    <section
      className="card studio-step-card"
      aria-labelledby={titleId}
      data-testid="step7-container"
    >
      {/* Encabezado Unificado del Paso */}
      <div className="step-header">
        <span className="step-badge">Paso 7 de 8</span>
        <div>
          <h2 id={titleId} className="card-title">
            7. Datos de Ejemplo y Ejecución Real en SQLite
          </h2>
          <p className="step-lead">
            Generamos filas realistas coherentes con el negocio para poblar tu base de datos y
            verificamos la integridad referencial ejecutándola de verdad en tu navegador con
            SQLite (WebAssembly).
          </p>
        </div>
      </div>

      {/* Caja Conceptual Pedagógica */}
      <details className="concept-box" data-testid="step7-concept-box">
        <summary className="concept-summary">
          💡 Explicación breve del concepto: ¿Por qué son cruciales los datos de prueba coherentes?
        </summary>
        <div className="concept-content">
          <p>
            <strong>Integridad Referencial en los Datos:</strong> Al poblar una base de datos
            relacional, no se pueden inventar valores al azar. Si la tabla <code>Libros</code> tiene
            una clave foránea <code>autor_id = 4</code>, debe existir previamente un autor con{' '}
            <code>id = 4</code> en la tabla <code>Autores</code>. De lo contrario, con{' '}
            <code>PRAGMA foreign_keys = ON;</code> SQLite rechazará la inserción con un error de
            violación de clave foránea.
          </p>
          <ul>
            <li>
              <strong>Orden Topológico de Inserción:</strong> Siempre deben insertarse primero los
              datos de las tablas padre independientes (sin dependencias) y luego los de las tablas
              hijas que las referencian.
            </li>
            <li>
              <strong>Seguridad al exportar CSV (Anti-Formula Injection):</strong> Si una celda de
              texto empieza con <code>=</code>, <code>+</code>, <code>-</code> o <code>@</code>,
              programas como Excel intentan ejecutarla como fórmula. Nuestro exportador antepone un
              apóstrofe (<code>'</code>) para garantizar que se interprete estrictamente como texto.
            </li>
            <li>
              <strong>Ejecución Real en WASM:</strong> La base de datos se crea, puebla y compila
              dentro de la memoria de tu propio navegador. El archivo <code>.sqlite</code> que
              descargás es un binario real y estándar, compatible con cualquier software de gestión
              de bases de datos.
            </li>
          </ul>
        </div>
      </details>

      {/* Selector de Filas y Botón de Generación */}
      <div
        className="data-generator-card"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          borderRadius: '0.75rem',
          padding: '1.25rem',
          marginBottom: '1.25rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <label htmlFor="select-filas" className="form-label-sm" style={{ margin: 0 }}>
              Cantidad de filas por tabla:
            </label>
            <select
              id="select-filas"
              className="form-control"
              style={{ width: 'auto', minWidth: '130px' }}
              value={cantidadFilas}
              onChange={(e) => onCambiarCantidadFilas(Number(e.target.value))}
              disabled={cargandoIA || ejecutandoSQLite}
              data-testid="select-cantidad-filas"
            >
              <option value={3}>3 filas (Rápido)</option>
              <option value={5}>5 filas (Recomendado)</option>
              <option value={10}>10 filas (Extenso)</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleGenerarDatos}
              disabled={cargandoIA || ejecutandoSQLite}
              data-testid="btn-generar-datos"
            >
              {cargandoIA
                ? '⏳ Generando datos con Tutor IA...'
                : datosEjemplo
                  ? '🔄 Regenerar Datos con Tutor IA'
                  : '✨ Generar Datos de Ejemplo con Tutor IA'}
            </button>

            {onGenerarDatosLocales && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => onGenerarDatosLocales(cantidadFilas)}
                disabled={cargandoIA || ejecutandoSQLite}
                title="Genera datos determinísticos en tu navegador sin consumir tokens de IA"
                data-testid="btn-generar-datos-locales-barra"
              >
                ⚡ Generar datos rápidos (sin IA)
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sugerencia amigable cuando la base aún no tiene filas generadas */}
      {!datosEjemplo && (
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px dashed var(--border-color)',
            borderRadius: '0.75rem',
            padding: '2.5rem 1.5rem',
            textAlign: 'center',
            marginBottom: '1.25rem',
          }}
          data-testid="no-data-hint"
        >
          <div style={{ fontSize: '2.2rem', marginBottom: '0.6rem' }} aria-hidden="true">
            📋
          </div>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem', color: 'var(--accent-cyan)' }}>
            Tu base de datos aún no tiene filas de prueba cargadas
          </h3>
          <p
            style={{
              margin: '0 auto 1.25rem',
              maxWidth: '620px',
              fontSize: '0.86rem',
              color: 'var(--text-muted)',
              lineHeight: 1.5,
            }}
          >
            A diferencia de los <strong>ejemplos precargados</strong> (que ya vienen poblados para explorar de inmediato),
            en un proyecto propio debés hacer clic en <strong>&ldquo;Generar Datos de Ejemplo con Tutor IA&rdquo;</strong> o
            en <strong>&ldquo;Generar datos rápidos (sin IA)&rdquo;</strong> para crear las filas respetando claves foráneas y
            desbloquear las pestañas con las tablas y la ejecución en SQLite WASM. <em>¡No necesitás iniciar un proyecto nuevo!</em>
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleGenerarDatos}
              disabled={cargandoIA || ejecutandoSQLite}
            >
              {cargandoIA ? '⏳ Generando con Tutor IA...' : '✨ Generar con Tutor IA'}
            </button>
            {onGenerarDatosLocales && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => onGenerarDatosLocales(cantidadFilas)}
                disabled={cargandoIA || ejecutandoSQLite}
                data-testid="btn-generar-datos-locales"
              >
                ⚡ Generar datos rápidos (sin IA)
              </button>
            )}
          </div>
        </div>
      )}

      {/* Estado y Verificación de Integridad Referencial */}
      {datosEjemplo && validacionIntegridad && (
        <div style={{ marginBottom: '1.25rem' }}>
          {validacionIntegridad.valido ? (
            <div
              className="badge"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                background: 'rgba(16, 185, 129, 0.15)',
                color: '#6ee7b7',
                padding: '0.65rem 1rem',
                borderRadius: '0.5rem',
                fontSize: '0.85rem',
                fontWeight: 600,
                border: '1px solid rgba(16, 185, 129, 0.3)',
              }}
              data-testid="referential-integrity-valid"
            >
              <span>✓ Integridad referencial verificada:</span>
              <span style={{ color: '#ffffff', fontWeight: 400 }}>
                Todas las claves foráneas apuntan a claves primarias válidas y existentes en las
                tablas padre ({totalFilasGeneradas} filas en total).
              </span>
            </div>
          ) : (
            <div
              className="badge"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.35rem',
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#fca5a5',
                padding: '0.65rem 1rem',
                borderRadius: '0.5rem',
                fontSize: '0.85rem',
                border: '1px solid rgba(239, 68, 68, 0.3)',
              }}
              data-testid="referential-integrity-error"
            >
              <strong style={{ color: '#ef4444' }}>⚠️ Violaciones de integridad referencial detectadas:</strong>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.82rem' }}>
                {validacionIntegridad.errores.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Tutor Explanation Box del conjunto de datos */}
      {datosEjemplo && datosEjemplo.resumenDidactico && (
        <div className="tutor-explanation-box" style={{ marginBottom: '1.25rem' }} data-testid="tutor-data-summary">
          <strong>Análisis didáctico del Tutor IA sobre la población de datos:</strong>
          <p>{datosEjemplo.resumenDidactico}</p>
        </div>
      )}

      {/* Bloque de Ejecución Real en SQLite (sql.js) */}
      {datosEjemplo && (
        <div
          style={{
            background: 'rgba(16, 24, 45, 0.9)',
            border: '1px solid var(--border-color)',
            borderRadius: '0.75rem',
            padding: '1.25rem',
            marginBottom: '1.25rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '1rem',
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#93c5fd', marginBottom: '0.2rem' }}>
                Motor SQLite en Web Worker (WASM)
              </div>
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Crea las tablas con el DDL, activa <code>PRAGMA foreign_keys = ON;</code> e inserta
                las {totalFilasGeneradas} filas en memoria.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleProbarEnSQLite}
                disabled={ejecutandoSQLite || cargandoIA}
                data-testid="btn-ejecutar-sqlite"
              >
                {ejecutandoSQLite
                  ? '⚙️ Ejecutando en sql.js...'
                  : baseSQLiteGenerada
                    ? '🔄 Re-ejecutar en SQLite'
                    : '▶️ Crear y Probar Base en SQLite'}
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={onDescargarSQLite}
                disabled={!baseSQLiteGenerada}
                data-testid="btn-descargar-sqlite"
              >
                💾 Descargar .sqlite
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleDescargarInsertsSQL}
                data-testid="btn-descargar-inserts"
              >
                📥 Descargar datos_ejemplo.sql
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleDescargarMongoJSON}
                data-testid="btn-descargar-mongo-json"
                style={{
                  borderColor:
                    motorSeleccionado === 'mongodb' ? 'rgba(16, 185, 129, 0.5)' : undefined,
                  color: motorSeleccionado === 'mongodb' ? '#6ee7b7' : undefined,
                }}
              >
                🍃 Descargar datos_mongodb.json
              </button>
            </div>
          </div>

          {baseSQLiteGenerada && (
            <div
              style={{
                marginTop: '1rem',
                padding: '0.65rem 0.9rem',
                background: 'rgba(16, 185, 129, 0.12)',
                borderRadius: '0.5rem',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.55rem',
                fontSize: '0.84rem',
                color: '#6ee7b7',
              }}
              data-testid="sqlite-live-success"
            >
              <span className="status-dot-online" aria-hidden="true" />
              <span>
                <strong>¡Base de datos SQLite activa y poblada con éxito!</strong> Podés descargar el
                archivo <code>.sqlite</code> binario directamente o avanzar al Paso 8 para formular
                consultas e informes SELECT sobre estos datos.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Visualizador de Tablas y Filas Generadas */}
      {datosEjemplo && (
        <div
          className="table-preview-card"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: '0.75rem',
            padding: '1.25rem',
            marginBottom: '1.25rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.75rem',
              marginBottom: '1rem',
            }}
          >
            {/* Pestañas de Tablas */}
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {datosEjemplo.tablas.map((t) => {
                const esActiva = t.tabla === tablaSeleccionada;
                return (
                  <button
                    key={t.tabla}
                    type="button"
                    className={`btn btn-xs ${esActiva ? 'btn-primary' : 'btn-secondary'}`}
                    style={{
                      borderRadius: '0.4rem',
                      padding: '0.35rem 0.75rem',
                      fontSize: '0.82rem',
                    }}
                    onClick={() => setTablaActiva(t.tabla)}
                    data-testid={`tab-table-${t.tabla}`}
                  >
                    <strong>{t.tabla}</strong> ({t.filas.length})
                  </button>
                );
              })}
            </div>

            {datosTablaActual && (
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                style={{ fontSize: '0.78rem' }}
                onClick={() => handleDescargarCSVTabla(datosTablaActual)}
                data-testid="btn-descargar-csv-tabla"
              >
                📥 Descargar {datosTablaActual.tabla}.csv
              </button>
            )}
          </div>

          {/* Tabla Responsive de Filas */}
          {datosTablaActual ? (
            <div className="table-responsive" style={{ maxHeight: '340px', overflowY: 'auto' }}>
              <table className="model-table" data-testid="sample-data-table">
                <thead>
                  <tr>
                    {columnasVisibles.map((col) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {datosTablaActual.filas.map((fila, idx) => (
                    <tr key={idx}>
                      {columnasVisibles.map((col) => (
                        <td key={col} style={{ fontSize: '0.82rem' }}>
                          {fila[col] === null || fila[col] === undefined ? (
                            <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                              NULL
                            </span>
                          ) : typeof fila[col] === 'boolean' ? (
                            fila[col] ? '1 (true)' : '0 (false)'
                          ) : (
                            String(fila[col])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="form-help">Seleccioná una tabla para visualizar sus datos de prueba.</p>
          )}
        </div>
      )}

      {/* Navegación Inferior Unificada */}
      <div className="button-group" style={{ marginTop: '1.5rem' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onVolverPaso6}
          data-testid="btn-volver-paso6"
        >
          ← Volver al Paso 6 (DDL y Motor)
        </button>

        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            if (!datosEjemplo && onGenerarDatosLocales) {
              onGenerarDatosLocales(cantidadFilas);
            }
            onConfirmarDatos();
          }}
          data-testid="btn-confirmar-datos"
        >
          {datosConfirmados
            ? '✓ Datos Confirmados (Avanzar al Paso 8: Informes)'
            : datosEjemplo
            ? 'Confirmar Datos y Avanzar al Paso 8 (Informes) →'
            : 'Continuar al Paso 8 (Informes con datos rápidos) →'}
        </button>
      </div>
    </section>
  );
}
