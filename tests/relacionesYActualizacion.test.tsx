import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { guardarApiKey } from '../src/core/key';
import {
  cargarProyectoDesdeIndexedDB,
  guardarProyectoEnIndexedDB,
  reiniciarProyectoEnIndexedDB,
} from '../src/core/storage';
import { generarDDLSQLite } from '../src/core/ddl/sqlite';
import { generarDDLPostgres } from '../src/core/ddl/postgres';
import { generarDDLMySQL } from '../src/core/ddl/mysql';
import { generarMermaidEr } from '../src/core/erDiagram';
import { validarModelo } from '../src/core/modelValidator';
import { Modelo } from '../src/core/schemas';

const FAKE_KEY = 'AIzaSyTestKeyRelaciones_1234567890abcdefXYZ';

describe('Selección explícita de campos en relaciones, avance de pasos y reactividad en proyectos completados', () => {
  beforeEach(async () => {
    window.sessionStorage.clear();
    await reiniciarProyectoEnIndexedDB();
    guardarApiKey(FAKE_KEY);
  });

  it('reconoce campos creados manualmente con nombres personalizados al seleccionarlos en la relación (Validador, Diagrama ER y DDL)', () => {
    const modeloConCampoManual: Modelo = {
      entidades: [
        {
          nombre: 'Clientes',
          descripcion: 'Clientes registrados',
          atributos: [
            {
              nombre: 'codigo_unico_cli',
              tipoConceptual: 'entero',
              obligatorio: true,
              unico: true,
              esClavePrimaria: true,
              justificacion: 'PK manual del cliente',
            },
            {
              nombre: 'nombre_completo',
              tipoConceptual: 'texto',
              obligatorio: true,
              unico: false,
              esClavePrimaria: false,
              justificacion: 'Nombre del cliente',
            },
          ],
        },
        {
          nombre: 'Pedidos',
          descripcion: 'Pedidos realizados',
          atributos: [
            {
              nombre: 'nro_pedido',
              tipoConceptual: 'entero',
              obligatorio: true,
              unico: true,
              esClavePrimaria: true,
              justificacion: 'PK manual del pedido',
            },
            {
              nombre: 'ref_comprador_manual',
              tipoConceptual: 'entero',
              obligatorio: true,
              unico: false,
              esClavePrimaria: false,
              justificacion: 'Campo foráneo agregado a mano con nombre personalizado',
            },
          ],
        },
      ],
      relaciones: [
        {
          origen: 'Clientes',
          destino: 'Pedidos',
          cardinalidad: '1:N',
          descripcion: 'Un cliente realiza muchos pedidos',
          obligatoriaEnOrigen: true,
          obligatoriaEnDestino: false,
          campoOrigen: 'codigo_unico_cli',
          campoDestino: 'ref_comprador_manual',
        },
      ],
    };

    // 1. El validador determinístico reconoce el campo manual y no arroja FK_FALTANTE
    const validacion = validarModelo(modeloConCampoManual);
    expect(validacion.valido).toBe(true);
    expect(validacion.observaciones.some((o) => o.codigo === 'FK_FALTANTE')).toBe(false);

    // 2. El diagrama ER marca ref_comprador_manual como FK
    const mermaid = generarMermaidEr(modeloConCampoManual);
    expect(mermaid).toContain('int ref_comprador_manual FK');

    // 3. Los generadores DDL incluyen la cláusula FOREIGN KEY exacta con los campos seleccionados
    const ddlSQLite = generarDDLSQLite(modeloConCampoManual);
    expect(ddlSQLite).toContain(
      'FOREIGN KEY ("ref_comprador_manual") REFERENCES "Clientes" ("codigo_unico_cli")'
    );

    const ddlPostgres = generarDDLPostgres(modeloConCampoManual);
    expect(ddlPostgres).toContain(
      'FOREIGN KEY ("ref_comprador_manual") REFERENCES "Clientes" ("codigo_unico_cli")'
    );

    const ddlMySQL = generarDDLMySQL(modeloConCampoManual);
    expect(ddlMySQL).toContain(
      'FOREIGN KEY (`ref_comprador_manual`) REFERENCES `Clientes` (`codigo_unico_cli`)'
    );
  });

  it('avanza automáticamente del Paso 3 al 4, del Paso 4 al 5 y del Paso 5 al 6 al confirmar cada etapa', async () => {
    await guardarProyectoEnIndexedDB({
      version: 1,
      actualizadoEn: new Date().toISOString(),
      pasoActual: 3,
      descripcionProblema: 'Sistema de biblioteca',
      rondasAclaracion: [],
      ultimaAclaracion: null,
      claridadConfirmada: true,
      modelo: {
        entidades: [
          {
            nombre: 'Autor',
            descripcion: 'Autores de libros',
            atributos: [
              {
                nombre: 'id_autor',
                tipoConceptual: 'entero',
                obligatorio: true,
                unico: true,
                esClavePrimaria: true,
                justificacion: 'PK',
              },
            ],
          },
          {
            nombre: 'Libro',
            descripcion: 'Libros publicados',
            atributos: [
              {
                nombre: 'id_libro',
                tipoConceptual: 'entero',
                obligatorio: true,
                unico: true,
                esClavePrimaria: true,
                justificacion: 'PK',
              },
              {
                nombre: 'autor_referencia_fk',
                tipoConceptual: 'entero',
                obligatorio: true,
                unico: false,
                esClavePrimaria: false,
                justificacion: 'Campo manual para relacionar con Autor',
              },
            ],
          },
        ],
        relaciones: [],
      },
      modeloConceptualConfirmado: false,
      relacionesConfirmadas: false,
      diagramaConfirmado: false,
      bitacora: [],
    });

    render(<App />);

    // Estamos en el Paso 3
    await waitFor(() => {
      expect(screen.getByTestId('step3-container')).toBeInTheDocument();
    });

    // Confirmar Paso 3 -> debe avanzar automáticamente al Paso 4
    fireEvent.click(screen.getByTestId('confirm-step3-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('step4-container')).toBeInTheDocument();
    });

    // En el Paso 4, seleccionar explícitamente el campo manual "autor_referencia_fk" en el selector de la relación
    fireEvent.change(screen.getByTestId('rel-origin-field-select'), {
      target: { value: 'id_autor' },
    });
    fireEvent.change(screen.getByTestId('rel-dest-field-select'), {
      target: { value: 'autor_referencia_fk' },
    });
    fireEvent.change(screen.getByTestId('rel-description-input'), {
      target: { value: 'Un autor escribe muchos libros' },
    });
    fireEvent.click(screen.getByTestId('save-relation-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('relation-card-0')).toBeInTheDocument();
      expect(screen.getByTestId('validator-clean-msg')).toBeInTheDocument();
    });

    // Confirmar Paso 4 -> debe avanzar automáticamente al Paso 5
    fireEvent.click(screen.getByTestId('confirm-step4-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('step5-container')).toBeInTheDocument();
    });

    // Confirmar Paso 5 -> debe avanzar automáticamente al Paso 6
    fireEvent.click(screen.getByTestId('confirm-step5-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('step6-container')).toBeInTheDocument();
    });
  });

  it('actualiza el DDL y los datos de ejemplo cuando se modifica el Paso 3 o 4 en un proyecto ya completado', async () => {
    // Proyecto ya completado con ddlGenerado y datosEjemplo cacheados
    await guardarProyectoEnIndexedDB({
      version: 1,
      actualizadoEn: new Date().toISOString(),
      pasoActual: 3,
      descripcionProblema: 'Veterinaria completa',
      rondasAclaracion: [],
      ultimaAclaracion: null,
      claridadConfirmada: true,
      modelo: {
        entidades: [
          {
            nombre: 'Cliente',
            descripcion: 'Dueño de mascota',
            atributos: [
              {
                nombre: 'id_cliente',
                tipoConceptual: 'entero',
                obligatorio: true,
                unico: true,
                esClavePrimaria: true,
                justificacion: 'PK',
              },
            ],
          },
          {
            nombre: 'Mascota',
            descripcion: 'Paciente animal',
            atributos: [
              {
                nombre: 'id_mascota',
                tipoConceptual: 'entero',
                obligatorio: true,
                unico: true,
                esClavePrimaria: true,
                justificacion: 'PK',
              },
            ],
          },
        ],
        relaciones: [
          {
            origen: 'Cliente',
            destino: 'Mascota',
            cardinalidad: '1:N',
            descripcion: 'Un cliente tiene muchas mascotas',
            obligatoriaEnOrigen: true,
            obligatoriaEnDestino: false,
          },
        ],
      },
      modeloConceptualConfirmado: true,
      relacionesConfirmadas: true,
      diagramaConfirmado: true,
      motorSeleccionado: 'sqlite',
      ddlGenerado: 'CREATE TABLE "Cliente" ("id_cliente" INTEGER PRIMARY KEY); CREATE TABLE "Mascota" ("id_mascota" INTEGER PRIMARY KEY);',
      ddlConfirmado: true,
      datosEjemplo: {
        tablas: [
          { tabla: 'Cliente', columnas: ['id_cliente'], filas: [{ id_cliente: 1 }] },
          { tabla: 'Mascota', columnas: ['id_mascota'], filas: [{ id_mascota: 1 }] },
        ],
        ordenInsercion: ['Cliente', 'Mascota'],
        resumenDidactico: 'Datos iniciales',
      },
      datosConfirmados: true,
      baseSQLiteGenerada: true,
      informes: [],
      informesConfirmados: true,
      bitacora: [],
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('step3-container')).toBeInTheDocument();
    });

    // Agregar manualmente un atributo en Mascota ("dueno_fk_manual", tipo entero)
    fireEvent.click(screen.getByTestId('add-attr-btn-1'));
    const inputNuevoAttr = screen.getByTestId('attr-name-1-1');
    fireEvent.change(inputNuevoAttr, { target: { value: 'dueno_fk_manual' } });
    fireEvent.change(screen.getByTestId('attr-type-1-1'), { target: { value: 'entero' } });

    // Confirmar Paso 3 (avanza automáticamente al Paso 4)
    fireEvent.click(screen.getByTestId('confirm-step3-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('step4-container')).toBeInTheDocument();
    });

    // Seleccionar "dueno_fk_manual" como el campo foráneo en la tarjeta de la relación existente
    const inlineFkSelect = screen.getByTestId('inline-fk-select-0');
    fireEvent.change(inlineFkSelect, { target: { value: 'dueno_fk_manual' } });

    // Verificar en IndexedDB que tanto ddlGenerado como datosEjemplo se sincronizaron con el nuevo campo y relación
    await waitFor(async () => {
      const actualizado = await cargarProyectoDesdeIndexedDB();
      expect(actualizado.modelo.relaciones[0].campoDestino).toBe('dueno_fk_manual');
      expect(actualizado.ddlGenerado).toContain(
        'FOREIGN KEY ("dueno_fk_manual") REFERENCES "Cliente" ("id_cliente")'
      );
      const tablaMascota = actualizado.datosEjemplo?.tablas.find((t) => t.tabla === 'Mascota');
      expect(tablaMascota?.columnas).toContain('dueno_fk_manual');
      expect(tablaMascota?.filas[0].dueno_fk_manual).toBe(1);
      expect(actualizado.baseSQLiteGenerada).toBe(false);
    });
  });
});
