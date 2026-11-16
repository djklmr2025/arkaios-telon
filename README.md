# Telón

Historias interactivas con personajes de IA. Entras en un episodio como protagonista, escribes lo que haces o dices y el narrador continúa la escena. Corre en tu equipo, sin monedas, anuncios, cuentas ni rastreo.

Es una app original del ecosistema ARKAIOS: código, nombre, diseño y episodios son propios.

## Qué incluye

- **Biblioteca** con tres episodios de muestra (misterio, ciencia ficción, fantasía).
- **Partidas** de episodio con narrador y personajes, guardadas en disco para continuarlas.
- **Charlas 1:1** con cualquier personaje, fuera de la historia.
- **Editor** para crear, editar y borrar episodios propios (hasta 6 personajes).
- **Perfil** de protagonista: nombre y descripción que el narrador tiene en cuenta.
- **Motor intercambiable**: Ollama local o un proveedor compatible con OpenAI.

## Requisitos

- Node.js 22 o superior (probado con Node 24). No hay dependencias que instalar.
- Un motor de IA, a elegir:
  - [Ollama](https://ollama.com) con un modelo descargado (por defecto `gemma3:4b`), o
  - una clave de un proveedor con API compatible con OpenAI.

## Cómo correrla

```bash
node server.js
```

Abre <http://localhost:4500>. En **Ajustes → Probar motor** se comprueba la conexión.

Con Ollama, si falta el modelo:

```bash
ollama pull gemma3:4b
```

En un portátil sin GPU cada respuesta puede tardar uno o dos minutos; el texto aparece según se genera.

## Motor más rápido (opcional)

1. Copia `.env.example` como `.env` y pon tu clave en `TELON_API_KEY`.
2. Reinicia el servidor.
3. En **Ajustes** elige «Proveedor compatible con OpenAI» y escribe la URL base de la API (la que termina en `/v1` o equivalente) y el nombre del modelo que indique tu proveedor.

La clave solo se lee de `.env`; la app nunca la guarda ni la devuelve. Al usar un proveedor externo, el texto de tus partidas se envía a ese proveedor, y los límites del nivel gratuito los fija él.

## Versión web pública

Con `TELON_MODE=web` (o `node server.js --web`) Telón funciona como sitio público sin cuentas:

- Cada visitante pega **su propia clave** de Google Gemini en Ajustes (hay un enlace para sacarla gratis). No hay clave del dueño del sitio.
- Partidas, episodios propios, perfil y clave se guardan **solo en el navegador** del visitante (`localStorage`). El servidor no guarda nada.
- La clave viaja en cada jugada al servidor, que la reenvía a Gemini y la olvida. El servidor solo habla con la URL fija del proveedor y limita a 30 peticiones por minuto por visitante.
- Borrar los datos del sitio en el navegador borra las partidas.

El archivo `render.yaml` despliega esta versión en Render (plan gratuito): New → Blueprint → este repositorio. En el plan gratuito el servicio se duerme tras un rato sin visitas y la primera carga tarda cerca de un minuto.

## Usarla desde el teléfono

En `.env`:

```
TELON_HOST=0.0.0.0
```

Reinicia y abre `http://<IP-de-tu-PC>:4500` desde un dispositivo de la misma red. En este modo cualquiera en tu red puede abrir la app y leer tus partidas; úsalo solo en redes de confianza. El motor de IA solo se puede cambiar desde el propio equipo.

## Configuración

| Variable | Por defecto | Para qué |
|---|---|---|
| `TELON_PORT` | `4500` | Puerto del servidor |
| `TELON_HOST` | `127.0.0.1` | Dirección de escucha |
| `TELON_DATA_DIR` | `./data` | Carpeta de datos |
| `TELON_API_KEY` | — | Clave del proveedor compatible con OpenAI (solo modo local) |
| `TELON_MODE` | `local` | `web` activa la versión pública sin estado |

Los datos viven en `data/` como JSON (`episodes`, `sessions`, `profile`, `settings`). Borrar la carpeta restaura los episodios de muestra.

## Pruebas

```bash
npm test
```

```bash
npm run coverage
```

Las pruebas usan un motor falso y carpetas temporales: no necesitan Ollama ni red.

## Estructura

```
server.js        arranque y variables de entorno
src/app.js       enrutador
src/http.js      comprobación de host/origen, cuerpos JSON, archivos estáticos
src/routes.js    API REST y respuesta en flujo
src/engines.js   clientes de Ollama y de API compatible con OpenAI
src/prompt.js    instrucciones para el narrador y los personajes
src/store.js     almacén en archivos JSON
src/validate.js  validación de entradas
src/seed.js      episodios de muestra y valores por defecto
public/          interfaz web (HTML, CSS y JS sin dependencias)
test/            pruebas con node:test
```

## Límites conocidos

- Solo texto: no genera imágenes ni vídeo.
- Un solo usuario; no hay cuentas, feed ni clasificaciones.
- El narrador recuerda los últimos 16 mensajes de cada partida.
