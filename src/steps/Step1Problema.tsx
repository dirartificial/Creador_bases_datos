import React, { useState } from 'react';
import { LISTA_PRESETS } from '../core/presets';

export interface Step1ProblemaProps {
  descripcionInicial: string;
  cargando: boolean;
  onConfirmarDescripcion: (descripcion: string) => Promise<void>;
  onCargarPresetCompleto?: (presetId: 'biblioteca' | 'veterinaria' | 'tienda') => void;
}

export function Step1Problema({
  descripcionInicial,
  cargando,
  onConfirmarDescripcion,
  onCargarPresetCompleto,
}: Step1ProblemaProps) {
  const [texto, setTexto] = useState<string>(descripcionInicial);
  const [errorLocal, setErrorLocal] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorLocal(null);
    const limpio = texto.trim();
    if (limpio.length < 10) {
      setErrorLocal(
        'Contanos un poco más sobre qué querés guardar (al menos 10 caracteres). Ejemplo: "una base para una veterinaria".'
      );
      return;
    }
    await onConfirmarDescripcion(limpio);
  };

  return (
    <section className="card studio-step-card" aria-labelledby="step1-title" data-testid="step1-container">
      <div className="step-header">
        <span className="step-badge">Paso 1 de 8</span>
        <div>
          <h2 id="step1-title" className="card-title">
            Describir el problema
          </h2>
          <p className="step-lead">
            Definí en lenguaje natural el sistema o dominio que querés modelar.
          </p>
        </div>
      </div>

      <details className="concept-box" data-testid="step1-concept-box">
        <summary className="concept-summary">
          💡 Explicación breve del concepto: ¿Por qué empezamos describiendo el problema?
        </summary>
        <div className="concept-content">
          <p>
            Antes de pensar en tablas o código SQL, en diseño de bases de datos relevamos el{' '}
            <strong>dominio del problema</strong> (también llamado <em>universo de discurso</em>).
          </p>
          <p>
            Contale al tutor con tus palabras qué organización o proyecto necesitás modelar, qué
            cosas querés registrar y para qué las vas a consultar. Si tu descripción es breve, en el
            siguiente paso el tutor te hará preguntas concretas para no asumir nada por su cuenta.
          </p>
        </div>
      </details>

      <div className="quick-ideas-bar">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <span className="quick-ideas-label" style={{ fontWeight: 700 }}>
            💡 Ejemplos pedagógicos precargados:
          </span>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Podés cargar la descripción o abrir el proyecto de demostración completo.
          </span>
        </div>

        <div className="quick-ideas-grid">
          {LISTA_PRESETS.map((preset) => (
            <div
              key={preset.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                background: 'var(--bg-surface)',
                padding: '0.35rem 0.6rem',
                borderRadius: '0.5rem',
                border: '1px solid var(--border-color)',
              }}
            >
              <button
                type="button"
                className="idea-chip-btn"
                style={{ padding: '0.2rem 0.5rem', fontSize: '0.82rem' }}
                disabled={cargando}
                onClick={() => setTexto(preset.promptInicial)}
                title="Cargar descripción inicial en el formulario"
                data-testid={`preset-prompt-${preset.id}`}
              >
                {preset.emoji} {preset.titulo}
              </button>

              {onCargarPresetCompleto && (
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  style={{ fontSize: '0.72rem', padding: '0.2rem 0.45rem', color: 'var(--accent-cyan)' }}
                  disabled={cargando}
                  onClick={() => onCargarPresetCompleto(preset.id)}
                  title={`Cargar proyecto completo de ${preset.titulo} con modelo, DDL y datos listos`}
                  data-testid={`btn-cargar-completo-${preset.id}`}
                >
                  🚀 Cargar completo
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="descripcion-problema-input" className="form-label">
            ¿Qué querés guardar en tu base de datos?
          </label>
          <p className="form-help">
            Podés empezar con una idea general o detallar entidades, reglas y consultas que
            necesitás.
          </p>
          <textarea
            id="descripcion-problema-input"
            className="textarea-input"
            rows={5}
            placeholder="Ej.: Quiero una base para una veterinaria..."
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            disabled={cargando}
            data-testid="problem-description-input"
          />
        </div>

        <div className="criteria-modular-grid">
          <div className="criteria-mini-box">
            <strong>Entidades y Datos</strong>
            <span>¿Qué objetos o personas intervienen y qué atributos describen a cada uno?</span>
          </div>
          <div className="criteria-mini-box">
            <strong>Vínculos y Reglas</strong>
            <span>¿Cómo se relacionan entre sí y qué datos son únicos u obligatorios?</span>
          </div>
          <div className="criteria-mini-box">
            <strong>Consultas Esperadas</strong>
            <span>¿Qué preguntas o informes necesitarás responder con la base de datos?</span>
          </div>
        </div>

        {errorLocal && (
          <div role="alert" className="alert alert-error">
            {errorLocal}
          </div>
        )}

        <div className="button-group">
          <button
            type="submit"
            className="btn btn-primary btn-glow"
            disabled={cargando || !texto.trim()}
            data-testid="confirm-step1-btn"
          >
            {cargando
              ? '⏳ Evaluando claridad con Gemini...'
              : 'Confirmar descripción y evaluar claridad →'}
          </button>
        </div>
      </form>
    </section>
  );
}
