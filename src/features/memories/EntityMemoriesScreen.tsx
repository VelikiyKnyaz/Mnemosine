import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Appbar } from 'react-native-paper';
import EntityMemoriesView from './EntityMemoriesView';

export default function EntityMemoriesScreen({ route, navigation }: any) {
  const { entityId } = route.params;
  const [rootEntityName, setRootEntityName] = useState('');

  return (
    <View style={styles.container}>
      <Appbar.Header>
        <Appbar.BackAction onPress={() => navigation.goBack()} />
        <Appbar.Content title={rootEntityName || 'Recuerdos'} />
      </Appbar.Header>

      <EntityMemoriesView 
        entityId={entityId} 
        onRootNameLoaded={setRootEntityName} 
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' }
});
