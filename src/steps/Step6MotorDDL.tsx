import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AccionClaveForanea,
  ExplicacionDDL,
  Modelo,
  MotorBaseDatos,
  OpcionesGeneracionDDL,
} from '../core/schemas';
import { LISTA_MOTORES } from '../core/ddl/types';
import { generarDDLSQLite, validarScriptSQLite } from '../core/ddl/sqlite';
import { generarDDLPostgres, validarScriptPostgres } from '../core/ddl/postgres';
import { generarDDLMySQL, validarScriptMySQL } from '../core/ddl/mysql';
import { generarScriptMongo, validarScriptMongo } from '../core/ddl/mongo';
import { obtenerClientePostgres } from '../core/workers/postgresClient';
import { descargarArchivo } from '../export/svg';

export interface Step6MotorDDLProps {
  modelo: Modelo;
  motorSeleccionado?: MotorBaseDatos;
  opcionesDDL?: OpcionesGeneracionDDL;
  explicacionDDL?: ExplicacionDDL;
  ddlConfirmado: boolean;
  cargandoIA?: boolean;
  onCambiarMotor: (motor: MotorBaseDatos) => void;
  onActualizarOpcionesDDL: (opciones: OpcionesGeneracionDDL) => void;
  onPedirExplicacionIA: (ddlActual: string) => Promise<void>;
  onConfirmarDDL: (ddlActual: string) => void;
  onVolverPaso5: () => void;
  onRegistrarDecision?: (
    descripcion: string,
    origen: 'estudiante' | 'ia_aceptada' | 'ia_rechazada'
  ) => void;
}

const OPCIONES_FK: readonly {
  valor: AccionClaveForanea;
  etiqueta: string;
  descripcion: string;
}[] = [
  {
    valor: 'CASCADE',
    etiqueta: 'CASCADE (En cascada)',
    descripcion:
      'Si se borra o actualiza la fila padre, se borran o actualizan automáticamente las filas hijas asociadas.',
  },
  {
    valor: 'RESTRICT',
    etiqueta: 'RESTRICT (Restricción estricta)',
    descripcion:
      'Impide borrar o modificar la fila padre si existen filas hijas que la referencian.',
  },
  {
    valor: 'SET NULL',
    etiqueta: 'SET NULL (Poner en nulo)',
    descripcion:
      'Si se borra el padre, la clave foránea en el hijo se establece en NULL (requiere que la columna sea opcional).',
  },
  {
    valor: 'NO ACTION',
    etiqueta: 'NO ACTION (Sin acción inmediata)',
    descripcion:
      'No ejecuta acción automática y valida la restricción al finalizar la transacción.',
  },
] as const;

export function Step6MotorDDL({
  modelo,
  motorSeleccionado = 'sqlite',
  opcionesDDL = {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    incluirComentarios: true,
    habilitarClavesForaneas: true,
  },
  explicacionDDL,
  ddlConfirmado,
  cargandoIA = false,
  onCambiarMotor,
  onActualizarOpcionesDDL,
  onPedirExplicacionIA,
  onConfirmarDDL,
  onVolverPaso5,
  onRegistrarDecision,
}: Step6MotorDDLProps) {
  const titleId = useId();
  const [copiado, setCopiado] = useState<boolean>(false);
  const [pestañaActiva, setPestañaActiva] = useState<'codigo' | 'explicacion'>('codigo');
  const explicacionRef = useRef<HTMLDivElement | null>(null);

  // Estado para la prueba de ejecución en PostgreSQL (PGlite)
  const [probandoPostgres, setProbandoPostgres] = useState<boolean>(false);
  const [resultadoPostgres, setResultadoPostgres] = useState<{
    exito: boolean;
    mensaje: string;
    tablas?: string[];
  } | null>(null);

  // Si se genera la explicación, conmutar a la vista de explicación automáticamente
  useEffect(() => {
    if (explicacionDDL) {
      setPestañaActiva('explicacion');
      if (typeof explicacionRef.current?.scrollIntoView === 'function') {
        explicacionRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [explicacionDDL]);

  // Generación determinística del DDL / script según el motor seleccionado
  const ddlGenerado = useMemo(() => {
    switch (motorSeleccionado) {
      case 'postgresql':
        return generarDDLPostgres(modelo, opcionesDDL);
      case 'mysql':
        return generarDDLMySQL(modelo, opcionesDDL);
      case 'mongodb':
        return generarScriptMongo(modelo, opcionesDDL);
      case 'sqlite':
      default:
        return generarDDLSQLite(modelo, opcionesDDL);
    }
  }, [motorSeleccionado, modelo, opcionesDDL]);

  // Validación de sintaxis con el parser AST según dialecto o validador mongosh
  const validacionAST = useMemo(() => {
    switch (motorSeleccionado) {
      case 'postgresql':
        return validarScriptPostgres(ddlGenerado);
      case 'mysql':
        return validarScriptMySQL(ddlGenerado);
      case 'mongodb':
        return validarScriptMongo(ddlGenerado);
      case 'sqlite':
      default:
        return validarScriptSQLite(ddlGenerado);
    }
  }, [motorSeleccionado, ddlGenerado]);

  const nombreArchivoScript =
    motorSeleccionado === 'mongodb'
      ? 'esquema_mongodb.js'
      : `esquema_${motorSeleccionado}.sql`;
  const mimeArchivo =
    motorSeleccionado === 'mongodb' ? 'application/javascript' : 'application/sql';

  const handleCopiarDDL = async () => {
    try {
      await navigator.clipboard.writeText(ddlGenerado);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
      onRegistrarDecision?.(
        `Copió el script de ${motorSeleccionado.toUpperCase()} generado al portapapeles.`,
        'estudiante'
      );
    } catch {
      setCopiado(false);
    }
  };

  const handleDescargarSQL = () => {
    descargarArchivo(ddlGenerado, nombreArchivoScript, mimeArchivo);
    onRegistrarDecision?.(
      `Descargó el script de creación en ${motorSeleccionado.toUpperCase()} (${nombreArchivoScript}).`,
      'estudiante'
    );
  };

  const handlePedirExplicacion = async () => {
    setPestañaActiva('explicacion');
    try {
      await onPedirExplicacionIA(ddlGenerado);
    } catch {
      // El error se notifica en el panel central de estado
    }
  };

  const handleProbarEnPostgres = async () => {
    setProbandoPostgres(true);
    setResultadoPostgres(null);
    try {
      const clientePG = obtenerClientePostgres();
      await clientePG.ejecutarDDL(ddlGenerado);
      const listaTablas = await clientePG.obtenerListaTablas();
      setResultadoPostgres({
        exito: true,
        mensaje: `¡Base de datos PostgreSQL inicializada con éxito en el navegador mediante PGlite! Se crearon ${listaTablas.length} tablas en el catálogo:`,
        tablas: listaTablas,
      });
      onRegistrarDecision?.(
        `Ejecutó y validó el DDL en PostgreSQL real (PGlite en WebAssembly), creando ${listaTablas.length} tablas.`,
        'estudiante'
      );
    } catch (err) {
      setResultadoPostgres({
        exito: false,
        mensaje: `Error al ejecutar DDL en PostgreSQL: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    } finally {
      setProbandoPostgres(false);
    }
  };

  return (
    <section
      className="card studio-step-card"
      aria-labelledby={titleId}
      data-testid="step6-container"
    >
      {/* Encabezado Unificado del Paso */}
      <div className="step-header">
        <span className="step-badge">Paso 6 de 8</span>
        <div>
          <h2 id={titleId} className="card-title">
            6. Motor de Base de Datos y Generación de DDL / Esquema
          </h2>
          <p className="step-lead">
            Generamos el script de creación de tablas o colecciones determinísticamente a partir del
            modelo conceptual confirmado. Podés elegir entre motores relacionales (SQLite en WASM,
            PostgreSQL en PGlite WASM o MySQL para InnoDB) o el paradigma NoSQL documental (MongoDB mongosh).
          </p>
        </div>
      </div>

      {/* Caja Conceptual Pedagógica */}
      <details className="concept-box" data-testid="step6-concept-box">
        <summary className="concept-summary">
          💡 Explicación breve del concepto: ¿Qué es DDL y cómo varían los dialectos relacionales y NoSQL?
        </summary>
        <div className="concept-content">
          <p>
            <strong>DDL (Data Definition Language) y Esquemas de Datos:</strong> Es el conjunto de
            sentencias y directivas que se utiliza para definir la estructura, tipos de datos y
            restricciones de una base de datos.
          </p>
          <ul>
            <li>
              <strong>SQLite (sql.js en navegador):</strong> Tipado dinámico con afinidad. Las fechas
              se almacenan como <code>TEXT</code> en formato ISO-8601 (<code>YYYY-MM-DD</code>).
              Requiere <code>PRAGMA foreign_keys = ON;</code> para activar la validación referencial.
            </li>
            <li>
              <strong>PostgreSQL (PGlite en navegador):</strong> Estándar empresarial con tipado
              estricto nativo. Soporta <code>SERIAL</code> para secuencias autoincrementales,{' '}
              <code>NUMERIC(10, 2)</code> para importes monetarios exactos, <code>DATE</code>,{' '}
              <code>TIMESTAMP</code> y <code>BOOLEAN</code> nativo. Se ejecuta de forma real en tu
              navegador con WebAssembly.
            </li>
            <li>
              <strong>MySQL (Script InnoDB):</strong> Muy popular en la web. Emplea el motor
              transaccional <code>ENGINE=InnoDB</code>, <code>AUTO_INCREMENT</code> para claves
              primarias, y juego de caracteres <code>utf8mb4</code> para soporte completo de Unicode
              y emojis. Al ser un motor cliente/servidor tradicional, DB Tutor genera y valida el
              script para que lo importes en phpMyAdmin o MySQL Workbench.
            </li>
            <li>
              <strong>MongoDB (mongosh / NoSQL Documental):</strong> Rompe la rigidez tabular. Los datos
              se guardan como colecciones de documentos BSON (JSON binario). En entornos formales, se
              utilizan validadores <code>$jsonSchema</code> para forzar tipos y campos obligatorios.
              El desafío pedagógico central es decidir entre <strong>Embeber</strong> (subdocumentos para
              acceso atómico) o <strong>Referenciar</strong> (con IDs e índices para colecciones independientes,
              consultadas con <code>$lookup</code>).
            </li>
          </ul>
        </div>
      </details>

      {/* Selector de Motor de Base de Datos */}
      <div className="motor-selector-block" style={{ marginBottom: '1.25rem' }}>
        <h3 className="section-subtitle" style={{ marginBottom: '0.6rem' }}>
          Seleccioná el motor de base de datos objetivo:
        </h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '0.85rem',
          }}
        >
          {LISTA_MOTORES.map((motor) => {
            const esActivo = motorSeleccionado === motor.id;
            return (
              <div
                key={motor.id}
                role="button"
                tabIndex={motor.disponible ? 0 : -1}
                aria-pressed={esActivo}
                onClick={() => motor.disponible && onCambiarMotor(motor.id)}
                onKeyDown={(e) => {
                  if (motor.disponible && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onCambiarMotor(motor.id);
                  }
                }}
                className={`motor-card ${esActivo ? 'motor-card-active' : ''} ${
                  !motor.disponible ? 'motor-card-disabled' : ''
                }`}
                style={{
                  background: esActivo ? 'rgba(56, 189, 248, 0.1)' : 'var(--bg-surface)',
                  border: esActivo
                    ? '2px solid var(--accent-cyan)'
                    : '1px solid var(--border-color)',
                  borderRadius: '0.75rem',
                  padding: '1rem',
                  cursor: motor.disponible ? 'pointer' : 'not-allowed',
                  opacity: motor.disponible ? 1 : 0.65,
                  transition: 'all 0.2s ease',
                }}
                data-testid={`motor-option-${motor.id}`}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.4rem',
                  }}
                >
                  <strong
                    style={{
                      fontSize: '1.05rem',
                      color: esActivo ? 'var(--accent-cyan)' : 'var(--text-main)',
                    }}
                  >
                    {motor.nombre}
                  </strong>
                  <span
                    className="badge"
                    style={{
                      fontSize: '0.72rem',
                      padding: '0.15rem 0.45rem',
                      borderRadius: '0.3rem',
                      background: motor.disponible
                        ? 'rgba(16, 185, 129, 0.2)'
                        : 'rgba(148, 163, 184, 0.15)',
                      color: motor.disponible ? '#6ee7b7' : '#94a3b8',
                      fontWeight: 600,
                    }}
                  >
                    {motor.disponible
                      ? motor.ejecutableEnNavegador
                        ? '🟢 WASM Navegador'
                        : '📄 Script Exportable'
                      : `Fase ${motor.fase}`}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: '0.78rem',
                    color: '#38bdf8',
                    fontWeight: 600,
                    marginBottom: '0.3rem',
                  }}
                >
                  {motor.etiqueta}
                </div>
                <p
                  style={{
                    margin: '0 0 0.5rem',
                    fontSize: '0.82rem',
                    color: 'var(--text-muted)',
                  }}
                >
                  {motor.descripcion}
                </p>
                <div style={{ fontSize: '0.76rem', color: '#93c5fd' }}>
                  ⚙️ {motor.tecnologiaNavegador ?? 'Generación de script estático'}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Banner Informativo pedagógico específico para PostgreSQL (PGlite WASM) */}
      {motorSeleccionado === 'postgresql' && (
        <div
          className="info-box"
          style={{
            background: 'rgba(56, 189, 248, 0.1)',
            border: '1px solid rgba(56, 189, 248, 0.4)',
            borderRadius: '0.75rem',
            padding: '0.85rem 1.1rem',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
          }}
          data-testid="postgres-info-banner"
        >
          <span style={{ fontSize: '1.4rem' }}>⚡</span>
          <div>
            <strong style={{ color: '#38bdf8', fontSize: '0.92rem' }}>
              Ejecución Real en el Navegador con PGlite (WebAssembly):
            </strong>
            <p
              style={{
                margin: '0.25rem 0 0.5rem',
                fontSize: '0.83rem',
                color: '#bae6fd',
                lineHeight: 1.45,
              }}
            >
              <strong>¿Qué es PGlite?</strong> Es el motor oficial completo de <strong>PostgreSQL</strong> (compilado directamente desde su código fuente en C a WebAssembly / WASM). Te permite correr un servidor PostgreSQL real 100% dentro de tu navegador web, sin instalar Docker, sin configurar servidores y sin enviar datos a la nube.
            </p>
            <p
              style={{
                margin: '0',
                fontSize: '0.83rem',
                color: '#e0f2fe',
                lineHeight: 1.45,
              }}
            >
              <strong>¿Dónde lo ves en acción?</strong> Hacé clic en el botón{' '}
              <strong style={{ color: '#38bdf8' }}>"⚡ Probar en PostgreSQL (PGlite WASM)"</strong> en la barra de herramientas. DB Tutor inicializará la instancia de Postgres en un Web Worker aislado, ejecutará este script DDL con tipos estrictos (<code>SERIAL</code>, <code>NUMERIC</code>, <code>DATE</code>, <code>BOOLEAN</code>) y consultará el catálogo del sistema <code>information_schema.tables</code> para listar las tablas creadas en tiempo real.
            </p>
          </div>
        </div>
      )}

      {/* Banner Informativo específico para MySQL si está seleccionado */}
      {motorSeleccionado === 'mysql' && (
        <div
          className="info-box"
          style={{
            background: 'rgba(234, 179, 8, 0.1)',
            border: '1px solid rgba(234, 179, 8, 0.4)',
            borderRadius: '0.75rem',
            padding: '0.85rem 1.1rem',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
          }}
          data-testid="mysql-info-banner"
        >
          <span style={{ fontSize: '1.4rem' }}>ℹ️</span>
          <div>
            <strong style={{ color: '#fde047', fontSize: '0.92rem' }}>
              Modo Script para MySQL (ENGINE=InnoDB):
            </strong>
            <p
              style={{
                margin: '0.25rem 0 0',
                fontSize: '0.83rem',
                color: '#fef08a',
                lineHeight: 1.45,
              }}
            >
              MySQL requiere un servidor de base de datos cliente/servidor tradicional. DB Tutor
              genera determinísticamente el script con motor transaccional <code>InnoDB</code>,
              juego de caracteres <code>utf8mb4</code> y claves foráneas, verificado al 100% con
              parser AST. Podés descargarlo o copiarlo para importarlo directamente en phpMyAdmin,
              MySQL Workbench o la consola oficial.
            </p>
          </div>
        </div>
      )}

      {/* Banner Informativo pedagógico específico para MongoDB NoSQL */}
      {motorSeleccionado === 'mongodb' && (
        <div
          className="info-box"
          style={{
            background: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.4)',
            borderRadius: '0.75rem',
            padding: '0.85rem 1.1rem',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
          }}
          data-testid="mongodb-info-banner"
        >
          <span style={{ fontSize: '1.4rem' }}>🍃</span>
          <div>
            <strong style={{ color: '#6ee7b7', fontSize: '0.92rem' }}>
              Modo NoSQL Documental para MongoDB (mongosh / Compass):
            </strong>
            <p
              style={{
                margin: '0.25rem 0 0',
                fontSize: '0.83rem',
                color: '#a7f3d0',
                lineHeight: 1.45,
              }}
            >
              En MongoDB se cambia el paradigma relacional tradicional a colecciones de documentos
              BSON/JSON. DB Tutor genera el script <code>esquema_mongodb.js</code> con validadores
              estrictos <code>$jsonSchema</code> para asegurar tipos y obligatorios, índices
              sugeridos (únicos y de referencia) y un análisis pedagógico exhaustivo de{' '}
              <strong>Embeber vs. Referenciar</strong>. Por limitaciones arquitectónicas de su motor
              nativo C++ (WiredTiger), MongoDB no se ejecuta en el navegador estático; ejecutá el
              script en <code>mongosh</code>, MongoDB Compass o MongoDB Atlas.
            </p>
          </div>
        </div>
      )}

      {/* Opciones Didácticas de Configuración del DDL */}
      <div
        className="ddl-options-card"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          borderRadius: '0.75rem',
          padding: '1rem',
          marginBottom: '1.25rem',
        }}
      >
        <h3 className="section-subtitle" style={{ marginBottom: '0.75rem' }}>
          Configuración pedagógica de Claves Foráneas y Comentarios:
        </h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '1rem',
          }}
        >
          <div>
            <label htmlFor="select-on-delete" className="form-label-sm">
              ON DELETE (Al eliminar el padre):
            </label>
            <select
              id="select-on-delete"
              className="form-control"
              value={opcionesDDL.onDelete}
              onChange={(e) =>
                onActualizarOpcionesDDL({
                  ...opcionesDDL,
                  onDelete: e.target.value as AccionClaveForanea,
                })
              }
              data-testid="select-on-delete"
            >
              {OPCIONES_FK.map((opt) => (
                <option key={opt.valor} value={opt.valor}>
                  {opt.etiqueta}
                </option>
              ))}
            </select>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.3rem 0 0' }}>
              {OPCIONES_FK.find((o) => o.valor === opcionesDDL.onDelete)?.descripcion}
            </p>
          </div>

          <div>
            <label htmlFor="select-on-update" className="form-label-sm">
              ON UPDATE (Al actualizar el padre):
            </label>
            <select
              id="select-on-update"
              className="form-control"
              value={opcionesDDL.onUpdate}
              onChange={(e) =>
                onActualizarOpcionesDDL({
                  ...opcionesDDL,
                  onUpdate: e.target.value as AccionClaveForanea,
                })
              }
              data-testid="select-on-update"
            >
              {OPCIONES_FK.map((opt) => (
                <option key={opt.valor} value={opt.valor}>
                  {opt.etiqueta}
                </option>
              ))}
            </select>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.3rem 0 0' }}>
              {OPCIONES_FK.find((o) => o.valor === opcionesDDL.onUpdate)?.descripcion}
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              justifyContent: 'center',
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              <input
                type="checkbox"
                checked={opcionesDDL.incluirComentarios}
                onChange={(e) =>
                  onActualizarOpcionesDDL({
                    ...opcionesDDL,
                    incluirComentarios: e.target.checked,
                  })
                }
                data-testid="toggle-comments"
              />
              <span>Incluir comentarios didácticos en el SQL</span>
            </label>

            {motorSeleccionado === 'sqlite' && (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                <input
                  type="checkbox"
                  checked={opcionesDDL.habilitarClavesForaneas}
                  onChange={(e) =>
                    onActualizarOpcionesDDL({
                      ...opcionesDDL,
                      habilitarClavesForaneas: e.target.checked,
                    })
                  }
                  data-testid="toggle-fk-pragma"
                />
                <span>
                  Incluir directiva <code>PRAGMA foreign_keys = ON;</code>
                </span>
              </label>
            )}
          </div>
        </div>
      </div>

      {/* Validación AST y Métricas */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.5rem',
          marginBottom: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {validacionAST.valido ? (
            <span
              className="badge"
              style={{
                background: 'rgba(16, 185, 129, 0.15)',
                color: '#6ee7b7',
                padding: '0.3rem 0.6rem',
                borderRadius: '0.35rem',
                fontSize: '0.8rem',
                fontWeight: 600,
              }}
              data-testid="ast-validation-success"
            >
              ✓ Script {motorSeleccionado.toUpperCase()} validado{' '}
              {motorSeleccionado === 'mongodb' ? '(Sintaxis y $jsonSchema)' : 'por parser AST'}
            </span>
          ) : (
            <span
              className="badge"
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#fca5a5',
                padding: '0.3rem 0.6rem',
                borderRadius: '0.35rem',
                fontSize: '0.8rem',
                fontWeight: 600,
              }}
              data-testid="ast-validation-error"
            >
              ⚠️ Advertencia {motorSeleccionado === 'mongodb' ? 'Sintaxis MongoDB' : 'AST'}:{' '}
              {validacionAST.error}
            </span>
          )}
          <span className="tech-chip">
            Motor:{' '}
            {motorSeleccionado === 'postgresql'
              ? 'PostgreSQL (PGlite WASM)'
              : motorSeleccionado === 'mysql'
              ? 'MySQL 8+ (InnoDB Script)'
              : motorSeleccionado === 'mongodb'
              ? 'MongoDB 7+ (mongosh / NoSQL Documental)'
              : 'SQLite 3 (sql.js WASM)'}
          </span>
        </div>
      </div>

      {/* Barra de Herramientas del Código DDL / Script */}
      <div className="toolbar-row" data-testid="step6-toolbar">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleCopiarDDL}
          data-testid="copy-ddl-btn"
        >
          {copiado ? '✓ ¡Script copiado al portapapeles!' : '📋 Copiar Script'}
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleDescargarSQL}
          data-testid="download-sql-btn"
        >
          📥 Descargar {nombreArchivoScript}
        </button>

        {motorSeleccionado === 'postgresql' && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleProbarEnPostgres}
            disabled={probandoPostgres}
            data-testid="test-postgres-btn"
            style={{ borderColor: 'rgba(56, 189, 248, 0.4)', color: '#38bdf8' }}
          >
            {probandoPostgres
              ? '⏳ Ejecutando en PGlite...'
              : '⚡ Probar en PostgreSQL (PGlite WASM)'}
          </button>
        )}

        <button
          type="button"
          className="btn btn-secondary"
          onClick={handlePedirExplicacion}
          disabled={cargandoIA}
          data-testid="ask-ai-explanation-btn"
        >
          {cargandoIA
            ? '⏳ Consultando al Tutor IA...'
            : motorSeleccionado === 'mongodb'
            ? '🎓 Explicar Colecciones y NoSQL con Tutor IA'
            : '🎓 Explicar DDL con Tutor IA'}
        </button>
      </div>

      {/* Notificación de resultado de ejecución en PostgreSQL (PGlite) */}
      {resultadoPostgres && (
        <div
          style={{
            background: resultadoPostgres.exito
              ? 'rgba(16, 185, 129, 0.12)'
              : 'rgba(239, 68, 68, 0.12)',
            border: `1px solid ${
              resultadoPostgres.exito ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'
            }`,
            borderRadius: '0.75rem',
            padding: '1rem 1.25rem',
            marginBottom: '1rem',
            fontSize: '0.85rem',
            color: resultadoPostgres.exito ? '#a7f3d0' : '#fca5a5',
          }}
          data-testid="postgres-execution-result"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '1.2rem' }}>{resultadoPostgres.exito ? '🟢' : '❌'}</span>
            <strong style={{ fontSize: '0.95rem', color: resultadoPostgres.exito ? '#6ee7b7' : '#fca5a5' }}>
              {resultadoPostgres.exito
                ? '¡Instancia real de PostgreSQL (PGlite WASM) activa y ejecutada con éxito!'
                : 'Error al ejecutar en PostgreSQL PGlite:'}
            </strong>
          </div>
          <div>{resultadoPostgres.mensaje}</div>
          {resultadoPostgres.tablas && resultadoPostgres.tablas.length > 0 && (
            <div style={{ marginTop: '0.6rem' }}>
              <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '0.3rem' }}>
                Tablas verificadas en el catálogo del sistema (<code>information_schema.tables</code>):
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {resultadoPostgres.tablas.map((t) => (
                  <span
                    key={t}
                    style={{
                      background: 'rgba(15, 23, 42, 0.7)',
                      padding: '0.2rem 0.6rem',
                      borderRadius: '0.35rem',
                      fontFamily: 'monospace',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      color: '#a7f3d0',
                      border: '1px solid rgba(16, 185, 129, 0.4)',
                    }}
                  >
                    📊 {t}
                  </span>
                ))}
              </div>
              <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: '#6ee7b7' }}>
                💡 Todas las sentencias DDL, tipos estrictos (<code>SERIAL</code>, <code>NUMERIC</code>, <code>BOOLEAN</code>), restricciones <code>CHECK</code> y claves foráneas fueron procesadas y validadas por el motor de PostgreSQL dentro de tu navegador.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Selector de Pestañas: Script SQL vs Explicación Pedagógica */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          marginBottom: '0.75rem',
          borderBottom: '1px solid var(--border-color)',
          paddingBottom: '0.25rem',
        }}
      >
        <button
          type="button"
          className={`btn ${pestañaActiva === 'codigo' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }}
          onClick={() => setPestañaActiva('codigo')}
          data-testid="tab-codigo-ddl"
        >
          {motorSeleccionado === 'mongodb' ? '📝 Ver Script mongosh (.js)' : '📝 Ver Script SQL DDL'}
        </button>
        <button
          type="button"
          className={`btn ${pestañaActiva === 'explicacion' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }}
          onClick={() => setPestañaActiva('explicacion')}
          data-testid="tab-explicacion-ddl"
        >
          🎓 Explicación del Tutor IA {explicacionDDL ? '✓ (Lista)' : ''}
        </button>
      </div>

      {/* Visor de Código SQL DDL / Script mongosh */}
      {pestañaActiva === 'codigo' && (
        <div
          className="code-viewer-container"
          style={{
            background: '#090e1c',
            border: '1px solid var(--border-color)',
            borderRadius: '0.75rem',
            padding: '1.25rem',
            overflowX: 'auto',
            maxHeight: '440px',
            marginBottom: '1.25rem',
            boxShadow: 'inset 0 2px 10px rgba(0, 0, 0, 0.5)',
          }}
        >
          <pre
            style={{
              margin: 0,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: '0.85rem',
              color: '#e2e8f0',
              lineHeight: 1.5,
            }}
            data-testid="ddl-code-display"
          >
            <code>{ddlGenerado}</code>
          </pre>
        </div>
      )}

      {/* Indicador de carga cuando la IA está analizando el DDL / Script */}
      {pestañaActiva === 'explicacion' && cargandoIA && (
        <div
          className="tutor-explanation-box"
          style={{
            marginTop: '0.5rem',
            marginBottom: '1.25rem',
            textAlign: 'center',
            padding: '2rem',
            border: '1px dashed #38bdf8',
          }}
          data-testid="ai-ddl-loading-box"
        >
          <div style={{ fontSize: '1.8rem', marginBottom: '0.6rem' }}>⏳</div>
          <strong style={{ fontSize: '1.05rem', color: 'var(--accent-cyan)' }}>
            El tutor IA está analizando tu script DDL...
          </strong>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            {motorSeleccionado === 'mongodb'
              ? 'Examinando colecciones, validadores $jsonSchema, tipos BSON y la estrategia de embeber vs. referenciar.'
              : `Examinando las sentencias CREATE TABLE, restricciones de clave foránea y tipos de datos de ${motorSeleccionado.toUpperCase()}.`}
          </p>
        </div>
      )}

      {/* Estado si seleccionó la pestaña de explicación pero aún no la pidió */}
      {pestañaActiva === 'explicacion' && !explicacionDDL && !cargandoIA && (
        <div
          className="tutor-explanation-box"
          style={{
            marginTop: '0.5rem',
            marginBottom: '1.25rem',
            textAlign: 'center',
            padding: '1.5rem',
          }}
        >
          <p style={{ margin: '0 0 1rem' }}>
            Todavía no consultaste la explicación pedagógica del script. El tutor IA analizará
            cada {motorSeleccionado === 'mongodb' ? 'colección' : 'tabla'}, tipos de datos y{' '}
            {motorSeleccionado === 'mongodb' ? 'decisiones de embeber vs. referenciar' : 'claves foráneas'} de{' '}
            {motorSeleccionado.toUpperCase()} para explicártela con ejemplos concretos.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handlePedirExplicacion}
            disabled={cargandoIA}
          >
            {motorSeleccionado === 'mongodb'
              ? '🎓 Explicar Colecciones y NoSQL con Tutor IA ahora'
              : '🎓 Explicar DDL con Tutor IA ahora'}
          </button>
        </div>
      )}

      {/* Explicación Pedagógica del Tutor IA si fue solicitada */}
      {explicacionDDL && (
        <div
          ref={explicacionRef}
          className="tutor-explanation-box"
          style={{
            marginTop: pestañaActiva === 'explicacion' ? '0.5rem' : '1.25rem',
            border: '1px solid #38bdf8',
            boxShadow: '0 0 15px rgba(56, 189, 248, 0.15)',
          }}
          data-testid="ai-ddl-explanation-card"
        >
          <strong style={{ fontSize: '1.05rem', color: 'var(--accent-cyan)' }}>
            🎓 Explicación Pedagógica del Tutor IA:
          </strong>
          <p style={{ margin: '0.5rem 0 1rem', fontSize: '0.92rem', lineHeight: 1.5 }}>
            {explicacionDDL.resumenPedagogico}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {explicacionDDL.explicacionPorTabla.map((exp, idx) => (
              <div
                key={idx}
                style={{
                  background: 'rgba(15, 23, 42, 0.7)',
                  borderRadius: '0.5rem',
                  padding: '0.75rem 1rem',
                  border: '1px solid rgba(56, 189, 248, 0.2)',
                }}
              >
                <div style={{ fontWeight: 700, color: '#93c5fd', marginBottom: '0.25rem' }}>
                  {motorSeleccionado === 'mongodb' ? 'Colección:' : 'Tabla:'} <code>{exp.tabla}</code>
                </div>
                <p style={{ margin: '0 0 0.4rem', fontSize: '0.86rem' }}>{exp.explicacion}</p>
                <div style={{ fontSize: '0.8rem', color: '#86efac' }}>
                  🔑 <strong>{motorSeleccionado === 'mongodb' ? 'Validación y Relaciones:' : 'Claves y Relaciones:'}</strong> {exp.detalleClaves}
                </div>
              </div>
            ))}
          </div>

          {explicacionDDL.observacionesTutor.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <div
                style={{
                  fontWeight: 700,
                  color: '#fde047',
                  marginBottom: '0.35rem',
                  fontSize: '0.85rem',
                }}
              >
                💡 Consejos prácticos del tutor para {motorSeleccionado.toUpperCase()}:
              </div>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: '1.2rem',
                  fontSize: '0.84rem',
                  color: '#cbd5e1',
                }}
              >
                {explicacionDDL.observacionesTutor.map((obs, idx) => (
                  <li key={idx}>{obs}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Navegación Inferior Unificada */}
      <div className="button-group" style={{ marginTop: '1.5rem' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onVolverPaso5}
          data-testid="btn-volver-paso5"
        >
          ← Volver al Paso 5 (Diagrama ER)
        </button>

        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onConfirmarDDL(ddlGenerado)}
          data-testid="btn-confirmar-ddl"
        >
          {ddlConfirmado
            ? '✓ Esquema Confirmado (Avanzar al Paso 7: Datos de Ejemplo)'
            : 'Confirmar Esquema y Avanzar al Paso 7 (Datos de Ejemplo) →'}
        </button>
      </div>
    </section>
  );
}
