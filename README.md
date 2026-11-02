# Asistente Pedagógico de Diseño de Bases de Datos (BYOK)

Aplicación web **100% estática (sin servidor backend)** diseñada para que estudiantes aprendan diseño de bases de datos paso a paso dialogando con un tutor basado en Google Gemini.

---

## Guía para Estudiantes: Cómo obtener y cuidar tu API Key

Esta aplicación utiliza el modelo **BYOK (Bring Your Own Key)**: cada estudiante usa su propia clave gratuita de Google AI Studio. Nosotros no tenemos servidor ni almacenamos tu clave.

### Paso a paso para crear tu API Key
1. Ingresá a [Google AI Studio](https://aistudio.google.com/apikey) con tu cuenta de Google.
2. Hacé clic en **"Create API key"** (Crear clave de API).
3. Creá una clave **exclusiva para esta materia/curso**.
4. Copiá la clave generada (`AIza...`) y pegala en la pantalla inicial de esta aplicación.
5. *(Opcional recomendado)* En Google Cloud Console podés restringir la key por *HTTP Referrer* al dominio donde esté publicada esta aplicación.

### Reglas de Seguridad y Privacidad
- **Guardado solo en tu pestaña:** Tu API key se guarda únicamente en `sessionStorage` del navegador y desaparece apenas cerrás la pestaña o hacés clic en **"Olvidar key ahora"**.
- **En computadoras compartidas o laboratorios:** Antes de levantarte, hacé clic en **"Olvidar key ahora"**, cerrá la pestaña y revocá la clave desde Google AI Studio.
- **Al terminar el curso:** Eliminá la clave desde el panel de Google AI Studio.
- **No ingreses datos personales reales:** Según los términos del nivel gratuito de Google AI Studio / Gemini API, Google puede revisar o utilizar los prompts enviados para entrenar o mejorar sus modelos. Usá siempre ejemplos ficticios.

### Limitación técnica del modelo BYOK (Transparencia)
Al ser una aplicación 100% estática ejecutada en el navegador sin servidor intermedio:
- La API key viaja directamente desde tu navegador hacia `https://generativelanguage.googleapis.com`.
- **Limitación inherente:** La clave es visible dentro de las Herramientas de Desarrollador (*DevTools → Red / Application*) de **tu propio navegador** mientras la sesión esté activa. Por eso es fundamental cerrar la pestaña en equipos compartidos y mantener una política estricta contra XSS (Content Security Policy activa y cero scripts de terceros).

---

## Desarrollo Local

```bash
# Instalar dependencias (versiones exactas fijadas)
npm install

# Iniciar servidor de desarrollo
npm run dev

# Ejecutar tests automatizados
npm test

# Compilar para producción estática
npm run build

# Previsualizar compilación con cabeceras CSP estrictas
npm run preview
```
