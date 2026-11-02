import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../src/App';
import { guardarApiKey } from '../src/core/key';
import { PRESET_BIBLIOTECA, PRESET_VETERINARIA, PRESET_TIENDA } from '../src/core/presets';

describe('Resumen de Diseño y Estado de Pendientes (SQLite WASM, Análisis e Informes Confirmados)', () => {
  beforeEach(() => {
    guardarApiKey('AIzaSyValidDummyApiKey1234567890abcdef');
  });

  it('los presets incluyen SQLite WASM generado, Informes confirmados y Análisis pedagógico', () => {
    const biblio = PRESET_BIBLIOTECA.generarProyectoCompleto();
    expect(biblio.baseSQLiteGenerada).toBe(true);
    expect(biblio.informesConfirmados).toBe(true);
    expect(biblio.analisisResumido).toBeDefined();
    expect(biblio.informes?.length).toBeGreaterThan(0);

    const vet = PRESET_VETERINARIA.generarProyectoCompleto();
    expect(vet.baseSQLiteGenerada).toBe(true);
    expect(vet.informesConfirmados).toBe(true);
    expect(vet.analisisResumido).toBeDefined();
    expect(vet.informes?.length).toBeGreaterThan(0);

    const tienda = PRESET_TIENDA.generarProyectoCompleto();
    expect(tienda.baseSQLiteGenerada).toBe(true);
    expect(tienda.informesConfirmados).toBe(true);
    expect(tienda.analisisResumido).toBeDefined();
    expect(tienda.informes?.length).toBeGreaterThan(0);
  });

  it('los azulejos del Resumen de Diseño en la barra lateral son botones interactivos para navegar entre pasos', () => {
    render(<App />);

    // Buscar los botones del Resumen de Diseño en el aside
    const botonSQLite = screen.getByTitle(/Paso 7: Estado del motor SQLite WASM/i);
    expect(botonSQLite).toBeDefined();
    expect(botonSQLite.tagName.toLowerCase()).toBe('button');

    const botonAnalisis = screen.getByTitle(/Paso 9: Análisis pedagógico estructurado/i);
    expect(botonAnalisis).toBeDefined();
    expect(botonAnalisis.tagName.toLowerCase()).toBe('button');

    const botonInfConf = screen.getByTitle(/Paso 8: Informes analíticos confirmados/i);
    expect(botonInfConf).toBeDefined();
    expect(botonInfConf.tagName.toLowerCase()).toBe('button');
  });
});
