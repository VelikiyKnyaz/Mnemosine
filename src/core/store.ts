import { create } from 'zustand';
import { Session } from '@supabase/supabase-js';

interface AuthState {
  session: Session | null;
  setSession: (session: Session | null) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  needsOnboarding: boolean;
  setNeedsOnboarding: (needs: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  setSession: (session) => set({ session }),
  isLoading: true,
  setIsLoading: (isLoading) => set({ isLoading }),
  needsOnboarding: false,
  setNeedsOnboarding: (needsOnboarding) => set({ needsOnboarding }),
}));
