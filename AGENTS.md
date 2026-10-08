# Desarrollo de Mnemósine

- El flujo actual es Expo local con Expo Go SDK 57. Usar `npm run start:go:clear` para el iPhone; la development build está preparada, pero no construida ni instalada. El usuario todavía no tiene membresía Apple Developer.
- Pendiente solicitado por el usuario: recordarle configurar la clave de Google cuando vayamos a implementar o probar Google Places/Geocoding. No se necesita para arrancar Expo ni para las pruebas unitarias. No pedir que la pegue en el chat; debe configurarse como secreto del backend autenticado, no como `EXPO_PUBLIC_*` ni en Git. No marcar la integración como verificada sin probarla.
- La migración de OpenAI y Google REST a backend sigue pendiente. `.env` ignorado, campos enmascarados y AsyncStorage no son una frontera de seguridad. No borrar ni sobrescribir las claves locales del usuario sin autorización.
- Mantener por ahora el acceso de diagnóstico con `66` solicitado para el prototipo. No aceptarlo como identidad o autorización del futuro backend; las llamadas remotas deberán validar una sesión real.
- Antes de entregar cambios, ejecutar los controles adecuados al riesgo: `npm run typecheck`, `npm test` y, si cambian dependencias o configuración nativa, `npm run doctor` y exportación sin cargar `.env`. No publicar builds ni desplegar servicios sin autorización.
