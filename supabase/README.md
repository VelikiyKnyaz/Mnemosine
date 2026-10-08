# Backend de Mnemósine

**Desplegado el 8 de octubre de 2026** en `eknupuhacgqfgmbrxrys`:
`mnemosine-api` activa (despliegue v2), `verify_jwt=true` y migración de cuotas aplicada.
El campo `version` de `status` es la versión del contrato API (1), no la revisión del despliegue.
Se confirmaron ambos nombres de Secrets, arranque del handler, CORS,
rechazo sin JWT/66/clave anon y permisos del RPC únicamente para `service_role`.
El límite de transcripción se probó en una transacción revertida, sin dejar
contadores de prueba. No se modificaron recuerdos, perfiles ni Storage.
**Pendiente:** invocar Google/OpenAI con una sesión real de la app y verificar
los resultados en iPhone. Las pruebas remotas realizadas hasta ahora no
consumieron proveedores.
No es el servidor Metro: este backend se ejecuta en tu proyecto Supabase.
Expo Go puede consumirlo sin Apple Developer ni una development build.

## Activación en el proyecto existente

Revisar y autorizar el destino antes de ejecutar estos pasos:

1. Confirmar que el ID del proyecto del Dashboard coincide con el host de
   `EXPO_PUBLIC_SUPABASE_URL` de la app. No hace falta compartir claves.
2. En Edge Functions → Secrets, configurar `OPENAI_API_KEY` y
   `GOOGLE_MAPS_API_KEY`, sin prefijo `EXPO_PUBLIC_`. Supabase aporta la URL y
   sus claves internas al runtime; no copiarlas al cliente.
3. En Google Cloud, habilitar Places API (New), Geocoding API y facturación.
   Restringir la clave a esas APIs. Una restricción por iOS, Android o referrer
   no corresponde a estas llamadas REST desde Supabase. Restricciones por IP
   requieren una salida estable conocida; no inventar una IP de Edge Functions.
   Configurar cuotas y alertas de gasto: las alertas no detienen el consumo.
4. Desde `app`, iniciar sesión en el CLI de Supabase (la sesión de Expo no sirve):

   ```powershell
   npx --yes supabase@2.120.0 login --agent=no
   ```

5. Revisar y ejecutar **solo**
   `migrations/202610080001_api_quotas.sql` en el SQL Editor de ese proyecto,
   o mediante el CLI autenticado (ruta utilizada en el despliegue inicial):

   ```powershell
   npx --yes supabase@2.120.0 db query --linked --project-ref ID_REAL_DEL_PROYECTO --file supabase/migrations/202610080001_api_quotas.sql
   ```

   Añade una tabla de contadores y un RPC; no modifica recuerdos, perfiles
   ni Storage. No usar `db reset` ni `db push` a ciegas sobre el esquema existente.
6. Con el ID real confirmado, desplegar únicamente esta función:

   ```powershell
   npx --yes supabase@2.120.0 functions deploy mnemosine-api --project-ref ID_REAL_DEL_PROYECTO --use-api
   ```

   `--use-api` permite el bundle sin Docker en Windows. Mantener
   `verify_jwt=true` en `config.toml`; no usar `--no-verify-jwt` ni `--prune`.
7. Recargar Expo Go e iniciar sesión con una cuenta **real de Mnemósine**.
   Admin → Comprobar backend debe informar función conectada, cuotas activas y
   ambos secretos configurados. No consume APIs ni certifica claves válidas.
8. Probar una búsqueda conocida, un recuerdo de prueba corto y un audio breve.
   Estas acciones sí consumen APIs. Verificar resultado, permisos del iPhone,
   errores de facturación y que sin conexión el original permanezca local.

La función usa las claves `SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS`
del runtime cuando están disponibles; admite también las heredadas. La clave
con privilegios elevados solo accede al RPC de cuotas, nunca se devuelve al
cliente. La identidad se verifica con Auth antes de leer el cuerpo o consumir
proveedores. El acceso local `66` no se envía como credencial válida.

## Contrato y límites iniciales

Todas las operaciones requieren POST, clave pública del proyecto y JWT de
usuario en `Authorization: Bearer`. Se validan campos y tamaños antes de cuota.

| Acción | Datos permitidos |
| --- | --- |
| `status` | Solo la acción; informa presencia de secretos y disponibilidad del RPC. |
| `ai.segment` | `text` de hasta 12 000 caracteres; máximo 20 fragmentos en orden y sin inventar texto. |
| `ai.extract` | `text`, `existingEntitiesContext` (8 000), `timeContext` y `spaceContext` (2 000 cada uno); resultado validado. |
| `audio.transcribe` | Multipart `action` y `file`, hasta 10 MiB, extensión y MIME de audio admitidos. |
| `places.search` | `textQuery` hasta 500 caracteres y `limit` de 1 a 5. |
| `places.autocomplete` | `input`, tipos territoriales permitidos y sesgo geográfico validado; radio máximo 50 km. |
| `places.details` | `placeId` sin segmentos de ruta o query arbitrarios. |
| `geocode.address` / `geocode.reverse` | Dirección hasta 500 caracteres o latitud/longitud válidas. |

| Grupo | Por minuto y usuario | Por día UTC y usuario | Por día UTC y proyecto |
| --- | ---: | ---: | ---: |
| Google | 120 | 1 000 | 5 000 |
| Segmentación/extracción | 10 | 150 | 500 |
| Transcripción | 2 | 30 | 100 |

Son límites por petición, no presupuestos en dinero. Segmentación y extracción
cuentan por separado; Atlas puede consultar variantes global/local y detalles.
Los rechazos posteriores a reclamar cuota no devuelven el contador. Las cuotas
diarias y de minuto se actualizan mediante UPSERT atómico con orden consistente
de bloqueos; si falta el RPC o falla, no se consume el proveedor. Ajustarlas con
una nueva migración y según el testeo, no eliminando el control.

Audio de mayor tamaño o trabajos largos requieren un flujo asíncrono de Storage
y worker, no aumentar indiscriminadamente los límites de una función síncrona.
Actualmente se conservan `gpt-4o-mini` y `whisper-1` para no cambiar dos variables
durante esta migración. Whisper tiene retirada anunciada para el 26 de febrero
de 2027; planificar y probar su reemplazo antes de esa fecha según
[las deprecaciones de OpenAI](https://developers.openai.com/api/docs/deprecations).

## Privacidad y mantenimiento

No se persisten recuerdos, audios, lugares ni secretos en el backend añadido.
La tabla de cuotas solo contiene identificador de usuario/proyecto, grupo,
ventana y contador. No sustituye la bóveda cifrada, el aislamiento por cuenta,
las políticas de privacidad/RLS del resto del prototipo ni la retención de los
proveedores. `store:false` evita guardar Chat Completions para su recuperación;
no equivale a Zero Data Retention.

La tabla no tiene limpieza automática todavía. En una siguiente fase,
programar retención de contadores antiguos con autorización; no borrar ventanas
activas porque permitiría superar las cuotas. Las pruebas PGlite son de una
conexión: verificar concurrencia con PostgreSQL remoto antes de producción.

Native iOS/Android no requieren CORS. Para web se permiten localhost:8081 y
127.0.0.1:8081. Configurar `MNEMOSINE_ALLOWED_ORIGINS` con orígenes exactos
separados por comas si se usa otro puerto/dominio; CORS no sustituye la sesión.

Para cambios de función, volver a desplegarla; Fast Refresh solo actualiza el
cliente. Cambiar Secrets no requiere reenviar las claves a la app. No pegar
tokens del CLI ni API keys en chat, terminal compartida o archivos versionados.

## Verificación local sin claves

```powershell
npm run typecheck
npm test
```

Auth, proveedores y transporte usan respuestas ficticias. La migración se
ejecuta en PostgreSQL temporal en memoria; no se conecta a tu proyecto Supabase.
No se puede marcar el despliegue ni las claves como verificados con estas pruebas.
