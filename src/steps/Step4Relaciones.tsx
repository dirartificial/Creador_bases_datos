import React, { useEffect, useMemo, useState } from 'react';
import { Cardinalidad, Modelo, Relacion, RespuestaExplicacionObservaciones } from '../core/schemas';
import {
  crearTablaIntermediaParaNM,
  normalizarNombre,
  obtenerNombreAtributoFKPropuesto,
  resolverFKFaltante,
  validarModelo,
} from '../core/modelValidator';
import { buscarAtributoFK } from '../core/ddl/common';

export interface Step4RelacionesProps {
  modelo: Modelo;
  relacionesConfirmadas: boolean;
  explicacionRelaciones?: string;
  cargando: boolean;
  onActualizarModelo: (
    nuevoModelo: Modelo,
    decision?: { descripcion: string; origen: 'estudiante' | 'ia_aceptada' | 'ia_rechazada' }
  ) => void;
  onSugerirConIA: () => Promise<void>;
  onPedirExplicacionIA: () => Promise<void>;
  explicacionesIA: RespuestaExplicacionObservaciones | null;
  onConfirmarRelaciones: () => void;
  onVolverPaso3: () => void;
}

export function Step4Relaciones({
  modelo,
  relacionesConfirmadas,
  explicacionRelaciones,
  cargando,
  onActualizarModelo,
  onSugerirConIA,
  onPedirExplicacionIA,
  explicacionesIA,
  onConfirmarRelaciones,
  onVolverPaso3,
}: Step4RelacionesProps) {
  const [indiceEditando, setIndiceEditando] = useState<number | null>(null);

  // Estado del formulario de relación (nueva o edición)
  const [formOrigen, setFormOrigen] = useState<string>(() => modelo.entidades[0]?.nombre || '');
  const [formDestino, setFormDestino] = useState<string>(
    () => modelo.entidades[1]?.nombre || modelo.entidades[0]?.nombre || ''
  );
  const [formCardinalidad, setFormCardinalidad] = useState<Cardinalidad>('1:N');
  const [formCampoOrigen, setFormCampoOrigen] = useState<string>('');
  const [formCampoDestino, setFormCampoDestino] = useState<string>('');
  const [formDescripcion, setFormDescripcion] = useState<string>('');
  const [formObligatoriaOrigen, setFormObligatoriaOrigen] = useState<boolean>(false);
  const [formObligatoriaDestino, setFormObligatoriaDestino] = useState<boolean>(true);
  const [errorFormulario, setErrorFormulario] = useState<string | null>(null);

  // Sincronizar selectores si cambian las entidades del modelo en el Paso 3
  useEffect(() => {
    if (modelo.entidades.length === 0) return;
    const existeOrigen = modelo.entidades.some((e) => e.nombre === formOrigen);
    if (!existeOrigen) {
      setFormOrigen(modelo.entidades[0]?.nombre || '');
    }
    const existeDestino = modelo.entidades.some((e) => e.nombre === formDestino);
    if (!existeDestino) {
      setFormDestino(modelo.entidades[1]?.nombre || modelo.entidades[0]?.nombre || '');
    }
  }, [modelo.entidades, formOrigen, formDestino]);

  const entidadOrigenSeleccionada = useMemo(
    () => modelo.entidades.find((e) => normalizarNombre(e.nombre) === normalizarNombre(formOrigen)),
    [modelo.entidades, formOrigen]
  );

  const entidadDestinoSeleccionada = useMemo(
    () => modelo.entidades.find((e) => normalizarNombre(e.nombre) === normalizarNombre(formDestino)),
    [modelo.entidades, formDestino]
  );

  const pkOrigenDetectada = useMemo(
    () =>
      entidadOrigenSeleccionada?.atributos.find((a) => a.esClavePrimaria) ||
      entidadOrigenSeleccionada?.atributos[0],
    [entidadOrigenSeleccionada]
  );

  const fkDetectadaAutomatica = useMemo(() => {
    if (!entidadOrigenSeleccionada || !entidadDestinoSeleccionada) return null;
    return buscarAtributoFK(entidadDestinoSeleccionada, entidadOrigenSeleccionada);
  }, [entidadOrigenSeleccionada, entidadDestinoSeleccionada]);

  const nombreFKPropuestoParaDestino = useMemo(() => {
    if (!entidadOrigenSeleccionada) return 'id_origen';
    return obtenerNombreAtributoFKPropuesto(entidadOrigenSeleccionada);
  }, [entidadOrigenSeleccionada]);

  // Validación determinística en tiempo real
  const resultadoValidacion = useMemo(() => validarModelo(modelo), [modelo]);

  const iniciarEdicion = (idx: number) => {
    const rel = modelo.relaciones[idx];
    if (!rel) return;
    setIndiceEditando(idx);
    setFormOrigen(rel.origen);
    setFormDestino(rel.destino);
    setFormCardinalidad(rel.cardinalidad);
    setFormCampoOrigen(rel.campoOrigen || '');
    setFormCampoDestino(rel.campoDestino || '');
    setFormDescripcion(rel.descripcion);
    setFormObligatoriaOrigen(rel.obligatoriaEnOrigen);
    setFormObligatoriaDestino(rel.obligatoriaEnDestino);
    setErrorFormulario(null);
  };

  const cancelarEdicion = () => {
    setIndiceEditando(null);
    setFormCampoOrigen('');
    setFormCampoDestino('');
    setFormDescripcion('');
    setErrorFormulario(null);
  };

  const handleGuardarRelacion = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorFormulario(null);

    const descLimpia = formDescripcion.trim();
    if (!descLimpia) {
      setErrorFormulario('Escribí una descripción en lenguaje natural de la relación.');
      return;
    }

    if (!formOrigen || !formDestino) {
      setErrorFormulario('Seleccioná ambas entidades para establecer la relación.');
      return;
    }

    let entidadesActualizadas = modelo.entidades;
    let campoOrigenFinal: string | undefined = undefined;
    let campoDestinoFinal: string | undefined = undefined;

    if (formCardinalidad !== 'N:M') {
      campoOrigenFinal = formCampoOrigen.trim() || pkOrigenDetectada?.nombre || undefined;

      if (formCampoDestino === '__crear_fk__' && entidadOrigenSeleccionada && entidadDestinoSeleccionada) {
        const nombreNuevoFK = nombreFKPropuestoParaDestino;
        const attrRefOrigen =
          entidadOrigenSeleccionada.atributos.find(
            (a) => normalizarNombre(a.nombre) === normalizarNombre(campoOrigenFinal || '')
          ) || pkOrigenDetectada;
        const tipoFK = attrRefOrigen?.tipoConceptual ?? 'entero';

        entidadesActualizadas = modelo.entidades.map((ent) => {
          if (normalizarNombre(ent.nombre) !== normalizarNombre(entidadDestinoSeleccionada.nombre)) {
            return ent;
          }
          const yaExiste = ent.atributos.some(
            (a) => normalizarNombre(a.nombre) === normalizarNombre(nombreNuevoFK)
          );
          if (yaExiste) return ent;
          return {
            ...ent,
            atributos: [
              ...ent.atributos,
              {
                nombre: nombreNuevoFK,
                tipoConceptual: tipoFK,
                obligatorio: formObligatoriaOrigen,
                unico: formCardinalidad === '1:1',
                esClavePrimaria: false,
                justificacion: `Clave foránea (FK) que referencia al campo "${
                  campoOrigenFinal || 'id'
                }" de la tabla "${entidadOrigenSeleccionada.nombre}".`,
              },
            ],
          };
        });
        campoDestinoFinal = nombreNuevoFK;
      } else {
        campoDestinoFinal =
          formCampoDestino.trim() || fkDetectadaAutomatica?.atributoLocal || undefined;
      }
    }

    const nuevaRel: Relacion = {
      origen: formOrigen,
      destino: formDestino,
      cardinalidad: formCardinalidad,
      descripcion: descLimpia,
      obligatoriaEnOrigen: formObligatoriaOrigen,
      obligatoriaEnDestino: formObligatoriaDestino,
      ...(campoOrigenFinal ? { campoOrigen: campoOrigenFinal } : {}),
      ...(campoDestinoFinal ? { campoDestino: campoDestinoFinal } : {}),
    };

    let relacionesActualizadas: Relacion[];
    let descripcionDecision = '';

    const detalleCampos =
      campoOrigenFinal && campoDestinoFinal
        ? ` vinculando ${nuevaRel.origen}.${campoOrigenFinal} → ${nuevaRel.destino}.${campoDestinoFinal} (FK)`
        : '';

    if (indiceEditando !== null) {
      relacionesActualizadas = modelo.relaciones.map((r, i) =>
        i === indiceEditando ? nuevaRel : r
      );
      descripcionDecision = `Modificó la relación entre ${nuevaRel.origen} y ${nuevaRel.destino} (${nuevaRel.cardinalidad})${detalleCampos}.`;
      setIndiceEditando(null);
    } else {
      relacionesActualizadas = [...modelo.relaciones, nuevaRel];
      descripcionDecision = `Agregó relación: ${nuevaRel.origen} (${nuevaRel.cardinalidad}) ${nuevaRel.destino}${detalleCampos} - "${nuevaRel.descripcion}".`;
    }

    setFormCampoOrigen('');
    setFormCampoDestino('');
    setFormDescripcion('');
    onActualizarModelo(
      {
        ...modelo,
        entidades: entidadesActualizadas,
        relaciones: relacionesActualizadas,
      },
      {
        descripcion: descripcionDecision,
        origen: 'estudiante',
      }
    );
  };

  const handleCambiarCampoForaneoInline = (idx: number, valorSeleccionado: string) => {
    const rel = modelo.relaciones[idx];
    if (!rel) return;

    const entOrigen = modelo.entidades.find(
      (e) => normalizarNombre(e.nombre) === normalizarNombre(rel.origen)
    );
    const entDestino = modelo.entidades.find(
      (e) => normalizarNombre(e.nombre) === normalizarNombre(rel.destino)
    );
    if (!entOrigen || !entDestino) return;

    const pkOrigen = entOrigen.atributos.find((a) => a.esClavePrimaria) || entOrigen.atributos[0];
    const campoOrigenActual = rel.campoOrigen || pkOrigen?.nombre || 'id';

    if (valorSeleccionado === '__crear_fk__') {
      const modeloConFK = resolverFKFaltante(modelo, entDestino.nombre, entOrigen.nombre);
      onActualizarModelo(modeloConFK, {
        descripcion: `Creó y vinculó automáticamente el campo foráneo en "${entDestino.nombre}" hacia "${entOrigen.nombre}".`,
        origen: 'estudiante',
      });
      return;
    }

    const relacionesActualizadas = modelo.relaciones.map((r, i) => {
      if (i !== idx) return r;
      return {
        ...r,
        campoOrigen: campoOrigenActual,
        campoDestino: valorSeleccionado || undefined,
      };
    });

    onActualizarModelo(
      {
        ...modelo,
        relaciones: relacionesActualizadas,
      },
      {
        descripcion: valorSeleccionado
          ? `Seleccionó el campo "${valorSeleccionado}" en "${rel.destino}" como clave foránea (FK) vinculada con "${rel.origen}.${campoOrigenActual}".`
          : `Restableció detección automática de clave foránea entre "${rel.origen}" y "${rel.destino}".`,
        origen: 'estudiante',
      }
    );
  };

  const handleCambiarCampoOrigenInline = (idx: number, nuevoCampoOrigen: string) => {
    const rel = modelo.relaciones[idx];
    if (!rel) return;

    const relacionesActualizadas = modelo.relaciones.map((r, i) => {
      if (i !== idx) return r;
      return {
        ...r,
        campoOrigen: nuevoCampoOrigen || undefined,
      };
    });

    onActualizarModelo(
      {
        ...modelo,
        relaciones: relacionesActualizadas,
      },
      {
        descripcion: `Seleccionó el campo "${nuevoCampoOrigen}" en "${rel.origen}" como campo referenciado por "${rel.destino}".`,
        origen: 'estudiante',
      }
    );
  };

  const handleEliminarRelacion = (idx: number) => {
    const relAEliminar = modelo.relaciones[idx];
    if (!relAEliminar) return;

    const relacionesRestantes = modelo.relaciones.filter((_, i) => i !== idx);
    onActualizarModelo(
      {
        ...modelo,
        relaciones: relacionesRestantes,
      },
      {
        descripcion: `Eliminó la relación entre ${relAEliminar.origen} y ${relAEliminar.destino}.`,
        origen: 'estudiante',
      }
    );

    if (indiceEditando === idx) {
      cancelarEdicion();
    }
  };

  const handleAplicarAccionRapida = (obs: (typeof resultadoValidacion.observaciones)[0]) => {
    if (!obs.accionRapida) return;

    if (obs.accionRapida.tipo === 'crear_tabla_intermedia' && obs.accionRapida.relacion) {
      const modeloActualizado = crearTablaIntermediaParaNM(modelo, obs.accionRapida.relacion);
      onActualizarModelo(modeloActualizado, {
        descripcion: `Aplicó solución rápida: descompuso relación N:M entre ${obs.accionRapida.relacion.origen} y ${obs.accionRapida.relacion.destino} creando tabla asociativa.`,
        origen: 'estudiante',
      });
    } else if (
      obs.accionRapida.tipo === 'agregar_fk' &&
      obs.accionRapida.entidadDestino &&
      obs.accionRapida.entidadOrigen
    ) {
      const modeloActualizado = resolverFKFaltante(
        modelo,
        obs.accionRapida.entidadDestino,
        obs.accionRapida.entidadOrigen
      );
      onActualizarModelo(modeloActualizado, {
        descripcion: `Aplicó solución rápida: agregó clave foránea en "${obs.accionRapida.entidadDestino}" referenciando a "${obs.accionRapida.entidadOrigen}".`,
        origen: 'estudiante',
      });
    }
  };

  return (
    <section
      className="card studio-step-card"
      aria-labelledby="step4-title"
      data-testid="step4-container"
    >
      {/* Encabezado Pedagógico del Paso 4 (Homogéneo con Pasos 1, 2 y 3) */}
      <div className="step-header">
        <span className="step-badge">Paso 4 de 8</span>
        <div>
          <h2 id="step4-title" className="card-title">
            Relaciones, Cardinalidad y Claves Foráneas
          </h2>
          <p className="step-lead">
            Definí cómo se vinculan las entidades de tu base de datos y validá la integridad referencial.
          </p>
        </div>
      </div>

      {/* Guía Pedagógica Colapsable (Homogénea con concept-box) */}
      <details className="concept-box" data-testid="step4-concept-box">
        <summary className="concept-summary">
          💡 Explicación breve del concepto: Cardinalidad, Claves Foráneas (FK) y Tablas Intermedias
        </summary>
        <div className="concept-content">
          <ul>
            <li>
              <strong>Cardinalidad:</strong> Indica con cuántos registros de la otra tabla puede vincularse un registro:
              <ul>
                <li>
                  <strong>1:1 (Uno a Uno):</strong> Cada fila de A se asocia con una única fila de B (ej.: <code>Ciudadano</code> y <code>Pasaporte</code>).
                </li>
                <li>
                  <strong>1:N (Uno a Muchos):</strong> Cada fila de A se asocia con muchas de B, pero cada B pertenece a un solo A (ej.: <code>Cliente</code> y <code>Mascotas</code>).
                </li>
                <li>
                  <strong>N:M (Muchos a Muchos):</strong> Muchas filas de A se asocian con muchas de B (ej.: <code>Estudiantes</code> y <code>Materias</code>).
                </li>
              </ul>
            </li>
            <li>
              <strong>Clave Foránea (FK - Foreign Key):</strong> Es una columna en una tabla que almacena el valor de la clave primaria de otra tabla para conectarlas. En una relación 1:N, siempre se almacena en la tabla del lado &ldquo;N&rdquo;.
            </li>
            <li>
              <strong>Regla de oro N:M:</strong> Las bases de datos relacionales no pueden almacenar listas de IDs en una celda sin romper la normalización. Toda relación N:M se descompone en una <strong>tabla intermedia asociativa</strong> con dos claves foráneas.
            </li>
          </ul>
        </div>
      </details>

      {/* Explicación del Tutor IA (Homogénea con tutor-explanation-box) */}
      {explicacionRelaciones && (
        <div className="tutor-explanation-box" data-testid="ai-relations-feedback">
          <strong>Análisis del Tutor IA sobre las conexiones del modelo:</strong>
          <p>{explicacionRelaciones}</p>
        </div>
      )}

      {/* Barra de Acciones del Asistente (Homogénea con toolbar-row) */}
      <div className="toolbar-row">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onSugerirConIA}
          disabled={cargando || modelo.entidades.length < 2}
          data-testid="suggest-relations-ai-btn"
        >
          {cargando ? 'Consultando al tutor IA...' : '✨ Sugerir relaciones con tutor IA'}
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={onPedirExplicacionIA}
          disabled={cargando || resultadoValidacion.observaciones.length === 0}
          data-testid="explain-observations-ai-btn"
        >
          🤖 Explicar observaciones con tutor IA
        </button>
      </div>

      {/* Panel del Validador Determinístico en Tiempo Real */}
      <div
        className={`card validator-card ${
          resultadoValidacion.valido ? 'validator-card-valid' : 'validator-card-warning'
        }`}
        aria-labelledby="validador-title"
        data-testid="validator-panel"
      >
        <div className="validator-header">
          <div className="validator-title-row">
            <h3 id="validador-title" className="validator-title">
              Validador de Diseño Relacional
            </h3>
            <span
              className={`status-pill ${
                resultadoValidacion.valido ? 'status-pill-success' : 'status-pill-warn'
              }`}
              data-testid="validator-status-badge"
            >
              {resultadoValidacion.valido
                ? resultadoValidacion.observaciones.length === 0
                  ? '✓ Modelo sin observaciones'
                  : '✓ Modelo válido (con advertencias pedagógicas)'
                : '⚠ Se requieren correcciones en el modelo'}
            </span>
          </div>

          <div className="validator-metrics">
            <span className="metric-pill metric-error">
              Errores: <strong>{resultadoValidacion.resumen.totalErrores}</strong>
            </span>
            <span className="metric-pill metric-warn">
              Advertencias: <strong>{resultadoValidacion.resumen.totalAdvertencias}</strong>
            </span>
            <span className="metric-pill metric-info">
              Sugerencias: <strong>{resultadoValidacion.resumen.totalSugerencias}</strong>
            </span>
          </div>
        </div>

        {resultadoValidacion.observaciones.length === 0 ? (
          <p className="validator-clean-msg" data-testid="validator-clean-msg">
            🎉 ¡Excelente! No se detectaron anomalías en las relaciones, entidades ni claves del
            modelo.
          </p>
        ) : (
          <div className="validator-obs-list" data-testid="validator-obs-list">
            {resultadoValidacion.observaciones.map((obs, idx) => (
              <div
                key={idx}
                className={`obs-item obs-${obs.gravedad}`}
                data-testid={`obs-item-${idx}`}
              >
                <div className="obs-header">
                  <span className={`obs-badge obs-badge-${obs.gravedad}`}>
                    {obs.gravedad === 'error'
                      ? 'Error'
                      : obs.gravedad === 'advertencia'
                        ? 'Advertencia'
                        : 'Sugerencia'}
                  </span>
                  <span className="obs-code">{obs.codigo}</span>
                  <span className="obs-entities">
                    [{obs.entidadesInvolucradas.join(', ')}]
                  </span>
                </div>

                <p className="obs-message">{obs.mensaje}</p>
                <p className="obs-explanation">{obs.explicacionConceptual}</p>

                {obs.accionRapida && (
                  <div className="obs-action-row">
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => handleAplicarAccionRapida(obs)}
                      disabled={cargando}
                      data-testid={`quick-fix-btn-${idx}`}
                    >
                      ⚡ {obs.accionRapida.descripcion}
                    </button>
                  </div>
                )}

                {/* Explicación pedagógica de la IA si fue solicitada */}
                {explicacionesIA?.explicaciones.find((e) => e.codigo === obs.codigo) && (
                  <div className="ai-obs-box" data-testid={`ai-obs-explanation-${idx}`}>
                    <span className="ai-obs-title">💡 Explicación del Tutor IA:</span>
                    <p className="ai-obs-body">
                      {
                        explicacionesIA.explicaciones.find((e) => e.codigo === obs.codigo)
                          ?.explicacionPedagogica
                      }
                    </p>
                    <div className="ai-obs-example">
                      <strong>Ejemplo práctico:</strong>{' '}
                      {
                        explicacionesIA.explicaciones.find((e) => e.codigo === obs.codigo)
                          ?.ejemploConcreto
                      }
                    </div>
                    <div className="ai-obs-fix">
                      <strong>Cómo resolverlo:</strong>{' '}
                      {
                        explicacionesIA.explicaciones.find((e) => e.codigo === obs.codigo)
                          ?.comoResolverlo
                      }
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {explicacionesIA?.resumenTutor && (
          <div className="ai-tutor-summary-box" data-testid="ai-tutor-summary">
            <strong>Resumen pedagógico del tutor:</strong> {explicacionesIA.resumenTutor}
          </div>
        )}
      </div>

      {/* Listado de Relaciones Definidas */}
      <div className="card relations-list-card" aria-labelledby="relaciones-definidas-title">
        <div className="card-header-row">
          <h3 id="relaciones-definidas-title" className="card-title">
            Relaciones Definidas ({modelo.relaciones.length})
          </h3>
          <span className="card-subtitle-badge">
            {modelo.relaciones.length === 0 ? 'Sin relaciones aún' : 'Modelo en construcción'}
          </span>
        </div>

        {modelo.relaciones.length === 0 ? (
          <div className="empty-state-box" data-testid="empty-relations-msg">
            <p>Todavía no agregaste relaciones entre las entidades.</p>
            <p className="form-help">
              Podés usar el botón <em>&ldquo;✨ Sugerir relaciones con tutor IA&rdquo;</em> para que
              el asistente te proponga una estructura inicial, o usar el formulario de abajo para
              definirlas manualmente.
            </p>
          </div>
        ) : (
          <div className="relations-grid" data-testid="relations-grid">
            {modelo.relaciones.map((rel, idx) => {
              const entOrigenRel = modelo.entidades.find(
                (e) => normalizarNombre(e.nombre) === normalizarNombre(rel.origen)
              );
              const entDestinoRel = modelo.entidades.find(
                (e) => normalizarNombre(e.nombre) === normalizarNombre(rel.destino)
              );
              const pkOrigenRel =
                entOrigenRel?.atributos.find((a) => a.esClavePrimaria) ||
                entOrigenRel?.atributos[0];
              const fkDetectadaRel =
                entOrigenRel && entDestinoRel
                  ? buscarAtributoFK(entDestinoRel, entOrigenRel, rel)
                  : null;
              const campoOrigenActual =
                rel.campoOrigen || fkDetectadaRel?.columnaPadre || pkOrigenRel?.nombre || 'id';
              const campoDestinoActual = rel.campoDestino || fkDetectadaRel?.atributoLocal || '';
              const nombreFKPropuestoRel = entOrigenRel
                ? obtenerNombreAtributoFKPropuesto(entOrigenRel, rel)
                : 'id_origen';

              return (
                <div
                  key={idx}
                  className={`relation-item-card ${indiceEditando === idx ? 'editing' : ''}`}
                  data-testid={`relation-card-${idx}`}
                >
                  <div className="relation-header">
                    <div className="relation-entities-flow">
                      <span className="relation-entity-pill">{rel.origen}</span>
                      <span
                        className="relation-cardinality-badge"
                        data-testid={`cardinality-${idx}`}
                      >
                        {rel.cardinalidad}
                      </span>
                      <span className="relation-entity-pill">{rel.destino}</span>
                    </div>

                    <div className="relation-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => iniciarEdicion(idx)}
                        disabled={cargando}
                        data-testid={`edit-relation-btn-${idx}`}
                      >
                        ✏ Editar
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-xs"
                        onClick={() => handleEliminarRelacion(idx)}
                        disabled={cargando}
                        data-testid={`delete-relation-btn-${idx}`}
                      >
                        ✕ Borrar
                      </button>
                    </div>
                  </div>

                  <p className="relation-desc" data-testid={`relation-desc-${idx}`}>
                    &ldquo;{rel.descripcion}&rdquo;
                  </p>

                  {/* Selector intuitivo de campos que conectan ambas tablas (PK <-> FK) */}
                  {(rel.cardinalidad === '1:N' || rel.cardinalidad === '1:1') &&
                    entOrigenRel &&
                    entDestinoRel && (
                      <div
                        className="relation-fields-mapping"
                        data-testid={`relation-fields-info-${idx}`}
                        style={{
                          marginTop: '0.6rem',
                          marginBottom: '0.6rem',
                          padding: '0.6rem 0.75rem',
                          borderRadius: '8px',
                          backgroundColor: 'rgba(99, 102, 241, 0.08)',
                          border: '1px solid rgba(99, 102, 241, 0.25)',
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          gap: '0.5rem',
                          fontSize: '0.85rem',
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>🔗 Campos vinculados:</span>
                        <label
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                        >
                          <span>
                            Campo en <strong>{entOrigenRel.nombre}</strong> (PK):
                          </span>
                          <select
                            className="select-input"
                            style={{
                              padding: '0.2rem 0.45rem',
                              fontSize: '0.82rem',
                              width: 'auto',
                              minWidth: '120px',
                            }}
                            value={campoOrigenActual}
                            onChange={(e) => handleCambiarCampoOrigenInline(idx, e.target.value)}
                            disabled={cargando}
                            aria-label={`Campo en tabla ${entOrigenRel.nombre} para relación ${idx}`}
                            data-testid={`inline-origin-field-select-${idx}`}
                          >
                            {entOrigenRel.atributos.map((attr) => (
                              <option key={attr.nombre} value={attr.nombre}>
                                {attr.nombre}
                                {attr.esClavePrimaria ? ' (PK)' : ''}
                              </option>
                            ))}
                          </select>
                        </label>

                        <span style={{ fontWeight: 700, color: 'var(--color-primary, #6366f1)' }}>
                          ➔ con ➔
                        </span>

                        <label
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                        >
                          <span>
                            Campo en <strong>{entDestinoRel.nombre}</strong> (Foránea FK):
                          </span>
                          <select
                            className="select-input"
                            style={{
                              padding: '0.2rem 0.45rem',
                              fontSize: '0.82rem',
                              width: 'auto',
                              minWidth: '150px',
                            }}
                            value={campoDestinoActual}
                            onChange={(e) => handleCambiarCampoForaneoInline(idx, e.target.value)}
                            disabled={cargando}
                            aria-label={`Campo foráneo en tabla ${entDestinoRel.nombre} para relación ${idx}`}
                            data-testid={`inline-fk-select-${idx}`}
                          >
                            <option value="">
                              {fkDetectadaRel
                                ? `Automático (${fkDetectadaRel.atributoLocal})`
                                : '-- Seleccionar campo FK --'}
                            </option>
                            {entDestinoRel.atributos.map((attr) => (
                              <option key={attr.nombre} value={attr.nombre}>
                                {attr.nombre} ({attr.tipoConceptual}
                                {attr.esClavePrimaria ? ' · PK' : ' · FK'})
                              </option>
                            ))}
                            {!entDestinoRel.atributos.some(
                              (a) =>
                                normalizarNombre(a.nombre) ===
                                normalizarNombre(nombreFKPropuestoRel)
                            ) && (
                              <option value="__crear_fk__">
                                ➕ Crear campo &ldquo;{nombreFKPropuestoRel}&rdquo; en{' '}
                                {entDestinoRel.nombre}
                              </option>
                            )}
                          </select>
                        </label>
                      </div>
                    )}

                  <div className="relation-footer-tags">
                    <span
                      className={`nullability-badge ${
                        rel.obligatoriaEnOrigen ? 'badge-mandatory' : 'badge-optional'
                      }`}
                    >
                      {rel.origen}: {rel.obligatoriaEnOrigen ? 'Obligatorio' : 'Opcional'}
                    </span>
                    <span
                      className={`nullability-badge ${
                        rel.obligatoriaEnDestino ? 'badge-mandatory' : 'badge-optional'
                      }`}
                    >
                      {rel.destino}: {rel.obligatoriaEnDestino ? 'Obligatorio' : 'Opcional'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Formulario de Alta / Edición de Relaciones */}
      <div className="card relation-form-card" aria-labelledby="form-relacion-title">
        <h3 id="form-relacion-title" className="card-title">
          {indiceEditando !== null ? '✏ Modificar Relación' : '➕ Agregar Nueva Relación'}
        </h3>

        {errorFormulario && (
          <div role="alert" className="alert alert-error" data-testid="relation-form-error">
            {errorFormulario}
          </div>
        )}

        <form onSubmit={handleGuardarRelacion} data-testid="relation-form">
          <div className="form-grid-3">
            <div className="form-group">
              <label htmlFor="rel-origen-select" className="form-label">
                Entidad de Origen (Lado 1)
              </label>
              <select
                id="rel-origen-select"
                className="select-input"
                value={formOrigen}
                onChange={(e) => {
                  setFormOrigen(e.target.value);
                  setFormCampoOrigen('');
                }}
                disabled={cargando}
                data-testid="rel-origin-select"
              >
                {modelo.entidades.map((e) => (
                  <option key={e.nombre} value={e.nombre}>
                    {e.nombre}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="rel-cardinalidad-select" className="form-label">
                Cardinalidad
              </label>
              <select
                id="rel-cardinalidad-select"
                className="select-input"
                value={formCardinalidad}
                onChange={(e) => setFormCardinalidad(e.target.value as Cardinalidad)}
                disabled={cargando}
                data-testid="rel-cardinality-select"
              >
                <option value="1:N">1:N (Uno a Muchos — el caso más común)</option>
                <option value="1:1">1:1 (Uno a Uno)</option>
                <option value="N:M">N:M (Muchos a Muchos — requiere tabla puente)</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="rel-destino-select" className="form-label">
                Entidad de Destino (Lado N / 1)
              </label>
              <select
                id="rel-destino-select"
                className="select-input"
                value={formDestino}
                onChange={(e) => {
                  setFormDestino(e.target.value);
                  setFormCampoDestino('');
                }}
                disabled={cargando}
                data-testid="rel-dest-select"
              >
                {modelo.entidades.map((e) => (
                  <option key={e.nombre} value={e.nombre}>
                    {e.nombre}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Selección explícita e intuitiva de los campos que relacionan las tablas */}
          {formCardinalidad !== 'N:M' && entidadOrigenSeleccionada && entidadDestinoSeleccionada && (
            <div
              className="relation-fields-selector-box"
              data-testid="relation-fields-selector-box"
              style={{
                marginBottom: '1rem',
                padding: '0.85rem 1rem',
                borderRadius: '10px',
                backgroundColor: 'rgba(99, 102, 241, 0.06)',
                border: '1px solid rgba(99, 102, 241, 0.25)',
              }}
            >
              <div
                style={{
                  fontWeight: 600,
                  marginBottom: '0.5rem',
                  fontSize: '0.92rem',
                }}
              >
                🔗 Especificar qué campos conectan las tablas (Clave Primaria ↔ Clave Foránea)
              </div>
              <div className="form-grid-3" style={{ alignItems: 'end' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="rel-campo-origen-select" className="form-label">
                    Campo en tabla &ldquo;{entidadOrigenSeleccionada.nombre}&rdquo; (Clave Primaria)
                  </label>
                  <select
                    id="rel-campo-origen-select"
                    className="select-input"
                    value={formCampoOrigen}
                    onChange={(e) => setFormCampoOrigen(e.target.value)}
                    disabled={cargando}
                    data-testid="rel-origin-field-select"
                  >
                    <option value="">
                      Automático ({pkOrigenDetectada ? `${pkOrigenDetectada.nombre} [PK]` : 'id'})
                    </option>
                    {entidadOrigenSeleccionada.atributos.map((attr) => (
                      <option key={attr.nombre} value={attr.nombre}>
                        {attr.nombre} ({attr.tipoConceptual}
                        {attr.esClavePrimaria ? ' · Clave Primaria PK' : ''})
                      </option>
                    ))}
                  </select>
                </div>

                <div
                  style={{
                    textAlign: 'center',
                    paddingBottom: '0.55rem',
                    fontWeight: 700,
                    fontSize: '0.9rem',
                  }}
                >
                  ➔ se conecta con ➔
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="rel-campo-destino-select" className="form-label">
                    Campo en otra tabla &ldquo;{entidadDestinoSeleccionada.nombre}&rdquo; que sea la
                    Foránea (FK)
                  </label>
                  <select
                    id="rel-campo-destino-select"
                    className="select-input"
                    value={formCampoDestino}
                    onChange={(e) => setFormCampoDestino(e.target.value)}
                    disabled={cargando}
                    data-testid="rel-dest-field-select"
                  >
                    <option value="">
                      {fkDetectadaAutomatica
                        ? `Detectar automáticamente (${fkDetectadaAutomatica.atributoLocal})`
                        : '-- Detectar automáticamente o elegir campo --'}
                    </option>
                    {entidadDestinoSeleccionada.atributos.map((attr) => (
                      <option key={attr.nombre} value={attr.nombre}>
                        {attr.nombre} ({attr.tipoConceptual}
                        {attr.esClavePrimaria
                          ? ' · PK'
                          : ` · Campo en ${entidadDestinoSeleccionada.nombre}`}
                        )
                      </option>
                    ))}
                    {!entidadDestinoSeleccionada.atributos.some(
                      (a) =>
                        normalizarNombre(a.nombre) ===
                        normalizarNombre(nombreFKPropuestoParaDestino)
                    ) && (
                      <option value="__crear_fk__">
                        ➕ Crear automáticamente campo &ldquo;{nombreFKPropuestoParaDestino}&rdquo;
                        en {entidadDestinoSeleccionada.nombre} (FK)
                      </option>
                    )}
                  </select>
                </div>
              </div>

              <p
                className="form-help"
                style={{ marginTop: '0.55rem', marginBottom: 0 }}
                data-testid="relation-fields-preview"
              >
                📌 <strong>Resumen de conexión:</strong> El campo{' '}
                <code>{formCampoOrigen || pkOrigenDetectada?.nombre || 'id'}</code> de la tabla{' '}
                <strong>{entidadOrigenSeleccionada.nombre}</strong> se relacionará con el campo
                foráneo (FK){' '}
                <code>
                  {formCampoDestino === '__crear_fk__'
                    ? `${nombreFKPropuestoParaDestino} (se creará al guardar)`
                    : formCampoDestino ||
                      fkDetectadaAutomatica?.atributoLocal ||
                      '(elegí un campo manual o crealo automáticamente)'}
                </code>{' '}
                en la tabla <strong>{entidadDestinoSeleccionada.nombre}</strong>.
              </p>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="rel-descripcion-input" className="form-label">
              Descripción en lenguaje natural
            </label>
            <input
              id="rel-descripcion-input"
              type="text"
              className="text-input"
              placeholder='Ej: "Un cliente puede ser dueño de varias mascotas" o "Un alumno cursa muchas materias"'
              value={formDescripcion}
              onChange={(e) => setFormDescripcion(e.target.value)}
              disabled={cargando}
              data-testid="rel-description-input"
            />
          </div>

          <div className="checkboxes-row">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={formObligatoriaOrigen}
                onChange={(e) => setFormObligatoriaOrigen(e.target.checked)}
                disabled={cargando}
                data-testid="rel-origin-mandatory-checkbox"
              />
              <span>Obligatoria en origen (todo destino debe tener origen)</span>
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={formObligatoriaDestino}
                onChange={(e) => setFormObligatoriaDestino(e.target.checked)}
                disabled={cargando}
                data-testid="rel-dest-mandatory-checkbox"
              />
              <span>Obligatoria en destino (todo origen debe tener destino)</span>
            </label>
          </div>

          <div className="button-group">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={cargando || !formDescripcion.trim()}
              data-testid="save-relation-btn"
            >
              {indiceEditando !== null ? 'Guardar Cambios' : '➕ Agregar Relación'}
            </button>
            {indiceEditando !== null && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={cancelarEdicion}
                disabled={cargando}
                data-testid="cancel-edit-relation-btn"
              >
                Cancelar Edición
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Banner de Confirmación */}
      {relacionesConfirmadas && (
        <div
          role="status"
          className="alert alert-success"
          data-testid="relations-confirmed-banner"
        >
          <strong>✓ Relaciones confirmadas por el estudiante.</strong> El diseño relacional está
          validado y listo para visualizar el Diagrama ER en el Paso 5.
        </div>
      )}

      {/* Navegación Inferior (Homogénea con button-group) */}
      <div className="button-group">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onVolverPaso3}
          disabled={cargando}
          data-testid="back-to-step3-btn"
        >
          ← Volver al Paso 3 (Modelo Conceptual)
        </button>

        <button
          type="button"
          className="btn btn-primary"
          onClick={onConfirmarRelaciones}
          disabled={cargando || !resultadoValidacion.valido}
          data-testid="confirm-step4-btn"
        >
          Confirmar Relaciones y Avanzar al Paso 5 (Diagrama ER) ✓
        </button>
      </div>
    </section>
  );
}
