# eJoi Backend - Image Generation API

Backend API para generación y edición de imágenes con IA, parte de la plataforma eJoi.

## Descripción

Servicio NestJS que acepta prompts de texto, genera imágenes usando los modelos de OpenAI (gpt-image-1), las almacena en Google Cloud Storage y devuelve URLs firmadas para su acceso. También soporta edición de imágenes: subir una imagen existente con un prompt para modificarla.

## Stack tecnológico

| Categoría | Tecnología |
|---|---|
| Framework | NestJS 11 |
| Lenguaje | TypeScript 5.8 |
| Compilador | SWC |
| Base de datos | Prisma (instalado, por configurar) |
| Caché | Redis (cache-manager-redis-yet) |
| Almacenamiento | Google Cloud Storage |
| IA | OpenAI (gpt-image-1) |
| Autenticación | JWT + Passport |
| Documentación | Swagger/OpenAPI |
| Testing | Jest + Supertest |

## Instalación

```bash
npm install
```

## Configuración

Copia el archivo `.env.example` (o crea un `.env`) con las siguientes variables:

```env
# Server
PORT=3000
LOG_LEVEL=info

# OpenAI
OPENAI_API_KEY=your_openai_key
LLM_MODEL=gpt-4o-mini
LLM_MAX_OUTPUT_TOKENS=300
LLM_TEMPERATURE=0.7
LLM_TIMEOUT_MS=12000

# Proveedor de imágenes (openai | segmind)
IMAGE_PROVIDER=openai
ENABLE_IMAGE_PROVIDER_FALLBACK=false

# Segmind (Imagen 4 Fast)
SEGMIND_API_KEY=
SEGMIND_DEFAULT_ASPECT_RATIO=16:9
SEGMIND_NEGATIVE_PROMPT=blurry, pixelated, ugly, distorted, low quality

# JWT
JWT_SECRET=your_secret
JWT_EXPIRES_IN=7d

# Google Cloud Storage
GCP_PROJECT_ID=your_project_id
GCP_CLIENT_EMAIL=your_client_email
GCP_PRIVATE_KEY=your_private_key
GCS_BUCKET_NAME=your_bucket_name

# Redis
REDIS_URL=redis://localhost:6379
```

> **IMPORTANTE:** Nunca commitees el archivo `.env` con credenciales reales.

## Scripts disponibles

```bash
# Desarrollo
npm run start:dev

# Producción
npm run build
npm run start:prod

# Linting y formateo
npm run lint
npm run format

# Tests
npm run test
npm run test:e2e
npm run test:cov
```

## Endpoints

### Health check

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/` | Health check |

### Documentación

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/docs` | Swagger UI |

### Autenticación

| Método | Ruta | Guard | Descripción |
|--------|------|-------|-------------|
| POST | `/auth` | Ninguno | Login. Acepta `{ email, password }`, devuelve JWT |
| GET | `/auth` | JwtAuthGuard | Verifica estado de autenticación |

### Imágenes

| Método | Ruta | Guard | Descripción |
|--------|------|-------|-------------|
| POST | `/image/generate` | JwtAuthGuard | Genera imagen desde un prompt de texto |
| POST | `/image/generate-with-image` | JwtAuthGuard | Edita una imagen existente con un prompt |

### LLM

| Método | Ruta | Guard | Descripción |
|--------|------|-------|-------------|
| POST | `/llm/image` | JwtAuthGuard | Endpoint alternativo para generación de imágenes |

## DTOs

### GenerateImageDTO

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| prompt | string | No | Prompt para generar la imagen (tiene valor por defecto) |
| userId | string | No | ID del usuario |
| companionId | string | No | ID del companion |
| uuid | string | No | UUID para organización en GCS |
| size | string | No | Tamaño de la imagen |
| quality | string | No | Calidad de la imagen |
| style | string | No | Estilo de la imagen |
| negativePrompt | string | No | Prompt negativo (usado por Segmind) |
| aspectRatio | string | No | `1:1` \| `4:3` \| `3:4` \| `9:16` \| `16:9` (usado por Segmind) |

### AuthDTO

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| email | string | Sí | Email del usuario |
| password | string | Sí | Contraseña del usuario |

## Arquitectura

```
src/
├── auth/          # Autenticación JWT (Passport +策略)
├── image/         # Endpoints de generación y edición de imágenes
├── llm/           # Integración con OpenAI
├── storage/       # Integración con Google Cloud Storage
├── app.module.ts  # Módulo raíz y configuración global
└── main.ts        # Entry point
```

### Flujo de generación de imágenes

1. El cliente envía un prompt al endpoint `/image/generate`
2. Se verifica el cache en Redis (key: `llm:image:{uuid}:{prompt}`)
3. Si no hay cache, `ImageService` resuelve el provider vía `ImageProviderFactory` y genera la imagen
4. La imagen se sube a Google Cloud Storage
5. Se genera una URL firmada (60 min de expiración)
6. El resultado se cachea en Redis (TTL: 10 min)
7. Se devuelve la URL al cliente

### Proveedores de imágenes (Adapter/Provider)

La generación texto-a-imagen está desacoplada detrás de la interfaz `ImageProvider`
(`src/image/providers/`). Se selecciona por variable de entorno:

- `IMAGE_PROVIDER=openai` (por defecto) → OpenAI `gpt-image-1`.
- `IMAGE_PROVIDER=segmind` → Segmind Imagen 4 Fast (`imagen-4-fast`).
- Valor inválido → se usa `openai` (con warning en logs).

Fallback opcional: si `IMAGE_PROVIDER=segmind`, Segmind falla y
`ENABLE_IMAGE_PROVIDER_FALLBACK=true`, se reintenta con OpenAI.

El contrato de respuesta de `/image/generate` se mantiene igual independientemente
del provider: `{ uuid, filename, fileUrl, createdAt }`.

> **Nota:** `/image/generate-with-image` (edición imagen-a-imagen) usa solo OpenAI
> `images.edit`; Segmind Imagen 4 Fast es solo texto-a-imagen.

#### Probar localmente con OpenAI

```env
IMAGE_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

```bash
npm run start:dev
# POST /image/generate  (con JWT)  body: { "prompt": "un zorro cyberpunk" }
```

#### Probar localmente con Segmind

```env
IMAGE_PROVIDER=segmind
SEGMIND_API_KEY=sg-...
SEGMIND_DEFAULT_ASPECT_RATIO=16:9
```

```bash
npm run start:dev
# POST /image/generate  (con JWT)
# body: { "prompt": "un zorro cyberpunk", "aspectRatio": "16:9", "negativePrompt": "blurry" }
```

### Flujo de edición de imágenes

1. El cliente envía un archivo + prompt a `/image/generate-with-image`
2. Se valida el archivo (PNG/JPEG/WEBP, máx 10MB)
3. Se llama a OpenAI `images.edit` con la imagen y el prompt
4. El resultado se sube a GCS y se devuelve la URL firmada

## Características

- **Caché Redis:** Los resultados de generación se cachean para evitar llamadas redundantes a OpenAI
- **Rate Limiting:** 10 requests por ventana de 60 segundos
- **CORS:** Habilitado globalmente
- **Timeout:** Todas las llamadas a OpenAI tienen timeout configurable (60s para imágenes)
- **Almacenamiento GCS:** Las imágenes se organizan como `{uuid}/{YYYY-MM-DD}/{randomUUID}.{ext}`

## Estado actual

> **Nota:** El módulo de autenticación es un stub. El login siempre devuelve un JWT válido sin validar credenciales contra una base de datos. Prisma está instalado pero aún no se ha configurado el schema ni la capa de persistencia.
