import { sanitizarValorCSV } from '../core/sampleData';
import { ConjuntoDatosEjemplo, Informe } from '../core/schemas';

/**
 * Sanitiza un nombre de archivo para exportaciones según la regla 3.5:
 * Solo permite caracteres en minúscula, dígitos, guión medio y guión bajo `[a-z0-9_-]`.
 */
export function sanitizarNombreArchivo(nombre: string): string {
  if (!nombre) return 'archivo';
  const normalizado = nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quitar tildes
    .replace(/[^a-z0-9_-]+/g, '_')   // Solo [a-z0-9_-]
    .replace(/^_+|_+$/g, '');        // Sin guiones bajos al inicio o fin

  return normalizado.length > 0 ? normalizado : 'archivo';
}

/**
 * Convierte un arreglo de cabeceras y una matriz de filas en un string CSV seguro,
 * aplicando la protección anti-inyección de fórmulas en cada celda.
 */
export function generarCsv(columnas: string[], filas: unknown[][]): string {
  const encabezado = columnas.map((col) => sanitizarValorCSV(col)).join(',');
  const lineas = [encabezado];

  for (const fila of filas) {
    const celdas = fila.map((val) => sanitizarValorCSV(val));
    lineas.push(celdas.join(','));
  }

  return lineas.join('\r\n');
}

/**
 * Genera un mapa de archivos CSV para cada tabla presente en el conjunto de datos de ejemplo.
 * Retorna un objeto cuyas claves son los nombres de tabla sanitizados y los valores el contenido CSV.
 */
export function generarCsvsDeDatosEjemplo(
  datosEjemplo: Pick<ConjuntoDatosEjemplo, 'tablas'>
): Record<string, string> {
  const archivos: Record<string, string> = {};

  for (const tabla of datosEjemplo.tablas) {
    const columnas = tabla.columnas;
    const filas = tabla.filas.map((filaObj) =>
      columnas.map((col) => filaObj[col] ?? '')
    );
    const nombreLimpio = sanitizarNombreArchivo(tabla.tabla);
    archivos[`${nombreLimpio}.csv`] = generarCsv(columnas, filas);
  }

  return archivos;
}

/**
 * Convierte el resultado de un informe personalizado a formato CSV seguro.
 */
export function generarCsvDeInforme(informe: Informe): string {
  if (!informe.resultado || informe.resultado.columnas.length === 0) {
    return 'sin_datos\r\n';
  }

  return generarCsv(informe.resultado.columnas, informe.resultado.filas);
}
