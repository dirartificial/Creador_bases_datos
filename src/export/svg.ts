import DOMPurify from 'dompurify';

/**
 * Sanitiza de forma estricta un string SVG usando DOMPurify.
 * Elimina scripts, eventos inline (onload, onerror, onclick) y tags peligrosos.
 */
export function sanitizarSvg(svgString: string): string {
  if (!svgString || typeof svgString !== 'string') {
    return '';
  }

  // Sanitización estricta configurada específicamente para perfiles SVG
  const sanitized = DOMPurify.sanitize(svgString, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['use', 'style', 'text', 'tspan', 'title', 'desc'],
    ADD_ATTR: [
      'dominant-baseline',
      'text-anchor',
      'font-family',
      'font-size',
      'font-weight',
      'font-style',
      'dy',
      'dx',
      'transform',
    ],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input'],
    FORBID_ATTR: [
      'onerror',
      'onload',
      'onclick',
      'onmouseover',
      'onfocus',
      'onblur',
      'href', // evitar javascript: URLs
      'xlink:href',
    ],
  });

  return String(sanitized);
}

/**
 * Descarga un archivo en el navegador del estudiante de forma local y segura.
 */
export function descargarArchivo(
  contenido: Blob | string,
  nombreArchivo: string,
  mimeType: string
): void {
  const blob =
    contenido instanceof Blob
      ? contenido
      : new Blob([contenido], { type: `${mimeType};charset=utf-8` });

  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface DimensionesSvg {
  ancho: number;
  alto: number;
}

/**
 * Extrae las dimensiones (ancho y alto) de un SVG a partir de width/height o viewBox.
 */
export function obtenerDimensionesSvg(svgString: string): DimensionesSvg {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');

  if (!svgEl) {
    return { ancho: 800, alto: 600 };
  }

  // 1. viewBox
  const viewBox = svgEl.getAttribute('viewBox');
  if (viewBox) {
    const partes = viewBox.split(/[\s,]+/).map(Number);
    if (partes.length === 4 && !isNaN(partes[2]) && !isNaN(partes[3])) {
      return { ancho: Math.max(partes[2], 100), alto: Math.max(partes[3], 100) };
    }
  }

  // 2. width y height
  const widthAttr = parseFloat(svgEl.getAttribute('width') || '');
  const heightAttr = parseFloat(svgEl.getAttribute('height') || '');
  if (!isNaN(widthAttr) && !isNaN(heightAttr) && widthAttr > 0 && heightAttr > 0) {
    return { ancho: widthAttr, alto: heightAttr };
  }

  return { ancho: 1000, alto: 700 };
}

/**
 * Convierte un string SVG sanitizado a una imagen PNG en alta resolución (Blob) usando un Canvas HTML5.
 */
export async function exportarSvgAPng(
  svgString: string,
  factorEscala: number = 2
): Promise<Blob> {
  const svgLimpio = sanitizarSvg(svgString);
  const { ancho, alto } = obtenerDimensionesSvg(svgLimpio);

  return new Promise<Blob>((resolve, reject) => {
    // Si estamos en un entorno sin soporte de Canvas/Image (ej. Node o test sin soporte completo)
    if (typeof window === 'undefined' || typeof Image === 'undefined') {
      reject(new Error('La conversión de SVG a PNG solo está disponible en el navegador.'));
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(ancho * factorEscala);
    canvas.height = Math.round(alto * factorEscala);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('No se pudo inicializar el contexto 2D del Canvas.'));
      return;
    }

    // Fondo blanco para legibilidad pedagógica
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const blob = new Blob([svgLimpio], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      try {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);

        canvas.toBlob(
          (pngBlob) => {
            if (pngBlob) {
              resolve(pngBlob);
            } else {
              reject(new Error('Error al generar el Blob PNG desde el Canvas.'));
            }
          },
          'image/png',
          0.95
        );
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo cargar el SVG en el elemento Image: ' + String(err)));
    };

    img.src = url;
  });
}
