import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { guardarApiKey } from '../src/core/key';
import { configurarClienteGeminiMock } from '../src/core/gemini';
import { Entidad, Modelo, Relacion } from '../src/core/schemas';
import {
  crearTablaIntermediaParaNM,
  explicarObservacionesConIA,
  obtenerNombreAtributoFKPropuesto,
  resolverFKFaltante,
  sugerirRelacionesConIA,
  tieneAtributoFK,
  validarModelo,
  verificarAtributosDuplicados,
  verificarClavesForaneas,
  verificarClavesPrimarias,
  verificarEntidadesAisladas,
  verificarRelacionesDuplicadas,
  verificarRelacionesEntidadesInexistentes,
  verificarRelacionesNM,
  verificarTablasIntermedias,
} from '../src/core/modelValidator';
import {
  cargarProyectoDesdeIndexedDB,
  guardarProyectoEnIndexedDB,
} from '../src/core/storage';

const FAKE_KEY = 'AIzaSyTestKeyFase2_1234567890abcdefXYZ';

// Mock data fixtures
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
  ],
};

const entidadMascotaSinFK: Entidad = {
  nombre: 'Mascota',
  descripcion: 'Animal atendido en la veterinaria',
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
      nombre: 'nombre',
      tipoConceptual: 'texto',
      obligatorio: true,
      unico: false,
      esClavePrimaria: false,
      justificacion: 'Nombre de la mascota',
    },
  ],
};

const entidadVeterinario: Entidad = {
  nombre: 'Veterinario',
  descripcion: 'Profesional de la salud',
  atributos: [
    {
      nombre: 'id_veterinario',
      tipoConceptual: 'entero',
      obligatorio: true,
      unico: true,
      esClavePrimaria: true,
      justificacion: 'Identificador del profesional',
    },
  ],
};

describe('Fase 2 — Reglas Determinísticas del Validador (modelValidator.ts)', () => {
  it('Regla 1: verificarClavesPrimarias detecta entidades sin PK como error bloqueante', () => {
    const entidadSinPK: Entidad = {
      nombre: 'Historial',
      descripcion: 'Entidad sin clave primaria',
      atributos: [
        {
          nombre: 'nota',
          tipoConceptual: 'texto',
          obligatorio: true,
          unico: false,
          esClavePrimaria: false,
          justificacion: 'Nota libre',
        },
      ],
    };

    const modelo: Modelo = {
      entidades: [entidadCliente, entidadSinPK],
      relaciones: [],
    };

    const obs = verificarClavesPrimarias(modelo);
    expect(obs).toHaveLength(1);
    expect(obs[0].codigo).toBe('ENTIDAD_SIN_PK');
    expect(obs[0].gravedad).toBe('error');
    expect(obs[0].entidadesInvolucradas).toContain('Historial');

    const res = validarModelo(modelo);
    expect(res.valido).toBe(false);
    expect(res.resumen.totalErrores).toBe(1);
  });

  it('Regla 2: verificarEntidadesAisladas detecta entidades sin conexiones', () => {
    const modelo: Modelo = {
      entidades: [entidadCliente, entidadMascotaSinFK, entidadVeterinario],
      relaciones: [
        {
          origen: 'Cliente',
          destino: 'Mascota',
          cardinalidad: '1:N',
          descripcion: 'Un cliente tiene mascotas',
          obligatoriaEnOrigen: false,
          obligatoriaEnDestino: true,
        },
      ],
    };

    const obs = verificarEntidadesAisladas(modelo);
    expect(obs).toHaveLength(1);
    expect(obs[0].codigo).toBe('ENTIDADES_AISLADAS');
    expect(obs[0].gravedad).toBe('advertencia');
    expect(obs[0].entidadesInvolucradas).toContain('Veterinario');
    expect(obs[0].entidadesInvolucradas).not.toContain('Cliente');
  });

  it('Regla 3: verificarRelacionesEntidadesInexistentes detecta entidades no definidas', () => {
    const modelo: Modelo = {
      entidades: [entidadCliente],
      relaciones: [
        {
          origen: 'Cliente',
          destino: 'Factura', // Factura no existe en entidades
          cardinalidad: '1:N',
          descripcion: 'Cliente genera factura',
          obligatoriaEnOrigen: false,
          obligatoriaEnDestino: true,
        },
      ],
    };

    const obs = verificarRelacionesEntidadesInexistentes(modelo);
    expect(obs).toHaveLength(1);
    expect(obs[0].codigo).toBe('RELACION_ENTIDAD_INEXISTENTE');
    expect(obs[0].gravedad).toBe('error');
    expect(obs[0].entidadesInvolucradas).toContain('Factura');

    const res = validarModelo(modelo);
    expect(res.valido).toBe(false);
  });

  it('Regla 4: verificarRelacionesNM alerta sobre relaciones muchos a muchos sin tabla intermedia', () => {
    const modelo: Modelo = {
      entidades: [entidadMascotaSinFK, entidadVeterinario],
      relaciones: [
        {
          origen: 'Mascota',
          destino: 'Veterinario',
          cardinalidad: 'N:M',
          descripcion: 'Una mascota es atendida por varios veterinarios',
          obligatoriaEnOrigen: false,
          obligatoriaEnDestino: false,
        },
      ],
    };

    const obs = verificarRelacionesNM(modelo);
    expect(obs).toHaveLength(1);
    expect(obs[0].codigo).toBe('NM_SIN_TABLA_INTERMEDIA');
    expect(obs[0].gravedad).toBe('advertencia');
    expect(obs[0].accionRapida?.tipo).toBe('crear_tabla_intermedia');
  });

  it('Regla 5: verificarClavesForaneas detecta falta de FK en relaciones 1:N y 1:1', () => {
    // Caso 1:N donde Mascota no tiene id_cliente
    const modelo1N: Modelo = {
      entidades: [entidadCliente, entidadMascotaSinFK],
      relaciones: [
        {
          origen: 'Cliente',
          destino: 'Mascota',
          cardinalidad: '1:N',
          descripcion: 'Un cliente tiene varias mascotas',
          obligatoriaEnOrigen: false,
          obligatoriaEnDestino: true,
        },
      ],
    };

    const obs1N = verificarClavesForaneas(modelo1N);
    expect(obs1N).toHaveLength(1);
    expect(obs1N[0].codigo).toBe('FK_FALTANTE');
    expect(obs1N[0].gravedad).toBe('advertencia');
    expect(obs1N[0].accionRapida?.tipo).toBe('agregar_fk');
    expect(obs1N[0].accionRapida?.entidadDestino).toBe('Mascota');

    // Caso cuando Mascota sí tiene id_cliente
    const entidadMascotaConFK: Entidad = {
      ...entidadMascotaSinFK,
      atributos: [
        ...entidadMascotaSinFK.atributos,
        {
          nombre: 'id_cliente',
          tipoConceptual: 'entero',
          obligatorio: true,
          unico: false,
          esClavePrimaria: false,
          justificacion: 'FK hacia Cliente',
        },
      ],
    };

    const modeloValido: Modelo = {
      entidades: [entidadCliente, entidadMascotaConFK],
      relaciones: modelo1N.relaciones,
    };
    expect(verificarClavesForaneas(modeloValido)).toHaveLength(0);
  });

  it('Regla 6: verificarRelacionesDuplicadas detecta relaciones redundantes', () => {
    const relBase: Relacion = {
      origen: 'Cliente',
      destino: 'Mascota',
      cardinalidad: '1:N',
      descripcion: 'Cliente tiene mascota',
      obligatoriaEnOrigen: false,
      obligatoriaEnDestino: true,
    };

    const modelo: Modelo = {
      entidades: [entidadCliente, entidadMascotaSinFK],
      relaciones: [relBase, { ...relBase, descripcion: 'Segunda copia redundante' }],
    };

    const obs = verificarRelacionesDuplicadas(modelo);
    expect(obs).toHaveLength(1);
    expect(obs[0].codigo).toBe('RELACIONES_DUPLICADAS');
  });

  it('Regla 7: verificarAtributosDuplicados detecta colisiones de nombres de columna', () => {
    const entidadDuplicada: Entidad = {
      nombre: 'Producto',
      descripcion: 'Artículo en venta',
      atributos: [
        {
          nombre: 'id',
          tipoConceptual: 'entero',
          obligatorio: true,
          unico: true,
          esClavePrimaria: true,
          justificacion: 'PK',
        },
        {
          nombre: 'precio',
          tipoConceptual: 'decimal',
          obligatorio: true,
          unico: false,
          esClavePrimaria: false,
          justificacion: 'Precio',
        },
        {
          nombre: 'precio', // Duplicado
          tipoConceptual: 'decimal',
          obligatorio: false,
          unico: false,
          esClavePrimaria: false,
          justificacion: 'Precio con descuento repetido',
        },
      ],
    };

    const obs = verificarAtributosDuplicados({
      entidades: [entidadDuplicada],
      relaciones: [],
    });
    expect(obs).toHaveLength(1);
    expect(obs[0].codigo).toBe('ATRIBUTOS_DUPLICADOS');
    expect(obs[0].gravedad).toBe('error');
  });

  it('Regla 8: verificarTablasIntermedias reconoce positivamente una tabla asociativa', () => {
    const entidadTurnoIntermedia: Entidad = {
      nombre: 'Atencion',
      descripcion: 'Tabla asociativa entre Mascota y Veterinario',
      atributos: [
        {
          nombre: 'id_atencion',
          tipoConceptual: 'entero',
          obligatorio: true,
          unico: true,
          esClavePrimaria: true,
          justificacion: 'PK',
        },
        {
          nombre: 'id_mascota',
          tipoConceptual: 'entero',
          obligatorio: true,
          unico: false,
          esClavePrimaria: false,
          justificacion: 'FK Mascota',
        },
        {
          nombre: 'id_veterinario',
          tipoConceptual: 'entero',
          obligatorio: true,
          unico: false,
          esClavePrimaria: false,
          justificacion: 'FK Veterinario',
        },
      ],
    };

    const obs = verificarTablasIntermedias({
      entidades: [entidadMascotaSinFK, entidadVeterinario, entidadTurnoIntermedia],
      relaciones: [],
    });

    expect(obs).toHaveLength(1);
    expect(obs[0].codigo).toBe('TABLA_INTERMEDIA_DETECTADA');
    expect(obs[0].gravedad).toBe('sugerencia');
  });
});

describe('Fase 2 — Acciones Rápidas y Normalizadores', () => {
  it('tieneAtributoFK y obtenerNombreAtributoFKPropuesto reconocen patrones de claves foráneas', () => {
    expect(tieneAtributoFK(entidadMascotaSinFK, entidadCliente)).toBe(false);

    const conClienteId: Entidad = {
      ...entidadMascotaSinFK,
      atributos: [
        ...entidadMascotaSinFK.atributos,
        {
          nombre: 'cliente_id',
          tipoConceptual: 'entero',
          obligatorio: true,
          unico: false,
          esClavePrimaria: false,
          justificacion: 'FK',
        },
      ],
    };
    expect(tieneAtributoFK(conClienteId, entidadCliente)).toBe(true);
    expect(obtenerNombreAtributoFKPropuesto(entidadCliente)).toBe('id_cliente');
  });

  it('resolverFKFaltante agrega la FK adecuada y elimina la advertencia', () => {
    const modeloInicial: Modelo = {
      entidades: [entidadCliente, entidadMascotaSinFK],
      relaciones: [
        {
          origen: 'Cliente',
          destino: 'Mascota',
          cardinalidad: '1:N',
          descripcion: 'Un cliente tiene varias mascotas',
          obligatoriaEnOrigen: false,
          obligatoriaEnDestino: true,
        },
      ],
    };

    // Inicialmente tiene FK_FALTANTE
    const resInicial = validarModelo(modeloInicial);
    expect(resInicial.advertencias.some((a) => a.codigo === 'FK_FALTANTE')).toBe(true);

    // Aplicar resolución
    const modeloResuelto = resolverFKFaltante(modeloInicial, 'Mascota', 'Cliente');
    const mascotaActualizada = modeloResuelto.entidades.find((e) => e.nombre === 'Mascota');
    expect(
      mascotaActualizada?.atributos.some((a) => a.nombre.toLowerCase().includes('cliente'))
    ).toBe(true);

    const resFinal = validarModelo(modeloResuelto);
    expect(resFinal.advertencias.some((a) => a.codigo === 'FK_FALTANTE')).toBe(false);
  });

  it('crearTablaIntermediaParaNM crea la entidad asociativa y divide en dos 1:N', () => {
    const relNM: Relacion = {
      origen: 'Mascota',
      destino: 'Veterinario',
      cardinalidad: 'N:M',
      descripcion: 'Mascotas atendidas por veterinarios',
      obligatoriaEnOrigen: false,
      obligatoriaEnDestino: false,
    };

    const modeloInicial: Modelo = {
      entidades: [entidadMascotaSinFK, entidadVeterinario],
      relaciones: [relNM],
    };

    const resInicial = validarModelo(modeloInicial);
    expect(resInicial.advertencias.some((a) => a.codigo === 'NM_SIN_TABLA_INTERMEDIA')).toBe(true);

    const modeloIntermedio = crearTablaIntermediaParaNM(modeloInicial, relNM);

    // Debe contener Mascota, Veterinario y Mascota_Veterinario
    expect(modeloIntermedio.entidades).toHaveLength(3);
    const intermedia = modeloIntermedio.entidades.find((e) => e.nombre === 'Mascota_Veterinario');
    expect(intermedia).toBeDefined();
    expect(intermedia?.atributos.some((a) => a.nombre === 'id_mascota')).toBe(true);
    expect(intermedia?.atributos.some((a) => a.nombre === 'id_veterinario')).toBe(true);

    // Las relaciones deben ser dos de 1:N
    expect(modeloIntermedio.relaciones).toHaveLength(2);
    expect(modeloIntermedio.relaciones.every((r) => r.cardinalidad === '1:N')).toBe(true);

    // No debe quedar advertencia de N:M
    const resFinal = validarModelo(modeloIntermedio);
    expect(resFinal.advertencias.some((a) => a.codigo === 'NM_SIN_TABLA_INTERMEDIA')).toBe(false);
  });
});

describe('Fase 2 — Explicaciones y Sugerencias de la IA Tutora (Mockeadas)', () => {
  it('sugerirRelacionesConIA solicita y valida la propuesta de relaciones de Gemini', async () => {
    guardarApiKey(FAKE_KEY);

    configurarClienteGeminiMock({
      generarContenido: async () =>
        JSON.stringify({
          relaciones: [
            {
              origen: 'Cliente',
              destino: 'Mascota',
              cardinalidad: '1:N',
              descripcion: 'Un cliente puede tener varias mascotas registradas',
              obligatoriaEnOrigen: false,
              obligatoriaEnDestino: true,
            },
          ],
          justificacionGeneral:
            'Relacionamos Cliente con Mascota mediante 1:N porque cada mascota tiene un dueño responsable.',
        }),
    });

    const propuesta = await sugerirRelacionesConIA({
      entidades: [entidadCliente, entidadMascotaSinFK],
      descripcionProblema: 'Veterinaria municipal',
    });

    expect(propuesta.relaciones).toHaveLength(1);
    expect(propuesta.relaciones[0].cardinalidad).toBe('1:N');
    expect(propuesta.justificacionGeneral).toContain('1:N');
  });

  it('explicarObservacionesConIA genera explicaciones didácticas adaptadas al dominio', async () => {
    guardarApiKey(FAKE_KEY);

    configurarClienteGeminiMock({
      generarContenido: async () =>
        JSON.stringify({
          explicaciones: [
            {
              codigo: 'NM_SIN_TABLA_INTERMEDIA',
              mensaje: 'Relación N:M directa detectada',
              explicacionPedagogica:
                'Una relación muchos a muchos no se puede representar en una sola columna sin romper la normalización.',
              ejemploConcreto:
                'En tu veterinaria, el perro Firulais puede ser atendido por el Dr. Pérez y la Dra. Gómez.',
              comoResolverlo:
                'Creá una tabla intermedia Consulta con id_mascota e id_veterinario.',
            },
          ],
          resumenTutor: 'Muy buen avance, solo falta desglosar la relación N:M.',
        }),
    });

    const res = await explicarObservacionesConIA({
      modelo: {
        entidades: [entidadMascotaSinFK, entidadVeterinario],
        relaciones: [
          {
            origen: 'Mascota',
            destino: 'Veterinario',
            cardinalidad: 'N:M',
            descripcion: 'Atención médica',
            obligatoriaEnOrigen: false,
            obligatoriaEnDestino: false,
          },
        ],
      },
      observaciones: [
        {
          codigo: 'NM_SIN_TABLA_INTERMEDIA',
          gravedad: 'advertencia',
          mensaje: 'Relación N:M directa detectada',
          explicacionConceptual: 'Requiere tabla intermedia',
          entidadesInvolucradas: ['Mascota', 'Veterinario'],
        },
      ],
      descripcionProblema: 'Clínica veterinaria',
    });

    expect(res.explicaciones).toHaveLength(1);
    expect(res.explicaciones[0].codigo).toBe('NM_SIN_TABLA_INTERMEDIA');
    expect(res.explicaciones[0].ejemploConcreto).toContain('Firulais');
    expect(res.resumenTutor).toContain('Muy buen avance');
  });
});

describe('Fase 2 — Flujo de Aceptación Paso 4 en la UI', () => {
  it('permite definir relaciones, muestra observaciones del validador, ejecuta acciones rápidas y confirma el paso', async () => {
    guardarApiKey(FAKE_KEY);

    // Precargar proyecto en IndexedDB en el Paso 4 con el Modelo Conceptual confirmado
    await guardarProyectoEnIndexedDB({
      version: 1,
      actualizadoEn: new Date().toISOString(),
      pasoActual: 4,
      descripcionProblema: 'Veterinaria canina y felina',
      rondasAclaracion: [],
      ultimaAclaracion: null,
      claridadConfirmada: true,
      modelo: {
        entidades: [entidadCliente, entidadMascotaSinFK],
        relaciones: [],
      },
      explicacionModelo: 'Modelo conceptual confirmado con Cliente y Mascota.',
      modeloConceptualConfirmado: true,
      relacionesConfirmadas: false,
      bitacora: [],
    });

    render(<App />);

    // El Paso 4 debe renderizarse y mostrar las entidades aisladas inicialmente
    await waitFor(() => {
      expect(screen.getByTestId('step4-container')).toBeInTheDocument();
    });

    expect(screen.getByTestId('validator-panel')).toBeInTheDocument();
    expect(screen.getAllByText(/ENTIDADES_AISLADAS/i).length).toBe(2);

    // Agregar relación manual Cliente -> Mascota (1:N)
    fireEvent.change(screen.getByTestId('rel-description-input'), {
      target: { value: 'Un cliente puede registrar muchas mascotas' },
    });
    fireEvent.click(screen.getByTestId('save-relation-btn'));

    // Ahora la relación aparece en la lista
    await waitFor(() => {
      expect(screen.getByTestId('relation-card-0')).toBeInTheDocument();
    });
    expect(screen.getByTestId('cardinality-0')).toHaveTextContent('1:N');

    // El validador detecta que falta FK en Mascota (FK_FALTANTE) y ofrece acción rápida
    await waitFor(() => {
      expect(screen.getByText(/FK_FALTANTE/i)).toBeInTheDocument();
    });
    const btnQuickFix = screen.getByTestId('quick-fix-btn-0');
    expect(btnQuickFix).toHaveTextContent(/Agregar atributo "id_cliente"/i);

    // Ejecutar la acción rápida para corregir la FK
    fireEvent.click(btnQuickFix);

    // Al resolver la FK, el validador muestra el modelo limpio sin advertencias de FK
    await waitFor(() => {
      expect(screen.getByTestId('validator-clean-msg')).toBeInTheDocument();
    });

    // Confirmar las relaciones
    const btnConfirmarPaso4 = screen.getByTestId('confirm-step4-btn');
    expect(btnConfirmarPaso4).not.toBeDisabled();
    fireEvent.click(btnConfirmarPaso4);

    await waitFor(() => {
      expect(screen.getByTestId('relations-confirmed-banner')).toBeInTheDocument();
    });

    // Verificar en IndexedDB que relacionesConfirmadas sea true y la decisión esté en la bitácora
    const guardado = await cargarProyectoDesdeIndexedDB();
    expect(guardado.relacionesConfirmadas).toBe(true);
    expect(guardado.modelo.relaciones).toHaveLength(1);
    expect(guardado.bitacora.some((d) => d.paso === 4)).toBe(true);
  });
});
