import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  TERMINOS_GLOSARIO,
  obtenerTerminosGlosario,
  buscarTerminosGlosario,
} from '../src/core/glossary';
import {
  LISTA_PRESETS,
  PRESET_BIBLIOTECA,
  PRESET_VETERINARIA,
  PRESET_TIENDA,
  obtenerPresetPorId,
} from '../src/core/presets';
import { ProyectoEstadoSchema, crearProyectoInicial } from '../src/core/schemas';
import { GlossaryModal } from '../src/steps/GlossaryModal';
import { App } from '../src/App';
import { guardarApiKey } from '../src/core/key';

const FAKE_KEY = 'AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Z987';

describe('Fase 9 — Glosario Pedagógico Integrado (glossary.ts)', () => {
  it('contiene definiciones para las 4 categorías requeridas', () => {
    expect(TERMINOS_GLOSARIO.length).toBeGreaterThanOrEqual(16);

    const categorias = new Set(TERMINOS_GLOSARIO.map((t) => t.categoria));
    expect(categorias.has('conceptual')).toBe(true);
    expect(categorias.has('relacional')).toBe(true);
    expect(categorias.has('nosql')).toBe(true);
    expect(categorias.has('consultas')).toBe(true);
  });

  it('permite filtrar términos por categoría', () => {
    const conceptuales = obtenerTerminosGlosario('conceptual');
    expect(conceptuales.length).toBeGreaterThan(0);
    expect(conceptuales.every((t) => t.categoria === 'conceptual')).toBe(true);

    const relacionales = obtenerTerminosGlosario('relacional');
    expect(relacionales.length).toBeGreaterThan(0);
    expect(relacionales.every((t) => t.categoria === 'relacional')).toBe(true);
  });

  it('busca términos en vivo por término, definición o sinónimos', () => {
    const resFK = buscarTerminosGlosario('foreign key');
    expect(resFK.some((t) => t.id === 'clave-foranea')).toBe(true);

    const resBSON = buscarTerminosGlosario('BSON');
    expect(resBSON.some((t) => t.id === 'documento-bson')).toBe(true);

    const resVacio = buscarTerminosGlosario('termino_inexistente_xyz_123');
    expect(resVacio).toHaveLength(0);
  });

  it('filtra términos relevantes según el estado del proyecto del estudiante', () => {
    const proyectoSQL = crearProyectoInicial();
    proyectoSQL.motorSeleccionado = 'sqlite';
    proyectoSQL.modelo.relaciones = [
      {
        origen: 'autores',
        destino: 'libros',
        cardinalidad: '1:N',
        descripcion: 'Un autor tiene muchos libros',
        obligatoriaEnOrigen: false,
        obligatoriaEnDestino: true,
      },
    ];
    const relevantesSQL = obtenerTerminosGlosario('todas', proyectoSQL, true);
    // Para SQLite debe incluir clave foránea
    expect(relevantesSQL.some((t) => t.id === 'clave-foranea')).toBe(true);

    const proyectoMongo = crearProyectoInicial();
    proyectoMongo.motorSeleccionado = 'mongodb';
    const relevantesMongo = obtenerTerminosGlosario('todas', proyectoMongo, true);
    expect(relevantesMongo.some((t) => t.id === 'documento-bson')).toBe(true);
  });
});

describe('Fase 9 — Ejemplos Precargados Completos (presets.ts)', () => {
  it('dispone de los tres dominios completos: Biblioteca, Veterinaria y Tienda', () => {
    expect(LISTA_PRESETS).toHaveLength(3);
    expect(obtenerPresetPorId('biblioteca')).toBe(PRESET_BIBLIOTECA);
    expect(obtenerPresetPorId('veterinaria')).toBe(PRESET_VETERINARIA);
    expect(obtenerPresetPorId('tienda')).toBe(PRESET_TIENDA);
  });

  it('PRESET_BIBLIOTECA genera un estado de proyecto válido con entidades y DDL', () => {
    const p = PRESET_BIBLIOTECA.generarProyectoCompleto();
    const validado = ProyectoEstadoSchema.parse(p);
    expect(validado.modelo.entidades.length).toBe(4);
    expect(validado.modelo.relaciones.length).toBe(3);
    expect(validado.ddlGenerado).toContain('CREATE TABLE "libros"');
    expect(validado.ddlGenerado).toContain('libros');
    expect(validado.datosEjemplo?.tablas.length).toBe(4);
    expect(validado.informes?.length).toBeGreaterThan(0);
  });

  it('PRESET_VETERINARIA genera un modelo válido con tratamientos y atenciones', () => {
    const p = PRESET_VETERINARIA.generarProyectoCompleto();
    const validado = ProyectoEstadoSchema.parse(p);
    expect(validado.modelo.entidades.some((e) => e.nombre === 'mascotas')).toBe(true);
    expect(validado.modelo.entidades.some((e) => e.nombre === 'tratamientos')).toBe(true);
    expect(validado.ddlGenerado).toContain('FOREIGN KEY');
  });

  it('PRESET_TIENDA genera un modelo válido de comercio electrónico', () => {
    const p = PRESET_TIENDA.generarProyectoCompleto();
    const validado = ProyectoEstadoSchema.parse(p);
    expect(validado.modelo.entidades.some((e) => e.nombre === 'productos')).toBe(true);
    expect(validado.modelo.entidades.some((e) => e.nombre === 'pedidos')).toBe(true);
  });
});

describe('Fase 9 — Modal de Glosario Accesible (GlossaryModal.tsx)', () => {
  it('renderiza con atributos ARIA y no es visible cuando abierto es false', () => {
    const { rerender } = render(
      <GlossaryModal abierto={false} onCerrar={() => {}} />
    );
    expect(screen.queryByTestId('glossary-modal')).not.toBeInTheDocument();

    rerender(<GlossaryModal abierto={true} onCerrar={() => {}} />);
    const modal = screen.getByTestId('glossary-modal');
    expect(modal).toBeInTheDocument();
    expect(modal).toHaveAttribute('role', 'dialog');
    expect(modal).toHaveAttribute('aria-modal', 'true');
  });

  it('permite filtrar términos escribiendo en el buscador en tiempo real', () => {
    render(<GlossaryModal abierto={true} onCerrar={() => {}} />);
    const searchInput = screen.getByTestId('glossary-search-input');

    fireEvent.change(searchInput, { target: { value: 'Normalización' } });
    expect(
      screen.getByText(/Proceso metodológico de diseño de bases de datos/i)
    ).toBeInTheDocument();
  });

  it('permite seleccionar categorías para filtrar las tarjetas', () => {
    render(<GlossaryModal abierto={true} onCerrar={() => {}} />);
    const chipRelacional = screen.getByTestId('glossary-chip-relacional');
    fireEvent.click(chipRelacional);

    // Debe mostrar conceptos relacionales
    expect(screen.getByText('DDL (Data Definition Language)')).toBeInTheDocument();
  });

  it('invoca onCerrar al presionar el botón de cerrar o la tecla Escape', () => {
    let cerrado = false;
    render(<GlossaryModal abierto={true} onCerrar={() => (cerrado = true)} />);

    const btnCerrar = screen.getByTestId('close-glossary-btn');
    fireEvent.click(btnCerrar);
    expect(cerrado).toBe(true);

    cerrado = false;
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(cerrado).toBe(true);
  });
});

describe('Fase 9 — Accesibilidad, Tema Claro/Oscuro y Carga en App', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('incluye el enlace skip-link accesible hacia el contenido principal', () => {
    render(<App />);
    const skipLink = screen.getByRole('link', { name: /saltar al contenido principal/i });
    expect(skipLink).toBeInTheDocument();
    expect(skipLink).toHaveAttribute('href', '#main-content');
  });

  it('permite alternar entre tema oscuro y claro persistiendo en localStorage y en data-theme', () => {
    render(<App />);
    const toggleBtn = screen.getByTestId('theme-toggle-btn');
    expect(toggleBtn).toHaveTextContent(/Modo Claro/i);

    fireEvent.click(toggleBtn);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem('db_tutor_theme')).toBe('light');
    expect(toggleBtn).toHaveTextContent(/Modo Oscuro/i);

    fireEvent.click(toggleBtn);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('db_tutor_theme')).toBe('dark');
  });

  it('abre el glosario interactivo desde el header principal', () => {
    render(<App />);
    const openGlossaryBtn = screen.getByTestId('open-glossary-btn');
    fireEvent.click(openGlossaryBtn);

    expect(screen.getByTestId('glossary-modal')).toBeInTheDocument();
  });

  it('permite cargar un preset completo de demostración desde el sidebar o Step 1', () => {
    guardarApiKey(FAKE_KEY);
    render(<App />);

    const presetBtn = screen.getByTestId('sidebar-preset-biblioteca');
    fireEvent.click(presetBtn);

    // Debe mostrar mensaje de éxito informando la carga del preset
    expect(screen.getByTestId('status-message')).toHaveTextContent(
      /¡Se cargó con éxito el proyecto de demostración "Biblioteca Escolar"!/i
    );
  });
});
