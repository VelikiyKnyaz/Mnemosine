# Mnemósine

Prototipo móvil para capturar recuerdos en texto o audio y organizarlos por
tiempo, lugares, personas y relaciones. El proyecto usa React Native con Expo
SDK 57, SQLite local y Supabase para las funciones de cuenta y conexión social.

El norte de producto y diseño está definido en el Documento Maestro v0.1.
Consulta las [notas de documentación](docs/README.md) para acceder al original.

## Estado actual

El prototipo incluye:

- captura de recuerdos en texto y audio;
- extracción asistida de fechas, lugares, personas y ambigüedades;
- línea de tiempo, atlas, red familiar y catálogo de elementos;
- buzón para resolver datos pendientes y sugerencias de compartir;
- autenticación, perfil, conexiones y recuerdos compartidos mediante Supabase;
- persistencia local con SQLite.

La implementación todavía no representa el MVP privado completo descrito en el
documento maestro. En particular, faltan cifrado local, exportación y borrado
integral, versionado/procedencia de transformaciones de IA, aislamiento local
por cuenta y controles de privacidad por recuerdo.

## Ejecutar localmente

Requisitos: Node.js 22 LTS (22.13 o posterior) y Expo Go compatible con SDK 57.

```bash
npm install
npm run check:env
npm run typecheck
npm test
npm run start:go:clear
```

### Abrir en un iPhone físico

1. Conecta el computador y el iPhone a la misma red Wi-Fi.
2. Desde la carpeta `app`, ejecuta `npm run start:go:clear`.
3. Escanea el QR de la terminal con la cámara del iPhone y abre el enlace en Expo Go.
4. Acepta el permiso de red local de Expo Go y el de micrófono al grabar.

Expo Go y el proyecto deben usar el mismo SDK. En este flujo no hace falta
importar el repositorio en Snack: Expo sirve directamente los archivos de tu
computador. Mantén la terminal abierta mientras pruebas.

Si la red bloquea la conexión local, prueba `npm start -- --tunnel` y sigue la
instalación del soporte de túnel que solicite Expo. `npm run ios` abre el simulador
en macOS; no es el comando para abrir un iPhone desde Windows.

La grabación y reproducción utilizan `expo-audio`, incluido en Expo Go SDK 57.
Los nuevos audios se guardan en el directorio de documentos de la aplicación,
no en una caché que iOS pueda limpiar.

También están disponibles:

```bash
npm run android
npm run ios
npm run web
```

El punto de entrada es `index.ts` y registra la raíz mediante Expo, por lo que el
proyecto puede ejecutarse tanto descargado desde Snack como desde el CLI local.
La vista web usa una base efímera sin persistencia; SQLite y el Atlas
completo se habilitan al abrir el proyecto en Expo Go para Android o iOS.

## Ciclo de desarrollo

Guarda los cambios de código y Fast Refresh los actualizará en el teléfono.
No necesitas hacer commit, push ni volver a importar el proyecto para cada
prueba. Los cambios de variables de entorno requieren una recarga completa
de la app; si hay una caché problemática, reinicia con `start:go:clear`.

`npm start` sigue abriendo Expo Go aunque `expo-dev-client` esté instalado.
`npm run start:dev` y `npm run start:dev:clear` están reservados para cuando
hayamos instalado una development build propia.

### Development build preparada, todavía no instalada

`eas.json` incluye los perfiles `development` (cliente de desarrollo),
`development-simulator` (simulador iOS) y `preview` (distribución interna).
No se ha creado un proyecto EAS, configurado identificadores definitivos,
firmado una app ni iniciado builds en la nube.

Desde Windows, la ruta EAS para instalar esa build en un iPhone requiere
una cuenta Expo y membresía Apple Developer. Mientras tanto, usa Expo Go
sin pagar esa membresía. Si más adelante dispones de un Mac con Xcode,
existe también la alternativa de compilar localmente para tu iPhone.
Cambiar módulos nativos, permisos nativos o SDK requerirá reconstruir
la development build; los cambios habituales de JavaScript no.
Consulta la [guía oficial de development builds](https://docs.expo.dev/develop/development-builds/introduction/).

### Comprobaciones automáticas

```bash
npm run typecheck
npm test
npm run doctor
```

La integración continua de GitHub ejecuta instalación con el lockfile,
TypeScript, pruebas unitarias y exportación de bundles iOS,
Android y web en cada push a `master` y pull request. No necesita claves,
no carga `.env`, no publica apps ni sube los bundles como artefactos.
Las pruebas actuales comprueban lógica, no sustituyen una revisión visual
ni las pruebas de audio, permisos y persistencia en el iPhone.

## Configuración y claves

Para una instalación nueva, copia `.env.example` como `.env`. Si ya existe
un `.env` local, consérvalo; no lo sobrescribas. El ejemplo solo contiene
configuración publicable:

```env
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

`.env*` está excluido de Git, excepto el ejemplo vacío. Esto evita subir el
archivo, pero **no protege las variables `EXPO_PUBLIC_*`**, que quedan incluidas
en la app. Metro es el servidor de desarrollo, no un backend de APIs.
Así lo explica la [documentación de Expo](https://docs.expo.dev/guides/environment-variables/).

| Integración actual | Tratamiento previsto |
| --- | --- |
| OpenAI: transcripción y extracción de recuerdos | Clave privada del backend; la app envía solicitudes autenticadas. |
| Google Places y Geocoding REST: búsquedas y coordenadas | Clave privada del backend, restringida por APIs y con límites de uso. |
| Mapa nativo del Atlas | iOS usa Apple Maps actualmente. Para una build Android propia, configurar aparte una clave del SDK Maps restringida a la app y su certificado. |
| Supabase: cuenta, perfil, conexiones y recuerdos compartidos | URL y clave `anon` en el cliente, con sesión real y políticas RLS/Storage verificadas. Nunca `service_role` ni una clave secreta en la app. |

La clave de OpenAI no debe vivir en el dispositivo, según la
[documentación oficial de OpenAI](https://developers.openai.com/api/reference/overview).
Las claves públicas de Supabase no sustituyen las políticas de autorización;
consulta su [guía de claves y RLS](https://supabase.com/docs/guides/getting-started/api-keys).
Las claves del SDK Maps nativo y las llamadas REST tienen restricciones
distintas; para estas últimas proponemos un proxy autenticado conforme a la
[guía de seguridad de Google Maps](https://developers.google.com/maps/api-security-best-practices).

### Migración de APIs pendiente

La propuesta es usar Supabase Edge Functions como backend de IA y Google:
validar una sesión real, exponer acciones concretas (no un relay de URLs o
modelos arbitrarios), fijar los parámetros permitidos y aplicar límites
de tamaño, tiempo y consumo. Las claves privadas se configurarían como
secretos del servidor, sin pegarlas en el chat ni en GitHub.

**Este backend todavía no está implementado.** El código heredado sigue
leyendo OpenAI/Google desde `EXPO_PUBLIC_*` o AsyncStorage y llamando a los
proveedores desde la app. Preparar el flujo local no elimina ese riesgo.
No se han borrado ni cambiado tus claves locales. Antes de distribuir una
app, migra esas llamadas y rota cualquier secreto que ya haya sido expuesto.

La pestaña Admin y el acceso temporal con `66` se mantienen para diagnóstico
del prototipo. No son autenticación válida para el futuro backend. Además,
los campos Supabase de ese panel no reconfiguran el cliente activo, que se
inicializa desde el entorno de Expo o los valores de respaldo.

`npm run check:env` avisa de secretos evidentes configurados como públicos
sin imprimir valores. Es informativo por defecto para no bloquear el flujo
heredado. `npm run check:env -- --strict` devuelve error si los detecta;
no reemplaza una auditoría de código, RLS, almacenamiento o bundles.
Por defecto revisa el entorno de desarrollo, sin depender de `NODE_ENV`.
Antes de una distribución, selecciona producción explícitamente:

```bash
npm run check:env -- --strict --environment production
```

Pendiente solicitado por el usuario: **recordar configurar la clave de Google
cuando implementemos o probemos Places/Geocoding**. No hace falta para arrancar
Expo ni ejecutar las pruebas unitarias. Se configurará como secreto del backend
autenticado; no en `EXPO_PUBLIC_*`, en el chat ni en el repositorio.

## Estructura

```text
App.tsx                 Inicialización de base de datos y proveedores
index.ts                Entrada registrada con Expo
src/core/               SQLite, IA, configuración y sincronización
src/features/           Pantallas agrupadas por capacidad
src/components/         Componentes reutilizables
src/navigation/         Navegación de autenticación, pestañas y detalle
docs/                   Documentación maestra del producto
```

## Alcance de seguridad

Este repositorio es un prototipo y no debe distribuirse todavía con datos
personales reales. Antes de producción se deben completar, como mínimo:

- retirar el acceso administrativo temporal mediante la contraseña `66`;
- bóveda local cifrada y bloqueo de aplicación;
- separación o limpieza de datos locales al cambiar de cuenta;
- backend para IA y geocodificación sin secretos en el dispositivo;
- esquema remoto versionado, políticas RLS y pruebas de autorización;
- exportación, borrado, procedencia y revisiones de accesibilidad.
