import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, ActivityIndicator } from 'react-native';

import { supabase } from '../core/supabase';
import { useAuthStore } from '../core/store';

import LoginScreen from '../features/auth/LoginScreen';
import RegisterScreen from '../features/auth/RegisterScreen';
import TimelineScreen from '../features/timeline/TimelineScreen';
import AtlasScreen from '../features/atlas/AtlasScreen';
import FamilyTreeScreen from '../features/familyTree/FamilyTreeScreen';

import EntitiesScreen from '../features/entities/EntitiesScreen';
import ProfileScreen from '../features/profile/ProfileScreen';
import DebugScreen from '../features/debug/DebugScreen';
import EntityMemoriesScreen from '../features/memories/EntityMemoriesScreen';
import NotificationsScreen from '../features/notifications/NotificationsScreen';
import OnboardingScreen from '../features/auth/OnboardingScreen';
import MemberProfileScreen from '../features/familyTree/MemberProfileScreen';
import { getDb } from '../core/database';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
    </Stack.Navigator>
  );
}


function MainTabs() {
  const session = useAuthStore(state => state.session);
  const isAdmin = session?.user?.role === 'admin';

  return (
    <Tab.Navigator>
      <Tab.Screen name="Timeline" component={TimelineScreen} options={{ title: 'Línea de Tiempo' }} />
      <Tab.Screen name="Atlas" component={AtlasScreen} options={{ title: 'Atlas' }} />
      <Tab.Screen name="FamilyTree" component={FamilyTreeScreen} options={{ title: 'Red Social' }} />
      <Tab.Screen name="Entities" component={EntitiesScreen} options={{ title: 'Elementos' }} />
      <Tab.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notificaciones' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Perfil' }} />
      {isAdmin && <Tab.Screen name="Debug" component={DebugScreen} options={{ title: '⚙️ Admin' }} />}
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { session, setSession, isLoading, setIsLoading, needsOnboarding, setNeedsOnboarding } = useAuthStore();

  // Verificar si el usuario requiere onboarding lineal al cambiar la sesión
  const checkProfileStatus = async (userId: string) => {
    try {
      const db = await getDb();
      
      // 1. Primero ver si ya existe un perfil completo localmente
      const profile = await db.getFirstAsync<any>('SELECT * FROM user_profile WHERE id = ?', userId);
      if (profile && profile.full_name && profile.birth_date) {
        setNeedsOnboarding(false);
        return;
      }

      // 2. Si no está en SQLite, consultar en la base de datos remota de Supabase
      const { data: remoteProfile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error && error.code !== '42P01') {
        console.warn('Error verificando perfil remoto en Supabase:', error);
      }

      // Si el usuario ya tiene un perfil remoto con nombre completo, asumimos que ya completó el onboarding
      if (remoteProfile && remoteProfile.full_name) {
        await db.runAsync(
          'INSERT OR REPLACE INTO user_profile (id, username, full_name, avatar_url, birth_date, hometown, country, life_events) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          userId,
          remoteProfile.username || 'user',
          remoteProfile.full_name,
          remoteProfile.avatar_url || '',
          '1990', // fallback por defecto de año de nacimiento para no forzar onboarding
          '',
          '',
          ''
        );
        setNeedsOnboarding(false);
      } else {
        // Si no tiene perfil remoto completo, es porque se loguea por primera vez con esta cuenta
        setNeedsOnboarding(true);
      }
    } catch (e) {
      console.warn('Error verificando perfil:', e);
      // Por seguridad ante fallos de red en usuarios que ya iniciaron sesión anteriormente,
      // no forzar onboarding si al menos existe la sesión activa
      setNeedsOnboarding(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // 🔐 SUPABASE REAL AUTH LOGIC:
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        await checkProfileStatus(session.user.id);
      }
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      if (session?.user) {
        await checkProfileStatus(session.user.id);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [setIsLoading, setSession]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {session ? (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {needsOnboarding ? (
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
          ) : (
            <>
              <Stack.Screen name="Main" component={MainTabs} />
              <Stack.Screen name="EntityMemories" component={EntityMemoriesScreen} />
              <Stack.Screen name="MemberProfile" component={MemberProfileScreen} />
            </>
          )}
        </Stack.Navigator>
      ) : (
        <AuthStack />
      )}
    </NavigationContainer>
  );
}
