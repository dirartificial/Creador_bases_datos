import { useState } from 'react';
import {
  Atributo,
  Decision,
  Entidad,
  TipoConceptual,
  TipoConceptualSchema,
} from '../core/schemas';

const TIPOS_CONCEPTUALES: TipoConceptual[] = TipoConceptualSchema.options;

export interface Step3ModeloConceptualProps {
  entidades: Entidad[];
  explicacionGeneral?: string;
  modeloConfirmado: boolean;
  cargando: boolean;
  onActualizarEntidades: (
    nuevasEntidades: Entidad[],
    decision?: { descripcion: string; origen: Decision['origen'] }
  ) => void;
  onRegenerarConIA: () => Promise<void>;
  onConfirmarModelo: () => void;
  onVolverPaso2: () => void;
}

export function Step3ModeloConceptual({
  entidades,
  explicacionGeneral,
  modeloConfirmado,
  cargando,
  onActualizarEntidades,
  onRegenerarConIA,
  onConfirmarModelo,
  onVolverPaso2,
}: Step3ModeloConceptualProps) {
  const [errorValidacion, setErrorValidacion] = useState<string | null>(null);

  const handleCambioEntidad = (
    entidadIdx: number,
    campo: 'nombre' | 'descripcion',
    valor: string
  ) => {
    const copia = entidades.map((ent, idx) =>
      idx === entidadIdx ? { ...ent, [campo]: valor } : ent
    );
    onActualizarEntidades(copia);
  };

  const handleAgregarEntidad = () => {
    const nueva: Entidad = {
      nombre: `nueva_entidad_${entidades.length + 1}`,
      descripcion: 'Descripción de la entidad agregada manualmente por el estudiante.',
      atributos: [
        {
          nombre: 'id',
          tipoConceptual: 'entero',
          obligatorio: true,
          unico: true,
          esClavePrimaria: true,
          justificacion:
            'Identificador único numérico (Clave Primaria) definido por el estudiante.',
        },
      ],
    };
    onActualizarEntidades([...entidades, nueva], {
      descripcion: `Agregó manualmente la entidad "${nueva.nombre}".`,
      origen: 'estudiante',
    });
  };

  const handleEliminarEntidad = (entidadIdx: number) => {
    const eliminada = entidades[entidadIdx];
    const copia = entidades.filter((_, idx) => idx !== entidadIdx);
    onActualizarEntidades(copia, {
      descripcion: `Rechazó/eliminó la entidad "${eliminada?.nombre ?? entidadIdx}".`,
      origen: 'ia_rechazada',
    });
  };

  const handleCambioAtributo = <K extends keyof Atributo>(
    entidadIdx: number,
    attrIdx: number,
    campo: K,
    valor: Atributo[K]
  ) => {
    const copia = entidades.map((ent, eIdx) => {
      if (eIdx !== entidadIdx) return ent;
      const nuevosAtributos = ent.atributos.map((attr, aIdx) => {
        if (aIdx !== attrIdx) return attr;
        const actualizado: Atributo = { ...attr, [campo]: valor };
        // Si se marca como clave primaria, por definición conceptual es obligatorio y único
        if (campo === 'esClavePrimaria' && valor === true) {
          actualizado.obligatorio = true;
          actualizado.unico = true;
        }
        return actualizado;
      });
      return { ...ent, atributos: nuevosAtributos };
    });
    onActualizarEntidades(copia);
  };

  const handleAgregarAtributo = (entidadIdx: number) => {
    const entidad = entidades[entidadIdx];
    const nuevoAttr: Atributo = {
      nombre: `atributo_${(entidad?.atributos.length ?? 0) + 1}`,
      tipoConceptual: 'texto',
      obligatorio: true,
      unico: false,
      esClavePrimaria: false,
      justificacion: 'Atributo agregado manualmente por el estudiante.',
    };
    const copia = entidades.map((ent, idx) =>
      idx === entidadIdx ? { ...ent, atributos: [...ent.atributos, nuevoAttr] } : ent
    );
    onActualizarEntidades(copia, {
      descripcion: `Agregó manualmente el atributo "${nuevoAttr.nombre}" en la entidad "${entidad?.nombre}".`,
      origen: 'estudiante',
    });
  };

  const handleEliminarAtributo = (entidadIdx: number, attrIdx: number) => {
    const entidad = entidades[entidadIdx];
    const attrEliminado = entidad?.atributos[attrIdx];
    const copia = entidades.map((ent, idx) =>
      idx === entidadIdx
        ? { ...ent, atributos: ent.atributos.filter((_, aIdx) => aIdx !== attrIdx) }
        : ent
    );
    onActualizarEntidades(copia, {
      descripcion: `Rechazó/eliminó el atributo "${attrEliminado?.nombre}" de la entidad "${entidad?.nombre}".`,
      origen: 'ia_rechazada',
    });
  };

  const validarYConfirmar = () => {
    setErrorValidacion(null);
    if (entidades.length === 0) {
      setErrorValidacion('El modelo debe tener al menos una entidad antes de confirmarlo.');
      return;
    }

    for (const ent of entidades) {
      if (!ent.nombre.trim()) {
        setErrorValidacion('Todas las entidades deben tener un nombre.');
        return;
      }
      if (!ent.descripcion.trim()) {
        setErrorValidacion(`La entidad "${ent.nombre}" necesita una breve descripción.`);
        return;
      }
      if (ent.atributos.length === 0) {
        setErrorValidacion(`La entidad "${ent.nombre}" debe tener al menos un atributo.`);
        return;
      }
      const tienePK = ent.atributos.some((a) => a.esClavePrimaria);
      if (!tienePK) {
        setErrorValidacion(
          `La entidad "${ent.nombre}" no tiene Clave Primaria (PK). Marcá al menos un atributo identificador (por ejemplo un ID único) como PK.`
        );
        return;
      }
      for (const attr of ent.atributos) {
        if (!attr.nombre.trim()) {
          setErrorValidacion(
            `Hay un atributo sin nombre en la entidad "${ent.nombre}". Completalo o eliminalo.`
          );
          return;
        }
      }
    }

    onConfirmarModelo();
  };

  return (
    <section className="card" aria-labelledby="step3-title" data-testid="step3-container">
      <div className="step-header">
        <span className="step-badge">Paso 3 de 8</span>
        <h2 id="step3-title" className="card-title">
          Modelo Conceptual: Entidades, Atributos y Claves Primarias
        </h2>
      </div>

      <details className="concept-box" data-testid="step3-concept-box">
        <summary className="concept-summary">
          💡 Explicación breve del concepto: Entidad, Atributo y Clave Primaria (PK)
        </summary>
        <div className="concept-content">
          <ul>
            <li>
              <strong>Entidad:</strong> Es un objeto o concepto relevante del mundo real sobre el
              cual queremos guardar información (ej.: <code>Mascota</code>, <code>Cliente</code>,{' '}
              <code>Consulta</code>).
            </li>
            <li>
              <strong>Atributo:</strong> Es cada propiedad o dato específico que describimos de una
              entidad (ej.: <code>nombre</code>, <code>fecha_nacimiento</code>, <code>peso</code>).
            </li>
            <li>
              <strong>Clave Primaria (PK - Primary Key):</strong> Es el atributo (o conjunto de
              atributos) que <strong>identifica de manera única e irrepetible</strong> a cada
              registro de una entidad. Nunca puede estar vacío (es obligatorio) ni repetirse. Por
              ejemplo, usamos <code>id_mascota</code> numérico en lugar de <code>nombre</code>{' '}
              porque dos mascotas distintas pueden llamarse &ldquo;Firulais&rdquo;.
            </li>
          </ul>
        </div>
      </details>

      {explicacionGeneral && (
        <div className="tutor-explanation-box" data-testid="tutor-model-explanation">
          <strong>Explicación del Tutor IA:</strong>
          <p>{explicacionGeneral}</p>
        </div>
      )}

      <div className="toolbar-row">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleAgregarEntidad}
          disabled={cargando}
          data-testid="add-entity-btn"
        >
          + Agregar entidad manualmente
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onRegenerarConIA}
          disabled={cargando}
          data-testid="regenerate-model-btn"
        >
          {cargando ? 'Consultando al tutor...' : '↻ Pedir nueva sugerencia al tutor IA'}
        </button>
      </div>

      {entidades.length === 0 ? (
        <div className="empty-state">
          Todavía no hay entidades en el modelo. Podés pedirle una sugerencia al tutor IA o
          agregarlas manualmente.
        </div>
      ) : (
        <div className="entities-list" data-testid="entities-list">
          {entidades.map((entidad, entIdx) => (
            <div
              key={entIdx}
              className="entity-card"
              data-testid={`entity-card-${entIdx}`}
            >
              <div className="entity-card-header">
                <div className="entity-header-inputs">
                  <div className="form-group-inline">
                    <label htmlFor={`entidad-nombre-${entIdx}`} className="form-label-sm">
                      Nombre de Entidad
                    </label>
                    <input
                      id={`entidad-nombre-${entIdx}`}
                      type="text"
                      className="text-input"
                      value={entidad.nombre}
                      onChange={(e) => handleCambioEntidad(entIdx, 'nombre', e.target.value)}
                      data-testid={`entity-name-input-${entIdx}`}
                    />
                  </div>
                  <div className="form-group-inline entity-desc-group">
                    <label htmlFor={`entidad-desc-${entIdx}`} className="form-label-sm">
                      Descripción
                    </label>
                    <input
                      id={`entidad-desc-${entIdx}`}
                      type="text"
                      className="text-input"
                      value={entidad.descripcion}
                      onChange={(e) => handleCambioEntidad(entIdx, 'descripcion', e.target.value)}
                      data-testid={`entity-desc-input-${entIdx}`}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => handleEliminarEntidad(entIdx)}
                  data-testid={`delete-entity-btn-${entIdx}`}
                >
                  Eliminar entidad
                </button>
              </div>

              <div className="table-responsive">
                <table className="model-table" aria-label={`Atributos de ${entidad.nombre}`}>
                  <thead>
                    <tr>
                      <th>Atributo</th>
                      <th>Tipo conceptual</th>
                      <th title="Clave Primaria: identifica unívocamente cada fila">PK</th>
                      <th>Obligatorio</th>
                      <th>Único</th>
                      <th>Justificación pedagógica (por qué se sugiere)</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entidad.atributos.map((attr, attrIdx) => (
                      <tr key={attrIdx} data-testid={`attr-row-${entIdx}-${attrIdx}`}>
                        <td>
                          <input
                            type="text"
                            className="text-input input-table"
                            aria-label={`Nombre atributo ${attrIdx + 1} de ${entidad.nombre}`}
                            value={attr.nombre}
                            onChange={(e) =>
                              handleCambioAtributo(entIdx, attrIdx, 'nombre', e.target.value)
                            }
                            data-testid={`attr-name-${entIdx}-${attrIdx}`}
                          />
                        </td>
                        <td>
                          <select
                            className="select-input input-table"
                            aria-label={`Tipo conceptual de ${attr.nombre}`}
                            value={attr.tipoConceptual}
                            onChange={(e) =>
                              handleCambioAtributo(
                                entIdx,
                                attrIdx,
                                'tipoConceptual',
                                e.target.value as TipoConceptual
                              )
                            }
                            data-testid={`attr-type-${entIdx}-${attrIdx}`}
                          >
                            {TIPOS_CONCEPTUALES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="cell-center">
                          <input
                            type="checkbox"
                            aria-label={`Clave primaria para ${attr.nombre}`}
                            checked={attr.esClavePrimaria}
                            onChange={(e) =>
                              handleCambioAtributo(
                                entIdx,
                                attrIdx,
                                'esClavePrimaria',
                                e.target.checked
                              )
                            }
                            data-testid={`attr-pk-${entIdx}-${attrIdx}`}
                          />
                        </td>
                        <td className="cell-center">
                          <input
                            type="checkbox"
                            aria-label={`Obligatorio para ${attr.nombre}`}
                            checked={attr.obligatorio}
                            disabled={attr.esClavePrimaria}
                            onChange={(e) =>
                              handleCambioAtributo(
                                entIdx,
                                attrIdx,
                                'obligatorio',
                                e.target.checked
                              )
                            }
                            data-testid={`attr-req-${entIdx}-${attrIdx}`}
                          />
                        </td>
                        <td className="cell-center">
                          <input
                            type="checkbox"
                            aria-label={`Único para ${attr.nombre}`}
                            checked={attr.unico}
                            disabled={attr.esClavePrimaria}
                            onChange={(e) =>
                              handleCambioAtributo(entIdx, attrIdx, 'unico', e.target.checked)
                            }
                            data-testid={`attr-unique-${entIdx}-${attrIdx}`}
                          />
                        </td>
                        <td className="cell-justificacion">
                          <textarea
                            className="textarea-input input-table-textarea"
                            rows={3}
                            aria-label={`Justificación de ${attr.nombre}`}
                            value={attr.justificacion}
                            onChange={(e) =>
                              handleCambioAtributo(
                                entIdx,
                                attrIdx,
                                'justificacion',
                                e.target.value
                              )
                            }
                            data-testid={`attr-justificacion-${entIdx}-${attrIdx}`}
                          />
                        </td>
                        <td className="cell-center">
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => handleEliminarAtributo(entIdx, attrIdx)}
                            title="Eliminar atributo"
                            data-testid={`delete-attr-btn-${entIdx}-${attrIdx}`}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="entity-card-footer">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleAgregarAtributo(entIdx)}
                  data-testid={`add-attr-btn-${entIdx}`}
                >
                  + Agregar atributo a {entidad.nombre}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {errorValidacion && (
        <div role="alert" className="alert alert-error" data-testid="step3-validation-error">
          {errorValidacion}
        </div>
      )}

      {modeloConfirmado && !errorValidacion && (
        <div className="alert alert-success" data-testid="model-confirmed-banner">
          <strong>✓ Modelo Conceptual confirmado por el estudiante.</strong> Este modelo es ahora la
          fuente de verdad para definir las relaciones (Paso 4), el diagrama ER y los scripts.
        </div>
      )}

      <div className="button-group">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onVolverPaso2}
          disabled={cargando}
        >
          ← Volver a Aclaración guiada (Paso 2)
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={validarYConfirmar}
          disabled={cargando}
          data-testid="confirm-step3-btn"
        >
          {modeloConfirmado
            ? 'Actualizar confirmación del Modelo Conceptual ✓'
            : 'Confirmar Modelo Conceptual ✓'}
        </button>
      </div>
    </section>
  );
}
