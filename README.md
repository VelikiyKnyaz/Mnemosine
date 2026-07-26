# Mnemósine

Prototipo móvil para capturar recuerdos en texto o audio y organizarlos por
tiempo, lugares, personas y relaciones. El proyecto usa React Native con Expo
SDK 54, SQLite local y Supabase para las funciones de cuenta y conexión social.

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

Requisitos: Node.js y una versión reciente de Expo Go compatible con SDK 54.

```bash
npm install
npm run typecheck
npm start
```

También están disponibles:

```bash
npm run android
npm run ios
npm run web
```

El punto de entrada es `index.ts` y registra la raíz mediante Expo, por lo que el
proyecto puede ejecutarse tanto descargado desde Snack como desde el CLI local.
La vista web de Snack usa una base efímera sin persistencia; SQLite y el Atlas
completo se habilitan al abrir el proyecto en Expo Go para Android o iOS.

## Configuración

Copia `.env.example` como `.env` y completa las variables necesarias:

```env
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_OPENAI_API_KEY=
EXPO_PUBLIC_GOOGLE_MAPS_KEY=
```

En Snack, configura los mismos valores en el entorno del proyecto y reinicia la
previsualización para limpiar la caché.

La clave anónima de Supabase puede estar en el cliente únicamente si las tablas
y el almacenamiento tienen políticas RLS correctas. Las claves de OpenAI y
Google Maps expuestas como `EXPO_PUBLIC_*` son aceptables solo para probar este
prototipo controlado: una versión distribuible debe llamar a esos proveedores
desde un backend autenticado y aplicar límites de uso.

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
