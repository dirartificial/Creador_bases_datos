import { zipSync, strToU8 } from 'fflate';
import { ProyectoEstado } from '../core/schemas';
import { exportarProyectoAJson } from '../core/storage';
import { generarMermaidEr } from '../core/erDiagram';
import {
  analisisResumidoAMarkdown,
  generarAnalisisResumidoFallback,
  generarGlosarioMarkdown,
  modeloConceptualAMarkdown,
} from './analisis';
import { generarCsvDeInforme, generarCsvsDeDatosEjemplo, sanitizarNombreArchivo } from './csv';
import { generarPdfAnalisisResumido } from './pdf';
import { descargarArchivo, sanitizarSvg } from './svg';
import { generarDDLSQLite } from '../core/ddl/sqlite';
import { generarDDLPostgres } from '../core/ddl/postgres';
import { generarDDLMySQL } from '../core/ddl/mysql';
import { generarScriptMongo, generarDocumentosEjemploMongo } from '../core/ddl/mongo';

export interface OpcionesExportacionZip {
  incluirProyectoJson?: boolean;
  incluirModelo?: boolean;
  incluirDiagrama?: boolean;
  incluirScriptDDL?: boolean;
  incluirBaseSQLite?: boolean;
  incluirDatos?: boolean;
  incluirInformes?: boolean;
  incluirAnalisis?: boolean;
  incluirGlosario?: boolean;
}

export const OPCIONES_ZIP_POR_DEFECTO: Required<OpcionesExportacionZip> = {
  incluirProyectoJson: true,
  incluirModelo: true,
  incluirDiagrama: true,
  incluirScriptDDL: true,
  incluirBaseSQLite: true,
  incluirDatos: true,
  incluirInformes: true,
  incluirAnalisis: true,
  incluirGlosario: true,
};

export interface EntradasPaqueteZip {
  proyecto: ProyectoEstado;
  svgDiagrama?: string;
  binarioSQLite?: Uint8Array | null;
  svgsInformes?: Record<string, string>;
  opciones?: OpcionesExportacionZip;
  apiKeySesion?: string;
}

/**
 * Patrón regex para identificar tokens o claves API de Google AI Studio / Google Cloud.
 */
export const PATRON_API_KEY_GOOGLE = /AIza[0-9A-Za-z-_]{35}/;

/**
 * Inspecciona exhaustivamente el contenido de todos los archivos de texto que formarán parte del ZIP
 * para certificar con rigor de seguridad que ninguna API key se filtre en el paquete entregable.
 */
export function auditarSeguridadArchivosZip(
  archivos: Record<string, Uint8Array>,
  apiKeySesion?: string
): void {
  const decoder = new TextDecoder('utf-8', { fatal: false });

  for (const [ruta, buffer] of Object.entries(archivos)) {
    // Si la ruta incluye binarios conocidos (.sqlite, .pdf, .png), no aplicamos escaneo de texto plano
    if (ruta.endsWith('.sqlite') || ruta.endsWith('.png')) {
      continue;
    }

    const contenidoTexto = decoder.decode(buffer);

    // 1. Detección de coincidencia exacta con la key de sesión
    if (apiKeySesion && apiKeySesion.length >= 10 && contenidoTexto.includes(apiKeySesion)) {
      throw new Error(
        `Violación de seguridad: Se detectó la API key de sesión en el archivo entregable "${ruta}". El ZIP fue bloqueado.`
      );
    }

    // 2. Detección de patrones genéricos de claves de Google Cloud / AI Studio
    if (PATRON_API_KEY_GOOGLE.test(contenidoTexto)) {
      throw new Error(
        `Violación de seguridad: Se detectó un patrón coincidente con una clave de API de Google en "${ruta}".`
      );
    }
  }
}

/**
 * Construye el árbol de archivos en memoria y genera el paquete comprimido ZIP como un Uint8Array.
 */
export function generarPaqueteZip(entradas: EntradasPaqueteZip): Uint8Array {
  const {
    proyecto,
    svgDiagrama,
    binarioSQLite,
    svgsInformes = {},
    opciones = OPCIONES_ZIP_POR_DEFECTO,
    apiKeySesion,
  } = entradas;

  const config: Required<OpcionesExportacionZip> = {
    ...OPCIONES_ZIP_POR_DEFECTO,
    ...opciones,
  };

  const arbolArchivos: Record<string, Uint8Array> = {};

  // 1. Proyecto completo en JSON (para reimportar)
  if (config.incluirProyectoJson) {
    const jsonProyecto = exportarProyectoAJson(proyecto);
    arbolArchivos['proyecto.json'] = strToU8(jsonProyecto);
  }

  // 2. Modelo conceptual (.md y .json)
  if (config.incluirModelo) {
    const mdModelo = modeloConceptualAMarkdown(proyecto);
    arbolArchivos['modelo/modelo.md'] = strToU8(mdModelo);
    arbolArchivos['modelo/modelo.json'] = strToU8(
      JSON.stringify(proyecto.modelo, null, 2)
    );
  }

  // 3. Diagrama Entidad-Relación (.mmd y .svg)
  if (config.incluirDiagrama) {
    const mmd = generarMermaidEr(proyecto.modelo);
    arbolArchivos['diagrama/diagrama-er.mmd'] = strToU8(mmd);

    if (svgDiagrama) {
      const svgLimpio = sanitizarSvg(svgDiagrama);
      arbolArchivos['diagrama/diagrama-er.svg'] = strToU8(svgLimpio);
    }
  }

  // 4. Script DDL / de creación del motor de base de datos
  if (config.incluirScriptDDL) {
    if (proyecto.modelo && proyecto.modelo.entidades.length > 0) {
      const extension = proyecto.motorSeleccionado === 'mongodb' ? 'js' : 'sql';
      const scriptSeleccionado =
        proyecto.ddlGenerado ||
        (proyecto.motorSeleccionado === 'mongodb'
          ? generarScriptMongo(proyecto.modelo, proyecto.opcionesDDL)
          : proyecto.motorSeleccionado === 'postgresql'
          ? generarDDLPostgres(proyecto.modelo, proyecto.opcionesDDL)
          : proyecto.motorSeleccionado === 'mysql'
          ? generarDDLMySQL(proyecto.modelo, proyecto.opcionesDDL)
          : generarDDLSQLite(proyecto.modelo, proyecto.opcionesDDL));

      arbolArchivos[`scripts/esquema.${extension}`] = strToU8(scriptSeleccionado);

      arbolArchivos['scripts/esquema_sqlite.sql'] = strToU8(
        generarDDLSQLite(proyecto.modelo, proyecto.opcionesDDL)
      );
      arbolArchivos['scripts/esquema_postgres.sql'] = strToU8(
        generarDDLPostgres(proyecto.modelo, proyecto.opcionesDDL)
      );
      arbolArchivos['scripts/esquema_mysql.sql'] = strToU8(
        generarDDLMySQL(proyecto.modelo, proyecto.opcionesDDL)
      );
      arbolArchivos['scripts/esquema_mongodb.js'] = strToU8(
        generarScriptMongo(proyecto.modelo, proyecto.opcionesDDL)
      );
    }
  }

  // 5. Base de datos SQLite binaria (.sqlite)
  if (config.incluirBaseSQLite && binarioSQLite && binarioSQLite.length > 0) {
    arbolArchivos['base_de_datos/base_de_datos.sqlite'] = binarioSQLite;
  }

  // 6. Datos de ejemplo (.csv y .json)
  if (config.incluirDatos) {
    if (proyecto.datosEjemplo) {
      arbolArchivos['datos/datos_ejemplo.json'] = strToU8(
        JSON.stringify(proyecto.datosEjemplo, null, 2)
      );

      const csvs = generarCsvsDeDatosEjemplo(proyecto.datosEjemplo);
      for (const [nombreArchivo, contenidoCsv] of Object.entries(csvs)) {
        arbolArchivos[`datos/${nombreArchivo}`] = strToU8(contenidoCsv);
      }
    }

    if (proyecto.modelo && proyecto.modelo.entidades.length > 0) {
      const docsMongo = generarDocumentosEjemploMongo(
        proyecto.modelo,
        proyecto.datosEjemplo
      );
      arbolArchivos['datos/datos_mongodb.json'] = strToU8(
        JSON.stringify(docsMongo, null, 2)
      );
    }
  }

  // 7. Informes personalizados
  if (config.incluirInformes && proyecto.informes && proyecto.informes.length > 0) {
    for (const inf of proyecto.informes) {
      const slug = sanitizarNombreArchivo(inf.titulo || `informe_${inf.id}`);

      // Consulta SQL
      arbolArchivos[`informes/${slug}.sql`] = strToU8(inf.consultaSQL);

      // Explicación didáctica
      const docExplicacion = `# Informe: ${inf.titulo}\n\n## Solicitud en lenguaje natural\n${inf.pedidoLenguajeNatural}\n\n## Explicación paso a paso\n${inf.explicacionPasoAPaso}\n\n## Tipo de gráfico sugerido\n${inf.tipoGrafico}\n`;
      arbolArchivos[`informes/${slug}_explicacion.md`] = strToU8(docExplicacion);

      // Resultado CSV
      if (inf.resultado) {
        arbolArchivos[`informes/${slug}_resultado.csv`] = strToU8(
          generarCsvDeInforme(inf)
        );
      }

      // Gráfico SVG si existe
      if (svgsInformes[inf.id]) {
        arbolArchivos[`informes/${slug}_grafico.svg`] = strToU8(
          sanitizarSvg(svgsInformes[inf.id])
        );
      }
    }
  }

  // 8. Análisis resumido (.md y .pdf)
  const analisis = proyecto.analisisResumido || generarAnalisisResumidoFallback(proyecto);
  if (config.incluirAnalisis) {
    const mdAnalisis = analisisResumidoAMarkdown(analisis, proyecto);
    arbolArchivos['analisis/analisis.md'] = strToU8(mdAnalisis);

    try {
      const pdfBytes = generarPdfAnalisisResumido(analisis, proyecto);
      arbolArchivos['analisis/analisis.pdf'] = pdfBytes;
    } catch (err) {
      console.warn('No se pudo generar el archivo PDF en este entorno:', err);
    }
  }

  // 9. Glosario pedagógico (.md)
  if (config.incluirGlosario) {
    const mdGlosario = generarGlosarioMarkdown(proyecto);
    arbolArchivos['glosario.md'] = strToU8(mdGlosario);
  }

  // Verificación estricta de seguridad antes de comprimir
  auditarSeguridadArchivosZip(arbolArchivos, apiKeySesion);

  // Compresión con fflate (nivel 6 estándar rápido y compatible)
  return zipSync(arbolArchivos, { level: 6 });
}

/**
 * Genera y descarga el paquete ZIP en el navegador del estudiante.
 */
export function descargarPaqueteCompletoZip(entradas: EntradasPaqueteZip): void {
  const bytesZip = generarPaqueteZip(entradas);
  const nombreZip = `${sanitizarNombreArchivo(
    entradas.proyecto.descripcionProblema || 'proyecto_base_datos'
  )}_entregables.zip`;

  const blob = new Blob([bytesZip], { type: 'application/zip' });
  descargarArchivo(blob, nombreZip, 'application/zip');
}
