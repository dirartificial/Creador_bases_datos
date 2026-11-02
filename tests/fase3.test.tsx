import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { guardarApiKey } from '../src/core/key';
import { Entidad, Modelo, Relacion } from '../src/core/schemas';
import {
  detectarClavesForaneas,
  generarMermaidEr,
  mapearTipoConceptualAMermaid,
  normalizarIdentificadorAtributo,
  normalizarIdentificadorEntidad,
  obtenerFlagsClave,
  obtenerSimbolosCardinalidad,
  sanitizarTextoMermaid,
} from '../src/core/erDiagram';
import {
  descargarArchivo,
  exportarSvgAPng,
  obtenerDimensionesSvg,
  sanitizarSvg,
} from '../src/export/svg';
import { renderizarDiagramaMermaid } from '../src/core/mermaidRenderer';
import { guardarProyectoEnIndexedDB, reiniciarProyectoEnIndexedDB } from '../src/core/storage';

const FAKE_KEY = 'AIzaSyTestKeyFase3_1234567890abcdefXYZ';

// Mock SVG layout methods para jsdom
if (typeof window !== 'undefined' && window.SVGElement) {
  (window.SVGElement.prototype as unknown as { getBBox: () => unknown }).getBBox = () => ({
    x: 0,
    y: 0,
    width: 250,
    height: 120,
    top: 0,
    right: 250,
    bottom: 120,
    left: 0,
    toJSON: () => {},
  });
  (
    window.SVGElement.prototype as unknown as { getComputedTextLength: () => number }
  ).getComputedTextLength = () => 60;
}

// Fixtures para tests
const entidadCliente: Entidad = {
  nombre: 'Cliente',
  descripcion: 'Dueño de las mascotas',
  atributos: [
    {
      nombre: 'id_cliente',
      tipoConceptual: 'entero',
      obligatorio: true,
      unico: true,
      esClavePrimaria: true,
      justificacion: 'Identificador único del cliente',
    },
    {
      nombre: 'nombre',
      tipoConceptual: 'texto',
      obligatorio: true,
      unico: false,
      esClavePrimaria: false,
      justificacion: 'Nombre del cliente',
    },
    {
      nombre: 'email',
      tipoConceptual: 'texto',
      obligatorio: true,
      unico: true,
      esClavePrimaria: false,
      justificacion: 'Correo electrónico único',
    },
  ],
};

const entidadMascota: Entidad = {
  nombre: 'Mascota',
  descripcion: 'Animales de los clientes',
  atributos: [
    {
      nombre: 'id_mascota',
      tipoConceptual: 'entero',
      obligatorio: true,
      unico: true,
      esClavePrimaria: true,
      justificacion: 'Identificador único de la mascota',
    },
    {
      nombre: 'id_cliente',
      tipoConceptual: 'entero',
      obligatorio: true,
      unico: false,
      esClavePrimaria: false,
      justificacion: 'Dueño de la mascota (FK)',
    },
    {
      nombre: 'nombre',
      tipoConceptual: 'texto',
      obligatorio: true,
      unico: false,
      esClavePrimaria: false,
      justificacion: 'Nombre de la mascota',
    },
    {
      nombre: 'fecha_nacimiento',
      tipoConceptual: 'fecha',
      obligatorio: false,
      unico: false,
      esClavePrimaria: false,
      justificacion: 'Fecha de nacimiento',
    },
    {
      nombre: 'activo',
      tipoConceptual: 'booleano',
      obligatorio: true,
      unico: false,
      esClavePrimaria: false,
      justificacion: 'Estado activo o dado de baja',
    },
  ],
};

const entidadTurno: Entidad = {
  nombre: 'Turno',
  descripcion: 'Citas y consultas veterinarias',
  atributos: [
    {
      nombre: 'id_turno',
      tipoConceptual: 'entero',
      obligatorio: true,
      unico: true,
      esClavePrimaria: true,
      justificacion: 'Identificador único del turno',
    },
    {
      nombre: 'id_mascota',
      tipoConceptual: 'entero',
      obligatorio: true,
      unico: false,
      esClavePrimaria: false,
      justificacion: 'Mascota citada (FK)',
    },
    {
      nombre: 'fecha_hora',
      tipoConceptual: 'fecha_hora',
      obligatorio: true,
      unico: false,
      esClavePrimaria: false,
      justificacion: 'Momento exacto del turno',
    },
    {
      nombre: 'costo',
      tipoConceptual: 'decimal',
      obligatorio: true,
      unico: false,
      esClavePrimaria: false,
      justificacion: 'Precio estimado de la atención',
    },
  ],
};

const relacionClienteMascota: Relacion = {
  origen: 'Cliente',
  destino: 'Mascota',
  cardinalidad: '1:N',
  descripcion: 'tiene registradas',
  obligatoriaEnOrigen: true,
  obligatoriaEnDestino: false,
};

const relacionMascotaTurno: Relacion = {
  origen: 'Mascota',
  destino: 'Turno',
  cardinalidad: '1:N',
  descripcion: 'recibe atenciones en',
  obligatoriaEnOrigen: false,
  obligatoriaEnDestino: true,
};

const modeloVeterinariaCompleto: Modelo = {
  entidades: [entidadCliente, entidadMascota, entidadTurno],
  relaciones: [relacionClienteMascota, relacionMascotaTurno],
};

describe('Fase 3 — Generador Determinístico de Diagramas ER Mermaid (erDiagram.ts)', () => {
  it('cumple con el snapshot test para el modelo completo de veterinaria', () => {
    const mermaidCode = generarMermaidEr(modeloVeterinariaCompleto);
    expect(mermaidCode).toMatchSnapshot();
  });

  it('mapea correctamente todos los tipos conceptuales a tipos de Mermaid', () => {
    expect(mapearTipoConceptualAMermaid('texto')).toBe('string');
    expect(mapearTipoConceptualAMermaid('entero')).toBe('int');
    expect(mapearTipoConceptualAMermaid('decimal')).toBe('float');
    expect(mapearTipoConceptualAMermaid('fecha')).toBe('date');
    expect(mapearTipoConceptualAMermaid('fecha_hora')).toBe('datetime');
    expect(mapearTipoConceptualAMermaid('booleano')).toBe('boolean');
  });

  it('normaliza identificadores de entidades y atributos con caracteres especiales o espacios', () => {
    expect(normalizarIdentificadorEntidad('Detalle Pedido')).toBe('Detalle_Pedido');
    expect(normalizarIdentificadorEntidad('Cliente - VIP')).toBe('Cliente_VIP');
    expect(normalizarIdentificadorEntidad('  Mascota  ')).toBe('Mascota');

    expect(normalizarIdentificadorAtributo('fecha de alta')).toBe('fecha_de_alta');
    expect(normalizarIdentificadorAtributo('código-postal')).toBe('código_postal');
  });

  it('genera correctamente los símbolos de cardinalidad en notación Crow\'s Foot', () => {
    // 1:1 obligatoria/opcional
    const rel11Oblig = obtenerSimbolosCardinalidad({
      origen: 'A',
      destino: 'B',
      cardinalidad: '1:1',
      descripcion: 'asociado',
      obligatoriaEnOrigen: true,
      obligatoriaEnDestino: true,
    });
    expect(rel11Oblig.conectorMermaid).toBe('||--||');

    const rel11Opc = obtenerSimbolosCardinalidad({
      origen: 'A',
      destino: 'B',
      cardinalidad: '1:1',
      descripcion: 'asociado',
      obligatoriaEnOrigen: false,
      obligatoriaEnDestino: false,
    });
    expect(rel11Opc.conectorMermaid).toBe('|o--o|');

    // 1:N
    const rel1NOblig = obtenerSimbolosCardinalidad({
      origen: 'A',
      destino: 'B',
      cardinalidad: '1:N',
      descripcion: 'asociado',
      obligatoriaEnOrigen: true,
      obligatoriaEnDestino: true,
    });
    expect(rel1NOblig.conectorMermaid).toBe('||--|{');

    const rel1NOpc = obtenerSimbolosCardinalidad({
      origen: 'A',
      destino: 'B',
      cardinalidad: '1:N',
      descripcion: 'asociado',
      obligatoriaEnOrigen: true,
      obligatoriaEnDestino: false,
    });
    expect(rel1NOpc.conectorMermaid).toBe('||--o{');

    // N:M
    const relNMOblig = obtenerSimbolosCardinalidad({
      origen: 'A',
      destino: 'B',
      cardinalidad: 'N:M',
      descripcion: 'asociado',
      obligatoriaEnOrigen: true,
      obligatoriaEnDestino: true,
    });
    expect(relNMOblig.conectorMermaid).toBe('}|--|{');

    const relNMOpc = obtenerSimbolosCardinalidad({
      origen: 'A',
      destino: 'B',
      cardinalidad: 'N:M',
      descripcion: 'asociado',
      obligatoriaEnOrigen: false,
      obligatoriaEnDestino: false,
    });
    expect(relNMOpc.conectorMermaid).toBe('}o--o{');
  });

  it('detecta y asigna flags PK, FK, UK y compuestas (PK, FK)', () => {
    const fks = detectarClavesForaneas(modeloVeterinariaCompleto);
    expect(fks.get('Mascota')?.has('id_cliente')).toBe(true);
    expect(fks.get('Turno')?.has('id_mascota')).toBe(true);

    // Flags individuales
    expect(
      obtenerFlagsClave(entidadCliente.atributos[0], 'id_cliente', new Set())
    ).toBe('PK');
    expect(
      obtenerFlagsClave(entidadMascota.atributos[1], 'id_cliente', new Set(['id_cliente']))
    ).toBe('FK');
    expect(
      obtenerFlagsClave(entidadCliente.atributos[2], 'email', new Set())
    ).toBe('UK');

    // Flag compuesta PK, FK en tabla asociativa
    const attrCompuesto = {
      nombre: 'id_estudiante',
      tipoConceptual: 'entero' as const,
      obligatorio: true,
      unico: false,
      esClavePrimaria: true,
      justificacion: 'Clave compuesta',
    };
    expect(
      obtenerFlagsClave(attrCompuesto, 'id_estudiante', new Set(['id_estudiante']))
    ).toBe('PK, FK');
  });

  it('incluye entidades aisladas correctamente en la salida Mermaid', () => {
    const modeloConAislada: Modelo = {
      entidades: [
        {
          nombre: 'Configuracion',
          descripcion: 'Parámetros del sistema',
          atributos: [
            {
              nombre: 'clave',
              tipoConceptual: 'texto',
              obligatorio: true,
              unico: true,
              esClavePrimaria: true,
              justificacion: 'PK',
            },
          ],
        },
      ],
      relaciones: [],
    };

    const salida = generarMermaidEr(modeloConAislada);
    expect(salida).toContain('Configuracion {');
    expect(salida).toContain('string clave PK "PK"');
  });

  it('sanitiza texto de comentarios para evitar roturas de comillas en Mermaid', () => {
    expect(sanitizarTextoMermaid('Línea 1\n"Línea 2"')).toBe('Línea 1 Línea 2');
  });
});

describe('Fase 3 — Sanitización Estricta de SVG y Exportación Segura (svg.ts)', () => {
  it('elimina scripts inyectados y eventos maliciosos dentro de un SVG', () => {
    const svgMalicioso = `
      <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <script>alert('xss')</script>
        <circle cx="50" cy="50" r="40" onload="fetch('https://malicioso.com')" onclick="alert(1)" />
        <a href="javascript:stealData()">
          <text x="10" y="20">Texto legítimo</text>
        </a>
      </svg>
    `;

    const sanitizado = sanitizarSvg(svgMalicioso);

    // Debe preservar elementos SVG legítimos
    expect(sanitizado).toContain('<svg');
    expect(sanitizado).toContain('<circle');
    expect(sanitizado).toContain('Texto legítimo');

    // DEBE eliminar scripts, eventos y URLs javascript
    expect(sanitizado).not.toContain('<script>');
    expect(sanitizado).not.toContain('alert');
    expect(sanitizado).not.toContain('onload');
    expect(sanitizado).not.toContain('onclick');
    expect(sanitizado).not.toContain('javascript:');
    expect(sanitizado).not.toContain('stealData');
  });

  it('extrae dimensiones válidas desde viewBox o atributos width/height', () => {
    const svgConViewBox = '<svg viewBox="0 0 850 420"><rect /></svg>';
    expect(obtenerDimensionesSvg(svgConViewBox)).toEqual({ ancho: 850, alto: 420 });

    const svgConWidthHeight = '<svg width="600" height="300"><rect /></svg>';
    expect(obtenerDimensionesSvg(svgConWidthHeight)).toEqual({ ancho: 600, alto: 300 });

    const svgVacio = '<svg></svg>';
    expect(obtenerDimensionesSvg(svgVacio)).toEqual({ ancho: 1000, alto: 700 });
  });

  it('descargarArchivo genera un elemento de descarga temporal y revoca el ObjectURL', () => {
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    descargarArchivo('erDiagram\n  A ||--|| B : tiene', 'diagrama.mmd', 'text/plain');

    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();

    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
    clickSpy.mockRestore();
  });

  it('exportarSvgAPng rechaza o convierte adecuadamente según el entorno', async () => {
    // Si canvas toBlob está soportado o mockeado
    const canvasMock = {
      getContext: vi.fn().mockReturnValue({
        fillStyle: '',
        fillRect: vi.fn(),
        drawImage: vi.fn(),
      }),
      toBlob: vi.fn((cb: (blob: Blob | null) => void) => {
        cb(new Blob(['fake-png-data'], { type: 'image/png' }));
      }),
      width: 0,
      height: 0,
    };

    const createElementOrig = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName.toLowerCase() === 'canvas') {
        return canvasMock as unknown as HTMLCanvasElement;
      }
      return createElementOrig(tagName);
    });

    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-svg');
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    // Simular Image onload inmediatamente
    const originalImage = globalThis.Image;
    class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_val: string) {
        setTimeout(() => this.onload?.(), 10);
      }
    }
    // @ts-expect-error Mock Image en jsdom
    globalThis.Image = MockImage;

    const blobRes = await exportarSvgAPng('<svg viewBox="0 0 100 100"></svg>', 2);
    expect(blobRes).toBeInstanceOf(Blob);

    globalThis.Image = originalImage;
    vi.restoreAllMocks();
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
  });
});

describe('Fase 3 — Renderizado Seguro Mermaid (mermaidRenderer.ts)', () => {
  it('renderiza un diagrama Mermaid válido devolviendo SVG sanitizado', async () => {
    const resultado = await renderizarDiagramaMermaid('erDiagram\n  CLIENTE ||--o{ MASCOTA : tiene');
    expect(resultado.svgSanitizado).toBeTruthy();
    expect(resultado.svgSanitizado).toContain('<svg');
    expect(resultado.svgSanitizado).not.toContain('<script');
  });

  it('renderiza entidades con sus atributos y columnas visibles como elementos de texto SVG', async () => {
    const codigo = `erDiagram
  Cliente ||--o{ Mascota : tiene
  Cliente {
    int id_cliente PK "ID"
    string nombre "Nombre"
  }`;
    const resultado = await renderizarDiagramaMermaid(codigo);
    expect(resultado.svgSanitizado).toContain('id_cliente');
    expect(resultado.svgSanitizado).toContain('nombre');
    expect(resultado.svgSanitizado).toContain('int');
    expect(resultado.svgSanitizado).toContain('string');
    expect(resultado.svgSanitizado).toContain('PK');
  });
});

describe('Fase 3 — Flujo de Aceptación Paso 5 en la UI (Step5DiagramaER.tsx)', () => {
  beforeEach(async () => {
    window.sessionStorage.clear();
    await reiniciarProyectoEnIndexedDB();
  });

  afterEach(async () => {
    window.sessionStorage.clear();
    await reiniciarProyectoEnIndexedDB();
  });

  it('renderiza el diagrama ER en la UI, permite alternar a vista de código, copiar y confirmar el paso', async () => {
    guardarApiKey(FAKE_KEY);

    // Precargar proyecto en IndexedDB en el Paso 5 con relaciones confirmadas
    await guardarProyectoEnIndexedDB({
      version: 1,
      actualizadoEn: new Date().toISOString(),
      pasoActual: 5,
      descripcionProblema: 'Veterinaria canina y felina',
      rondasAclaracion: [],
      ultimaAclaracion: null,
      claridadConfirmada: true,
      modelo: modeloVeterinariaCompleto,
      explicacionModelo: 'Modelo conceptual confirmado.',
      modeloConceptualConfirmado: true,
      relacionesConfirmadas: true,
      explicacionRelaciones: 'Relaciones 1:N entre Cliente, Mascota y Turno.',
      diagramaConfirmado: false,
      bitacora: [],
    });

    render(<App />);

    // Verificar contenedor del Paso 5
    await waitFor(() => {
      expect(screen.getByTestId('step5-container')).toBeInTheDocument();
    });

    // Encabezado unificado
    expect(screen.getByText(/Diagrama Entidad-Relación \(ER\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Paso 5 de 8/i)).toBeInTheDocument();

    // Caja conceptual pedagógica
    expect(screen.getByTestId('step5-concept-box')).toBeInTheDocument();
    expect(screen.getAllByText(/Notación Crow's Foot/i)[0]).toBeInTheDocument();

    // Resumen del tutor IA
    expect(screen.getByTestId('tutor-er-summary')).toBeInTheDocument();
    expect(screen.getByText(/100% determinística/i)).toBeInTheDocument();

    // Visor del diagrama SVG renderizado
    await waitFor(() => {
      expect(screen.getByTestId('diagram-viewport')).toBeInTheDocument();
    });

    // Alternar vista a código Mermaid (.mmd)
    const btnToggle = screen.getByTestId('toggle-view-btn');
    fireEvent.click(btnToggle);

    expect(screen.getByTestId('code-view-container')).toBeInTheDocument();
    const preCodigo = screen.getByTestId('mermaid-code-pre');
    expect(preCodigo).toHaveTextContent('erDiagram');
    expect(preCodigo).toHaveTextContent('Cliente ||--o{ Mascota');

    // Volver a vista diagrama gráfico
    fireEvent.click(btnToggle);
    expect(screen.getByTestId('diagram-card-container')).toBeInTheDocument();

    // Botón copiar Mermaid al portapapeles
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });
    const btnCopiar = screen.getByTestId('copy-mermaid-btn');
    fireEvent.click(btnCopiar);
    expect(writeTextMock).toHaveBeenCalled();

    // Botones de descarga .mmd y .svg (esperar a que termine de renderizar el SVG)
    expect(screen.getByTestId('download-mmd-btn')).not.toBeDisabled();
    await waitFor(() => {
      expect(screen.getByTestId('download-svg-btn')).not.toBeDisabled();
      expect(screen.getByTestId('download-png-btn')).not.toBeDisabled();
    });

    // Confirmar Paso 5
    const btnConfirmar = screen.getByTestId('confirm-step5-btn');
    fireEvent.click(btnConfirmar);

    // Banner de confirmación en pantalla
    await waitFor(() => {
      expect(screen.getByTestId('diagram-confirmed-banner')).toBeInTheDocument();
    });

    // Se registra en la bitácora de trazabilidad
    expect(screen.getByTestId('decision-log')).toHaveTextContent(/Confirmó el Diagrama ER/i);
  });
});
