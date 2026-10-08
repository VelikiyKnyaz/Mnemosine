export class BackendError extends Error {
  constructor(public code: string, message: string, public status = 0) {
    super(message);
    this.name = 'BackendError';
  }
}

interface BackendTransportOptions {
  url: string;
  publicKey: string;
  getAccessToken: () => Promise<string | null>;
  isDiagnostic?: () => boolean;
  fetch?: typeof fetch;
}

// Independiente de React Native: pruebas de auth y errores sin APIs reales.
export function createBackendTransport(options: BackendTransportOptions) {
  return async function request<T>(body: Record<string, unknown> | FormData, signal?: AbortSignal): Promise<T> {
    if (options.isDiagnostic?.()) {
      throw new BackendError('AUTH_REQUIRED', 'El acceso 66 es solo diagnóstico. Sal y entra con tu cuenta real para usar IA y búsquedas de Google.', 401);
    }
    const token = await options.getAccessToken();
    if (!token || token === 'debug') throw new BackendError('AUTH_REQUIRED', 'Inicia sesión con una cuenta real de Mnemósine para usar el backend.', 401);
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort);
    const timer = setTimeout(abort, 115000);
    try {
      const multipart = body instanceof FormData;
      const response = await (options.fetch ?? fetch)(`${options.url}/functions/v1/mnemosine-api`, {
        method: 'POST',
        headers: {
          apikey: options.publicKey,
          Authorization: `Bearer ${token}`,
          ...(!multipart ? { 'Content-Type': 'application/json' } : {}),
        },
        body: multipart ? body : JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.status === 404) throw new BackendError('NOT_DEPLOYED', 'El backend todavía no está desplegado en este proyecto de Supabase.', 404);
      let data: any;
      try { data = await response.json(); }
      catch { throw new BackendError('INVALID_RESPONSE', 'El backend no devolvió una respuesta válida.', response.status); }
      if (!response.ok) {
        const known = data?.error;
        throw new BackendError(
          typeof known?.code === 'string' ? known.code : 'BACKEND_ERROR',
          typeof known?.message === 'string' ? known.message : response.status === 401
            ? 'Tu sesión fue rechazada. Inicia sesión otra vez; no desactives la verificación JWT del backend.'
            : 'No se pudo completar la solicitud al backend.',
          response.status,
        );
      }
      return data as T;
    } catch (error) {
      if (error instanceof BackendError) throw error;
      throw new BackendError(controller.signal.aborted ? 'REQUEST_ABORTED' : 'NETWORK_ERROR',
        controller.signal.aborted ? 'La solicitud se canceló o tardó demasiado. Puedes reintentar.' : 'No hay conexión con el backend. Los recuerdos permanecen guardados en el dispositivo.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
}
