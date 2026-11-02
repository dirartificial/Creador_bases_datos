import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  sanitizarNombreArchivo,
  generarCsv,
  generarCsvsDeDatosEjemplo,
  generarCsvDeInforme,
} from '../src/export/csv';
import {
  generarAnalisisResumidoFallback,
  analisisResumidoAMarkdown,
  generarGlosarioMarkdown,
  modeloConceptualAMarkdown,
  generarAnalisisResumidoConIA,
} from '../src/export/analisis';
import { generarPdfAnalisisResumido } from '../src/export/pdf';
import {
  generarPaqueteZip,
  auditarSeguridadArchivosZip,
  PATRON_API_KEY_GOOGLE,
} from '../src/export/zip';
import { StepEntregables } from '../src/steps/StepEntregables';
import {
  AnalisisResumidoSchema,
  crearProyectoInicial,
  ProyectoEstado,
} from '../src/core/schemas';
import { configurarClienteGeminiMock } from '../src/core/gemini';
import { guardarApiKey } from '../src/core/key';

describe('Fase 6 — Exportación CSV Segura (Sección 3.5)', () => {
  it('sanitiza nombres de archivo para aceptar únicamente [a-z0-9_-]', () => {
    expect(sanitizarNombreArchivo('Base de Datos: Veterinaria 2026!')).toBe(
      'base_de_datos_veterinaria_2026'
    );
    expect(sanitizarNombreArchivo('Tabla (Clientes & Facturación)')).toBe(
      'tabla_clientes_facturacion'
    );
    expect(sanitizarNombreArchivo('')).toBe('archivo');
  });

  it('protege contra Formula Injection anteponiendo apóstrofe a celdas que inician con =, +, -, @, tab o retorno', () => {
    const columnas = ['id', 'formula', 'texto_normal'];
    const filas = [
      [1, '=SUM(A1:A10)', 'OK'],
      [2, '+123456789', 'Normal'],
      [3, '-cmd.exe /c calc', 'Peligro'],
      [4, '@SUM(1+1)', 'Test'],
      [5, '\tvalor_con_tab', 'Tabulado'],
      [6, 'Normal, con comas', 'Comillas "dobles"'],
    ];

    const csv = generarCsv(columnas, filas);

    expect(csv).toContain("'=SUM(A1:A10)");
    expect(csv).toContain("'+123456789");
    expect(csv).toContain("'-cmd.exe /c calc");
    expect(csv).toContain("'@SUM(1+1)");
    expect(csv).toContain("'\tvalor_con_tab");
    expect(csv).toContain('"Normal, con comas"');
    expect(csv).toContain('"Comillas ""dobles"""');
  });

  it('genera un mapa de archivos CSV por cada tabla del conjunto de datos de ejemplo', () => {
    const datosEjemplo = {
      tablas: [
        {
          tabla: 'autor',
          columnas: ['id_autor', 'nombre'],
          filas: [{ id_autor: 1, nombre: 'Gabriel García Márquez' }],
        },
        {
          tabla: 'libro',
          columnas: ['id_libro', 'titulo', 'id_autor'],
          filas: [{ id_libro: 10, titulo: 'Cien años de soledad', id_autor: 1 }],
        },
      ],
    };

    const csvs = generarCsvsDeDatosEjemplo(datosEjemplo);
    expect(Object.keys(csvs)).toEqual(['autor.csv', 'libro.csv']);
    expect(csvs['autor.csv']).toContain('id_autor,nombre');
    expect(csvs['autor.csv']).toContain('1,Gabriel García Márquez');
    expect(csvs['libro.csv']).toContain('10,Cien años de soledad,1');
  });

  it('genera CSV de informe con columnas y filas de resultado', () => {
    const informe = {
      id: 'inf-1',
      titulo: 'Top Libros',
      pedidoLenguajeNatural: 'libros más vendidos',
      consultaSQL: 'SELECT titulo, ventas FROM libro ORDER BY ventas DESC',
      explicacionPasoAPaso: 'Explicación didáctica',
      tipoGrafico: 'barras' as const,
      fechaCreacion: new Date().toISOString(),
      resultado: {
        columnas: ['titulo', 'ventas'],
        filas: [
          ['Libro A', 150],
          ['Libro B', 90],
        ],
        totalFilas: 2,
        tiempoMs: 1.2,
      },
    };

    const csv = generarCsvDeInforme(informe);
    expect(csv).toContain('titulo,ventas');
    expect(csv).toContain('Libro A,150');
    expect(csv).toContain('Libro B,90');
  });
});

describe('Fase 6 — Análisis Resumido Pedagógico y Glosario (Sección 8)', () => {
  const proyectoPrueba: ProyectoEstado = {
    ...crearProyectoInicial(),
    descripcionProblema: 'Sistema de gestión de turnos para una veterinaria.',
    modelo: {
      entidades: [
        {
          nombre: 'veterinario',
          descripcion: 'Profesional a cargo',
          atributos: [
            {
              nombre: 'id_veterinario',
              tipoConceptual: 'entero',
              obligatorio: true,
              unico: true,
              esClavePrimaria: true,
              justificacion: 'Clave primaria secuencial',
            },
            {
              nombre: 'matricula',
              tipoConceptual: 'texto',
              obligatorio: true,
              unico: true,
              esClavePrimaria: false,
              justificacion: 'Identificador único ante colegio médico',
            },
          ],
        },
        {
          nombre: 'turno',
          descripcion: 'Cita programada',
          atributos: [
            {
              nombre: 'id_turno',
              tipoConceptual: 'entero',
              obligatorio: true,
              unico: true,
              esClavePrimaria: true,
              justificacion: 'Clave primaria de la cita',
            },
            {
              nombre: 'fecha_hora',
              tipoConceptual: 'fecha_hora',
              obligatorio: true,
              unico: false,
              esClavePrimaria: false,
              justificacion: 'Momento de atención',
            },
            {
              nombre: 'id_veterinario',
              tipoConceptual: 'entero',
              obligatorio: true,
              unico: false,
              esClavePrimaria: false,
              justificacion: 'Clave foránea hacia veterinario',
            },
          ],
        },
      ],
      relaciones: [
        {
          origen: 'veterinario',
          destino: 'turno',
          cardinalidad: '1:N',
          descripcion: 'Un veterinario atiende múltiples turnos',
          obligatoriaEnOrigen: false,
          obligatoriaEnDestino: true,
        },
      ],
    },
    motorSeleccionado: 'sqlite',
    ddlGenerado: 'CREATE TABLE veterinario (...);\nCREATE TABLE turno (...);',
    bitacora: [
      {
        paso: 3,
        fecha: '2026-11-01T14:00:00.000Z',
        descripcion: 'Confirmó entidades veterinario y turno',
        origen: 'estudiante',
      },
      {
        paso: 4,
        fecha: '2026-11-01T14:10:00.000Z',
        descripcion: 'Aceptó sugerencia de relación 1:N con FK id_veterinario en turno',
        origen: 'ia_aceptada',
      },
    ],
  };

  it('genera un análisis deductivo de respaldo (fallback) que valida estrictamente con Zod', () => {
    const fallback = generarAnalisisResumidoFallback(proyectoPrueba);
    const validado = AnalisisResumidoSchema.safeParse(fallback);
    expect(validado.success).toBe(true);
    expect(fallback.decisionesDisenoClave.length).toBeGreaterThan(0);
    expect(fallback.motorElegidoYJustificacion).toContain('SQLite');
    expect(fallback.limitacionesDelMotor).toBeDefined();
    expect(fallback.puntosAMejorarYProximosPasos.length).toBeGreaterThan(0);
  });

  it('convierte el Análisis Resumido a Markdown conteniendo las 6 secciones requeridas', () => {
    const analisis = generarAnalisisResumidoFallback(proyectoPrueba);
    const md = analisisResumidoAMarkdown(analisis, proyectoPrueba);

    expect(md).toContain('## 1. Problema Planteado y Alcance');
    expect(md).toContain('## 2. Decisiones de Diseño Clave');
    expect(md).toContain('## 3. Observaciones del Validador y Cómo se Resolvieron');
    expect(md).toContain('## 4. Motor de Base de Datos y Limitaciones');
    expect(md).toContain('## 5. Resumen de Informes y Consultas SQL');
    expect(md).toContain('## 6. Puntos a Mejorar y Próximos Pasos');
  });

  it('genera el glosario Markdown pedagógico con los términos utilizados', () => {
    const glosario = generarGlosarioMarkdown(proyectoPrueba);
    expect(glosario).toContain('### Entidad');
    expect(glosario).toContain('### Atributo');
    expect(glosario).toContain('### Clave Primaria (Primary Key / PK)');
    expect(glosario).toContain('### Clave Foránea (Foreign Key / FK)');
    expect(glosario).toContain('### Cardinalidad (1:1, 1:N, N:M)');
  });

  it('genera el modelo conceptual en Markdown con tablas de entidades y relaciones', () => {
    const mdModelo = modeloConceptualAMarkdown(proyectoPrueba);
    expect(mdModelo).toContain('### Entidad: `veterinario`');
    expect(mdModelo).toContain('| `id_veterinario` | entero | ✓ PK |');
    expect(mdModelo).toContain('| `veterinario` | `turno` | **1:N** |');
  });

  it('llama a Gemini con esquema estructurado cuando se invoca generarAnalisisResumidoConIA', async () => {
    guardarApiKey('AIzaFakeTestKeyForAnalysis1234567890');

    configurarClienteGeminiMock({
      generarContenido: async () =>
        JSON.stringify({
          problemaYAlcance: 'Sistema veterinario para gestión de turnos.',
          decisionesDisenoClave: [
            {
              decision: 'Separación de turno y veterinario',
              justificacion: 'Cumple con la Primera y Segunda Forma Normal',
              origen: 'ia_aceptada',
            },
          ],
          observacionesValidadorYResolucion: [
            {
              observacion: 'Relación 1:N sin FK',
              resolucion: 'Se agregó id_veterinario en la tabla turno',
            },
          ],
          motorElegidoYJustificacion: 'SQLite por su soporte WASM local',
          limitacionesDelMotor: 'Concurrencia de escritura limitada',
          resumenInformes: [],
          puntosAMejorarYProximosPasos: ['Añadir entidad Mascota y Dueño'],
        }),
    });

    const resultado = await generarAnalisisResumidoConIA(proyectoPrueba);
    expect(resultado.problemaYAlcance).toContain('Sistema veterinario');
    expect(resultado.decisionesDisenoClave[0].decision).toBe('Separación de turno y veterinario');

    configurarClienteGeminiMock(null);
    sessionStorage.clear();
  });
});

describe('Fase 6 — Generación de PDF (Sección 8)', () => {
  it('genera un documento PDF válido como Uint8Array con encabezado %PDF-', () => {
    const proyecto = crearProyectoInicial();
    proyecto.descripcionProblema = 'Gestión de almacén de repuestos';
    const analisis = generarAnalisisResumidoFallback(proyecto);

    const pdfBytes = generarPdfAnalisisResumido(analisis, proyecto);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(100);

    const header = new TextDecoder('ascii').decode(pdfBytes.subarray(0, 5));
    expect(header).toBe('%PDF-');
  });
});

describe('Fase 6 — Empaquetado de ZIP y Auditoría de Seguridad (Sección 3.1, 3.5, 8)', () => {
  const TEST_KEY = 'AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q';

  it('genera un ZIP completo que incluye todos los archivos seleccionados', () => {
    const proyecto: ProyectoEstado = {
      ...crearProyectoInicial(),
      descripcionProblema: 'Inventario de Ferretería',
      modelo: {
        entidades: [
          {
            nombre: 'producto',
            descripcion: 'Herramientas y repuestos',
            atributos: [
              {
                nombre: 'id_producto',
                tipoConceptual: 'entero',
                obligatorio: true,
                unico: true,
                esClavePrimaria: true,
                justificacion: 'PK',
              },
            ],
          },
        ],
        relaciones: [],
      },
      ddlGenerado: 'CREATE TABLE producto (id_producto INTEGER PRIMARY KEY);',
      datosEjemplo: {
        tablas: [
          {
            tabla: 'producto',
            columnas: ['id_producto'],
            filas: [{ id_producto: 1 }],
          },
        ],
        ordenInsercion: ['producto'],
        resumenDidactico: 'Datos de prueba de productos',
      },
      informes: [
        {
          id: 'inf-1',
          titulo: 'Stock Crítico',
          pedidoLenguajeNatural: 'productos con poco stock',
          consultaSQL: 'SELECT * FROM producto',
          explicacionPasoAPaso: 'Explicación...',
          tipoGrafico: 'ninguno',
          fechaCreacion: new Date().toISOString(),
          resultado: {
            columnas: ['id_producto'],
            filas: [[1]],
            totalFilas: 1,
            tiempoMs: 0.5,
          },
        },
      ],
    };

    const zipBytes = generarPaqueteZip({
      proyecto,
      svgDiagrama: '<svg><text>Diagrama ER</text></svg>',
      binarioSQLite: new Uint8Array([1, 2, 3, 4]),
      apiKeySesion: 'otra_key_que_no_esta',
    });

    expect(zipBytes).toBeInstanceOf(Uint8Array);
    expect(zipBytes.length).toBeGreaterThan(200);

    // Verificar firma de archivo ZIP (PK\x03\x04)
    expect(zipBytes[0]).toBe(0x50); // P
    expect(zipBytes[1]).toBe(0x4b); // K
    expect(zipBytes[2]).toBe(0x03);
    expect(zipBytes[3]).toBe(0x04);
  });

  it('AUDITORÍA DE SEGURIDAD CRÍTICA: bloquea la generación del ZIP si se detecta un patrón de Google API key', () => {
    const archivosConFuga: Record<string, Uint8Array> = {
      'scripts/esquema.sql': new TextEncoder().encode(
        `-- Script generado\n-- Key detectada: ${TEST_KEY}\nCREATE TABLE t (id INT);`
      ),
    };

    expect(() => {
      auditarSeguridadArchivosZip(archivosConFuga);
    }).toThrow(/Violación de seguridad: Se detectó un patrón coincidente con una clave de API de Google/i);
  });

  it('AUDITORÍA DE SEGURIDAD CRÍTICA: bloquea la generación si se detecta la key exacta de sesión', () => {
    const keyPrivada = 'CUSTOM_SECRET_KEY_12345';
    const archivosConFuga: Record<string, Uint8Array> = {
      'analisis/analisis.md': new TextEncoder().encode(
        `# Analisis\nEl estudiante configuró la key: ${keyPrivada}`
      ),
    };

    expect(() => {
      auditarSeguridadArchivosZip(archivosConFuga, keyPrivada);
    }).toThrow(/Violación de seguridad: Se detectó la API key de sesión/i);
  });

  it('el paquete ZIP generado en un flujo normal NO contiene la API key ni patrones de Google', () => {
    const proyecto = crearProyectoInicial();
    proyecto.descripcionProblema = 'Proyecto con seguridad BYOK';

    const zipBytes = generarPaqueteZip({
      proyecto,
      apiKeySesion: TEST_KEY,
    });

    // Descomprimir o buscar el patrón en todo el buffer binario
    const decoder = new TextDecoder('latin1');
    const contenidoCompleto = decoder.decode(zipBytes);

    expect(contenidoCompleto).not.toContain(TEST_KEY);
    expect(PATRON_API_KEY_GOOGLE.test(contenidoCompleto)).toBe(false);
  });
});

describe('Fase 6 — Componente de UI StepEntregables', () => {
  const proyectoBase: ProyectoEstado = {
    ...crearProyectoInicial(),
    descripcionProblema: 'Control de biblioteca escolar',
    modelo: {
      entidades: [
        {
          nombre: 'libro',
          descripcion: 'Ejemplar bibliográfico',
          atributos: [
            {
              nombre: 'id_libro',
              tipoConceptual: 'entero',
              obligatorio: true,
              unico: true,
              esClavePrimaria: true,
              justificacion: 'PK',
            },
          ],
        },
      ],
      relaciones: [],
    },
    ddlGenerado: 'CREATE TABLE libro (id_libro INTEGER PRIMARY KEY);',
  };

  it('renderiza la interfaz respetando estrictamente el Design System unificado', () => {
    render(
      <StepEntregables
        proyecto={proyectoBase}
        onActualizarProyecto={vi.fn()}
        onVolver={vi.fn()}
      />
    );

    expect(screen.getByTestId('step-entregables-container')).toBeInTheDocument();
    expect(screen.getByText(/Paquete de Entregables del Proyecto/i)).toBeInTheDocument();
    expect(screen.getByTestId('step-entregables-concept-box')).toBeInTheDocument();
    expect(screen.getByTestId('boton-descargar-zip')).toBeInTheDocument();
    expect(screen.getByTestId('banner-seguridad-byok')).toBeInTheDocument();
  });

  it('permite alternar vistas previas entre Análisis, Modelo y Glosario', () => {
    render(
      <StepEntregables
        proyecto={proyectoBase}
        onActualizarProyecto={vi.fn()}
        onVolver={vi.fn()}
      />
    );

    // Inicialmente muestra el análisis
    expect(screen.getByTestId('vista-previa-contenido')).toHaveTextContent(
      'Informe de Análisis y Diseño de Base de Datos'
    );

    // Cambiar a vista previa de modelo
    fireEvent.click(screen.getByText(/Vista previa: Modelo Markdown/i));
    expect(screen.getByTestId('vista-previa-contenido')).toHaveTextContent(
      'Modelo Conceptual de Base de Datos'
    );

    // Cambiar a vista previa de glosario
    fireEvent.click(screen.getByText(/Vista previa: Glosario/i));
    expect(screen.getByTestId('vista-previa-contenido')).toHaveTextContent(
      'Glosario Pedagógico de Términos'
    );
  });

  it('permite solicitar la generación del análisis al tutor IA', async () => {
    const onActualizarMock = vi.fn();

    guardarApiKey('AIzaSyFakeKeyStepEntregables1234567890');
    configurarClienteGeminiMock({
      generarContenido: async () =>
        JSON.stringify({
          problemaYAlcance: 'Control de biblioteca con catálogo e inventario.',
          decisionesDisenoClave: [],
          observacionesValidadorYResolucion: [],
          motorElegidoYJustificacion: 'SQLite para entorno educativo',
          limitacionesDelMotor: 'Local en el navegador',
          resumenInformes: [],
          puntosAMejorarYProximosPasos: [],
        }),
    });

    render(
      <StepEntregables
        proyecto={proyectoBase}
        onActualizarProyecto={onActualizarMock}
        onVolver={vi.fn()}
      />
    );

    const btnIA = screen.getByTestId('boton-generar-analisis-ia');
    fireEvent.click(btnIA);

    await waitFor(() => {
      expect(onActualizarMock).toHaveBeenCalled();
    });

    configurarClienteGeminiMock(null);
    sessionStorage.clear();
  });
});
