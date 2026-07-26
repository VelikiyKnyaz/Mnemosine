import React, { useEffect } from 'react';
import { Provider as PaperProvider } from 'react-native-paper';
import { initDatabase } from './src/core/database';
import RootNavigator from './src/navigation/RootNavigator';

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
