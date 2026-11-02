import React, { useState, useEffect } from 'react';
import { MAX_RONDAS_ACLARACION } from '../core/clarity';
import { Aclaracion, RondaAclaracion } from '../core/schemas';

export interface Step2AclaracionProps {
  descripcionProblema: string;
  rondasAclaracion: RondaAclaracion[];
  ultimaAclaracion: Aclaracion | null;
  cargando: boolean;
  onResponderRonda: (
    respuestas: Record<string, string>,
    supuestosAceptados: string[],
    supuestosRechazados: string[]
  ) => Promise<void>;
  onConfirmarAclaracion: (
    supuestosAceptados: string[],
    supuestosRechazados: string[]
  ) => Promise<void>;
  onVolverPaso1: () => void;
}

export function Step2Aclaracion({
  descripcionProblema,
  rondasAclaracion,
  ultimaAclaracion,
  cargando,
  onResponderRonda,
  onConfirmarAclaracion,
  onVolverPaso1,
}: Step2AclaracionProps) {
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});
  const [estadoSupuestos, setEstadoSupuestos] = useState<Record<number, boolean>>({});
  const [errorValidacion, setErrorValidacion] = useState<string | null>(null);

  useEffect(() => {
    setRespuestas({});
    setErrorValidacion(null);
    if (ultimaAclaracion?.supuestosAConfirmar) {
      const inicial: Record<number, boolean> = {};
      ultimaAclaracion.supuestosAConfirmar.forEach((_, idx) => {
        inicial[idx] = true;
      });
      setEstadoSupuestos(inicial);
    }
  }, [ultimaAclaracion, rondasAclaracion.length]);

  const numeroRondaActual = rondasAclaracion.length + 1;
  const topeRondasAlcanzado = rondasAclaracion.length >= MAX_RONDAS_ACLARACION;
  const preguntasActuales = ultimaAclaracion?.preguntas ?? [];
  const supuestosActuales = ultimaAclaracion?.supuestosAConfirmar ?? [];

  const requiereMasRespuestas =
    Boolean(ultimaAclaracion) &&
    !ultimaAclaracion!.suficiente &&
    preguntasActuales.length > 0 &&
    !topeRondasAlcanzado;

  const puedeAvanzarAPaso3 =
    Boolean(ultimaAclaracion) && (ultimaAclaracion!.suficiente || topeRondasAlcanzado);

  const separarSupuestos = () => {
    const aceptados: string[] = [];
    const rechazados: string[] = [];
    supuestosActuales.forEach((supuesto, idx) => {
      if (estadoSupuestos[idx] !== false) {
        aceptados.push(supuesto);
      } else {
        rechazados.push(supuesto);
      }
    });
    return { aceptados, rechazados };
  };

  const handleEnviarRespuestas = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorValidacion(null);

    const faltantes = preguntasActuales.some(
      (_, idx) => !respuestas[String(idx)] || !respuestas[String(idx)].trim()
    );
    if (faltantes) {
      setErrorValidacion(
        'Por favor respondé todas las preguntas del tutor para que pueda ayudarte con precisión.'
      );
      return;
    }

    const { aceptados, rechazados } = separarSupuestos();
    await onResponderRonda(respuestas, aceptados, rechazados);
  };

  const handleConfirmarYAvanzar = async () => {
    setErrorValidacion(null);
    const { aceptados, rechazados } = separarSupuestos();
    await onConfirmarAclaracion(aceptados, rechazados);
  };

  return (
    <section
      className="card studio-step-card"
      aria-labelledby="step2-title"
      data-testid="step2-container"
    >
      <div className="step-header">
        <span className="step-badge">Paso 2 de 8</span>
        <div>
          <h2 id="step2-title" className="card-title">
            Aclaración guiada con el tutor
          </h2>
          <p className="step-lead">
            Resolvé las dudas de negocio antes de estructurar las entidades.
          </p>
        </div>
      </div>

      <details className="concept-box" data-testid="step2-concept-box">
        <summary className="concept-summary">
          💡 Explicación breve del concepto: ¿Por qué no adivinamos los requisitos?
        </summary>
        <div className="concept-content">
          <p>
            Una frase como <em>&ldquo;quiero una base para una veterinaria&rdquo;</em> puede
            significar cosas muy distintas: ¿atendemos solo mascotas con dueño o también animales
            en adopción? ¿Guardamos turnos, historial clínico, vacunas o también ventas de
            productos?
          </p>
          <p>
            En ingeniería de datos, <strong>asumir sin preguntar genera errores costosos</strong>.
            Por eso el tutor realiza hasta {MAX_RONDAS_ACLARACION} rondas de preguntas sobre{' '}
            <strong>entidades</strong>, <strong>atributos</strong>,{' '}
            <strong>relaciones/cardinalidad</strong>, <strong>restricciones</strong> e{' '}
            <strong>informes esperados</strong> antes de proponer el modelo.
          </p>
        </div>
      </details>

      <div className="context-summary-box">
        <span className="module-tag">Dominio Planteado</span>
        <p className="context-summary-text" data-testid="step2-problem-summary">
          {descripcionProblema}
        </p>
      </div>

      {rondasAclaracion.length > 0 && (
        <div className="rounds-history" data-testid="rounds-history">
          <h3 className="subsection-title">
            Historial de Rondas Respondidas ({rondasAclaracion.length})
          </h3>
          <div className="rounds-grid">
            {rondasAclaracion.map((r) => (
              <div key={r.numeroRonda} className="round-card">
                <div className="module-tag">Ronda {r.numeroRonda}</div>
                <ul className="qa-list">
                  {r.preguntas.map((preg, idx) => (
                    <li key={idx}>
                      <div className="qa-question">{preg}</div>
                      <div className="qa-answer">
                        ↳ {r.respuestasEstudiante[String(idx)] || '(Sin respuesta)'}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {requiereMasRespuestas && (
        <form onSubmit={handleEnviarRespuestas} data-testid="clarification-questions-form">
          <div className="alert alert-warning-box" data-testid="ambiguity-warning">
            <strong>
              Faltan definiciones clave (Ronda {numeroRondaActual} de {MAX_RONDAS_ACLARACION}).
            </strong>{' '}
            Respondé las tarjetas de abajo para destrabar el Modelo Conceptual:
          </div>

          <div className="questions-grid">
            {preguntasActuales.map((pregunta, idx) => (
              <div
                key={idx}
                className="form-group question-item"
                data-testid={`question-item-${idx}`}
              >
                <div className="question-number-tag">Pregunta {idx + 1}</div>
                <label htmlFor={`respuesta-ronda-${idx}`} className="form-label">
                  {pregunta}
                </label>
                <textarea
                  id={`respuesta-ronda-${idx}`}
                  className="textarea-input"
                  rows={3}
                  placeholder="Escribí tu decisión de diseño..."
                  value={respuestas[String(idx)] ?? ''}
                  onChange={(e) =>
                    setRespuestas((prev) => ({
                      ...prev,
                      [String(idx)]: e.target.value,
                    }))
                  }
                  disabled={cargando}
                  data-testid={`answer-input-${idx}`}
                />
              </div>
            ))}
          </div>

          {supuestosActuales.length > 0 && (
            <div className="assumptions-box" data-testid="assumptions-list">
              <h3 className="subsection-title">
                Supuestos iniciales sugeridos (marcá los que aceptás):
              </h3>
              <div className="assumptions-grid">
                {supuestosActuales.map((supuesto, idx) => (
                  <label key={idx} className="checkbox-row assumption-row">
                    <input
                      type="checkbox"
                      checked={estadoSupuestos[idx] !== false}
                      onChange={(e) =>
                        setEstadoSupuestos((prev) => ({
                          ...prev,
                          [idx]: e.target.checked,
                        }))
                      }
                      disabled={cargando}
                      data-testid={`assumption-checkbox-${idx}`}
                    />
                    <span>{supuesto}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {errorValidacion && (
            <div role="alert" className="alert alert-error">
              {errorValidacion}
            </div>
          )}

          <div className="button-group">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onVolverPaso1}
              disabled={cargando}
            >
              ← Editar descripción (Paso 1)
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-glow"
              disabled={cargando}
              data-testid="submit-clarification-btn"
            >
              {cargando
                ? '⏳ Evaluando respuestas con Gemini...'
                : `Enviar respuestas (Ronda ${numeroRondaActual} de ${MAX_RONDAS_ACLARACION})`}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={true}
              title="Debés responder las preguntas de aclaración antes de avanzar al Modelo Conceptual"
              data-testid="confirm-step2-btn"
            >
              🔒 Modelo Conceptual bloqueado (requiere aclarar dudas)
            </button>
          </div>
        </form>
      )}

      {puedeAvanzarAPaso3 && (
        <div data-testid="clarification-sufficient-panel">
          <div className="alert alert-success">
            <strong>✓ Alcance claro y verificado.</strong> Ya contamos con las definiciones
            necesarias para estructurar las entidades y atributos del Modelo Conceptual.
          </div>

          {supuestosActuales.length > 0 && (
            <div className="assumptions-box" data-testid="assumptions-list">
              <h3 className="subsection-title">
                Confirmá los supuestos de diseño que el tutor tendrá en cuenta:
              </h3>
              <p className="form-help">
                Desmarcá cualquier supuesto con el que no estés de acuerdo para registrarlo como
                rechazado en tu bitácora de decisiones.
              </p>
              <div className="assumptions-grid">
                {supuestosActuales.map((supuesto, idx) => (
                  <label key={idx} className="checkbox-row assumption-row">
                    <input
                      type="checkbox"
                      checked={estadoSupuestos[idx] !== false}
                      onChange={(e) =>
                        setEstadoSupuestos((prev) => ({
                          ...prev,
                          [idx]: e.target.checked,
                        }))
                      }
                      disabled={cargando}
                      data-testid={`assumption-checkbox-${idx}`}
                    />
                    <span>{supuesto}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="button-group">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onVolverPaso1}
              disabled={cargando}
            >
              ← Volver al Paso 1
            </button>
            <button
              type="button"
              className="btn btn-primary btn-glow"
              onClick={handleConfirmarYAvanzar}
              disabled={cargando}
              data-testid="confirm-step2-btn"
            >
              {cargando
                ? '⏳ Generando propuesta de Modelo Conceptual...'
                : 'Confirmar aclaraciones y pasar al Modelo Conceptual (Paso 3) →'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
