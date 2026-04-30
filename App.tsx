import React, { useEffect } from 'react';
import { AccessibilityInfo, Appearance } from 'react-native';
import { Provider as PaperProvider } from 'react-native-paper';
import { initDatabase } from './src/core/database';
import RootNavigator from './src/navigation/RootNavigator';

// Polyfills para react-native-paper v4.9.x en RN 0.73+
if (!AccessibilityInfo.removeEventListener) {
  (AccessibilityInfo as any).removeEventListener = () => {};
}
if (!Appearance.removeChangeListener) {
  (Appearance as any).removeChangeListener = () => {};
}

export default function App() {
  useEffect(() => {
    initDatabase().catch(console.error);
  }, []);

  return (
    <PaperProvider>
      <RootNavigator />
    </PaperProvider>
  );
}
