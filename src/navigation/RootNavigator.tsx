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
import InboxScreen from '../features/inbox/InboxScreen';
import EntitiesScreen from '../features/entities/EntitiesScreen';
import ProfileScreen from '../features/profile/ProfileScreen';
import DebugScreen from '../features/debug/DebugScreen';
import EntityMemoriesScreen from '../features/memories/EntityMemoriesScreen';

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

import FamilyTreeScreen from '../features/familyTree/FamilyTreeScreen';

function MainTabs() {
  const session = useAuthStore(state => state.session);
  const isAdmin = session?.user?.role === 'admin';

  return (
    <Tab.Navigator>
      <Tab.Screen name="Timeline" component={TimelineScreen} options={{ title: 'Línea de Tiempo' }} />
      <Tab.Screen name="Atlas" component={AtlasScreen} options={{ title: 'Atlas' }} />
      <Tab.Screen name="FamilyTree" component={FamilyTreeScreen} options={{ title: 'Red Social' }} />
      <Tab.Screen name="Entities" component={EntitiesScreen} options={{ title: 'Elementos' }} />
      <Tab.Screen name="Inbox" component={InboxScreen} options={{ title: 'Buzón' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Perfil' }} />
      {isAdmin && <Tab.Screen name="Debug" component={DebugScreen} options={{ title: '⚙️ Admin' }} />}
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { session, setSession, isLoading, setIsLoading } = useAuthStore();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsLoading(false);
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
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
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="EntityMemories" component={EntityMemoriesScreen} />
        </Stack.Navigator>
      ) : (
        <AuthStack />
      )}
    </NavigationContainer>
  );
}
