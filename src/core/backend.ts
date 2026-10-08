import { createBackendTransport } from './backendTransport';
import { supabase } from './supabase';
import { useAuthStore } from './store';
import { SUPABASE_URL, SUPABASE_PUBLIC_KEY } from './config';
import type { BackendStatus, LocationBias } from '../../shared/api';

export { BackendError } from './backendTransport';

export const requestBackend = createBackendTransport({
  url: SUPABASE_URL,
  publicKey: SUPABASE_PUBLIC_KEY,
  isDiagnostic: () => useAuthStore.getState().session?.access_token === 'debug',
  getAccessToken: async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data.session?.access_token ?? null;
  },
});

export const getBackendStatus = () => requestBackend<BackendStatus>({ action: 'status' });
export const searchPlacesText = (textQuery: string, limit = 5, signal?: AbortSignal) =>
  requestBackend<{ places?: any[] }>({ action: 'places.search', textQuery, limit }, signal);
export const autocompletePlaces = (params: { input: string; includedPrimaryTypes?: string[]; locationBias?: LocationBias }, signal?: AbortSignal) =>
  requestBackend<{ suggestions?: any[] }>({ action: 'places.autocomplete', ...params }, signal);
export const getPlaceDetails = (placeId: string) => requestBackend<any>({ action: 'places.details', placeId });
export const geocodeAddress = (address: string) => requestBackend<any>({ action: 'geocode.address', address });
export const reverseGeocode = (latitude: number, longitude: number) =>
  requestBackend<any>({ action: 'geocode.reverse', latitude, longitude });
