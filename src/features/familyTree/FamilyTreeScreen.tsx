import React, { useState, useEffect } from 'react';
import { View, StyleSheet, FlatList, Image, Modal, Alert, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text, Appbar, Card, Button, TextInput, IconButton, FAB, Divider, Portal } from 'react-native-paper';
import { getDb } from '../../core/database';
import { useIsFocused } from '@react-navigation/native';
import { supabase } from '../../core/supabase';
import { useAuthStore } from '../../core/store';
import { syncConnections } from '../../core/socialSync';
import * as ImagePicker from 'expo-image-picker';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import SmartDropdown from '../../components/SmartDropdown';

const RELATIONSHIP_ITEMS = [
  { id: 'Padre', name: 'Padre' },
  { id: 'Madre', name: 'Madre' },
  { id: 'Hermano/a', name: 'Hermano/a' },
  { id: 'Hijo/a', name: 'Hijo/a' },
  { id: 'Abuelo/a', name: 'Abuelo/a' },
  { id: 'Tío/a', name: 'Tío/a' },
  { id: 'Primo/a', name: 'Primo/a' },
  { id: 'Pareja', name: 'Pareja' },
  { id: 'Amigo/a', name: 'Amigo/a' },
  { id: 'Otro', name: 'Otro' },
];

export default function FamilyTreeScreen({ navigation }: any) {
  const [people, setPeople] = useState<any[]>([]);
  const isFocused = useIsFocused();
  const session = useAuthStore((state) => state.session);
  const myId = session?.user?.id;

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<any | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  // Edit/Create Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<any | null>(null); // null means "Create New"
  const [editName, setEditName] = useState('');
  const [editNickname, setEditNickname] = useState('');
  const [editRelationship, setEditRelationship] = useState('');
  const [editAvatarUrl, setEditAvatarUrl] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [isLinked, setIsLinked] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadPeople = async () => {
    try {
      const db = await getDb();
      const rows = await db.getAllAsync<any>(`
        SELECT e.id, e.name, e.metadata, COUNT(me.memory_id) as mentions
        FROM entities e
        LEFT JOIN memory_entities me ON e.id = me.entity_id
        WHERE e.type = 'PERSON'
        GROUP BY e.id
        ORDER BY mentions DESC
      `);
      setPeople(rows);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSyncAndLoad = async () => {
    if (myId) {
      await syncConnections(myId);
    }
    await loadPeople();
  };

  useEffect(() => {
    if (isFocused) {
      handleSyncAndLoad();
    }
  }, [isFocused, myId]);

  const handleSearch = async () => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return;
    setSearchLoading(true);
    setSearchResult(null);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, full_name, avatar_url')
        .eq('username', q)
        .maybeSingle();

      if (error) {
        console.warn('Error fetching profile:', error);
        Alert.alert('Error', 'Hubo un error al realizar la búsqueda.');
      } else if (data) {
        // Verificar bloques mutuos
        const { data: blockData } = await supabase
          .from('blocks')
          .select('id')
          .or(`and(blocker_id.eq.${myId},blocked_id.eq.${data.id}),and(blocker_id.eq.${data.id},blocked_id.eq.${myId})`)
          .maybeSingle();

        if (!blockData) {
          setSearchResult(data);
        } else {
          Alert.alert('No encontrado', 'No se encontró ningún usuario con ese nombre exacto.');
        }
      } else {
        Alert.alert('No encontrado', 'No se encontró ningún usuario con ese nombre exacto.');
      }
    } catch (e) {
      console.warn(e);
    } finally {
      setSearchLoading(false);
    }
  };

  const openEditModal = (person: any) => {
    setSelectedPerson(person);
    const meta = person.metadata ? JSON.parse(person.metadata) : {};
    setEditName(person.name);
    setEditNickname(meta.nickname || '');
    setEditRelationship(meta.relationship || '');
    setEditAvatarUrl(meta.avatar_url || '');
    setEditUsername(meta.username || '');
    setIsLinked(!!meta.is_linked);
    setModalVisible(true);
  };

  const openCreateModal = () => {
    setSelectedPerson(null);
    setEditName('');
    setEditNickname('');
    setEditRelationship('');
    setEditAvatarUrl('');
    setEditUsername('');
    setIsLinked(false);
    setModalVisible(true);
  };

  const pickImage = async () => {
    if (isLinked) return;
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permiso Denegado', 'Necesitamos acceso a la galería para cambiar la foto.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setEditAvatarUrl(result.assets[0].uri);
      }
    } catch (e) {
      console.warn('Error al seleccionar imagen:', e);
    }
  };

  const handleSave = async () => {
    if (!editName.trim()) {
      Alert.alert('Falta Nombre', 'Por favor ingresa un nombre.');
      return;
    }

    setSaving(true);
    try {
      const db = await getDb();
      let targetUserId: string | null = null;
      let finalName = editName.trim();
      let finalAvatarUrl = editAvatarUrl;
      let finalUsername = editUsername.trim().toLowerCase();
      let linkStatus = isLinked;

      // Si se ingresó un nombre de usuario de la App, validar y conectar
      if (finalUsername && !isLinked) {
        const { data: targetProfile, error: profileErr } = await supabase
          .from('profiles')
          .select('id, username, full_name, avatar_url')
          .eq('username', finalUsername)
          .maybeSingle();

        if (profileErr || !targetProfile) {
          Alert.alert('Error de Vinculación', 'No se encontró un usuario con ese nombre en la app. Verifica que esté bien escrito.');
          setSaving(false);
          return;
        }

        targetUserId = targetProfile.id;
        finalName = targetProfile.full_name || finalName;
        finalAvatarUrl = targetProfile.avatar_url || finalAvatarUrl;
        linkStatus = true;

        // Enviar solicitud de conexión en Supabase
        if (myId && myId !== targetUserId) {
          const { data: conn } = await supabase
            .from('connections')
            .select('*')
            .or(`and(sender_id.eq.${myId},receiver_id.eq.${targetUserId}),and(sender_id.eq.${targetUserId},receiver_id.eq.${myId})`)
            .maybeSingle();

          if (!conn) {
            await supabase.from('connections').insert({
              sender_id: myId,
              receiver_id: targetUserId,
              status: 'PENDING',
            });
            Alert.alert('Solicitud Enviada', `Se ha enviado una solicitud de conexión a @${finalUsername}. Se actualizará su nombre y foto cuando acepte.`);
          }
        }
      }

      const meta = {
        nickname: editNickname.trim(),
        relationship: editRelationship,
        avatar_url: finalAvatarUrl,
        username: finalUsername,
        user_id: targetUserId || (selectedPerson ? JSON.parse(selectedPerson.metadata || '{}').user_id : null),
        is_linked: linkStatus,
      };

      if (selectedPerson) {
        // Actualizar
        await db.runAsync(
          "UPDATE entities SET name = ?, metadata = ? WHERE id = ?",
          finalName,
          JSON.stringify(meta),
          selectedPerson.id
        );
      } else {
        // Crear nuevo
        const newId = uuidv4();
        await db.runAsync(
          "INSERT INTO entities (id, type, name, metadata, is_confirmed) VALUES (?, 'PERSON', ?, ?, 1)",
          newId,
          finalName,
          JSON.stringify(meta)
        );
      }

      setModalVisible(false);
      await loadPeople();
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'No se pudo guardar la información.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    Alert.alert(
      'Eliminar Persona',
      '¿Estás seguro de que quieres eliminar a esta persona del árbol? Se conservarán sus recuerdos pero ya no aparecerá en la red.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              const db = await getDb();
              await db.runAsync("DELETE FROM memory_entities WHERE entity_id = ?", id);
              await db.runAsync("DELETE FROM entities WHERE id = ?", id);
              setModalVisible(false);
              await loadPeople();
            } catch (err) {
              console.error(err);
            }
          }
        }
      ]
    );
  };

  const renderPerson = ({ item }: { item: any }) => {
    const meta = item.metadata ? JSON.parse(item.metadata) : {};
    const nickname = meta.nickname;
    const relation = meta.relationship;
    const avatar = meta.avatar_url;
    const displayName = nickname ? `${item.name} (${nickname})` : item.name;

    return (
      <Card style={styles.card} onPress={() => navigation.navigate('EntityMemories', { entityId: item.id })} mode="flat">
        <View style={styles.cardInner}>
          <Image
            source={{
              uri: avatar || 'https://api.dicebear.com/7.x/adventurer/png?seed=' + item.name,
            }}
            style={styles.avatar}
          />
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>{displayName}</Text>
            <Text style={styles.cardSubtitle}>
              {relation ? `${relation} • ` : ''}{item.mentions} recuerdos
            </Text>
            {meta.is_linked && (
              <Text style={styles.linkedBadge}>👥 Vinculado a la app</Text>
            )}
          </View>
          <IconButton
            icon="pencil-outline"
            size={20}
            iconColor="#6200ee"
            onPress={() => openEditModal(item)}
            style={styles.editBtn}
          />
        </View>
      </Card>
    );
  };

  return (
    <View style={styles.container}>
      <Appbar.Header style={styles.appbar}>
        <Appbar.Content title="Red Social y Árbol" titleStyle={styles.headerTitle} />
      </Appbar.Header>

      {/* Buscador Superior */}
      <View style={styles.searchSection}>
        <View style={styles.searchRow}>
          <TextInput
            placeholder="Buscar por @usuario exacto en Mnemósine"
            value={searchQuery}
            onChangeText={(text) => {
              setSearchQuery(text);
              if (!text.trim()) setSearchResult(null);
            }}
            style={styles.searchInput}
            mode="outlined"
            activeOutlineColor="#6200ee"
            dense
            onSubmitEditing={handleSearch}
          />
          <Button
            mode="contained"
            onPress={handleSearch}
            loading={searchLoading}
            disabled={searchLoading}
            style={styles.searchBtn}
            buttonColor="#6200ee"
          >
            Buscar
          </Button>
        </View>

        {searchResult && (
          <Card style={styles.searchResultCard} mode="outlined">
            <TouchableOpacity
              style={styles.resultItem}
              onPress={() => {
                setSearchResult(null);
                setSearchQuery('');
                navigation.navigate('MemberProfile', { targetUser: searchResult });
              }}
            >
              <Image source={{ uri: searchResult.avatar_url || 'https://api.dicebear.com/7.x/adventurer/png?seed=placeholder' }} style={styles.resultAvatar} />
              <View style={styles.resultText}>
                <Text style={styles.resultName}>{searchResult.full_name}</Text>
                <Text style={styles.resultUsername}>@{searchResult.username}</Text>
              </View>
              <IconButton icon="chevron-right" size={24} iconColor="#6200ee" />
            </TouchableOpacity>
          </Card>
        )}
      </View>

      <FlatList
        data={people}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={renderPerson}
        ListEmptyComponent={
          <View style={styles.empty}>
            <IconButton icon="account-group-outline" size={64} iconColor="#aaa" />
            <Text variant="titleMedium" style={styles.emptyTitle}>Árbol Relacional Vacío</Text>
            <Text style={styles.emptySubtitle}>
              La IA agregará personas al procesar tus historias de audio, o puedes añadirlas tú manualmente usando el botón de abajo.
            </Text>
          </View>
        }
      />

      <FAB
        icon="plus"
        style={styles.fab}
        color="#ffffff"
        onPress={openCreateModal}
      />

      {/* Edit/Create Portal Modal */}
      <Portal>
        <Modal
          visible={modalVisible}
          onDismiss={() => setModalVisible(false)}
          animationType="slide"
          transparent={true}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Appbar.Header style={styles.modalHeader}>
                <Appbar.BackAction onPress={() => setModalVisible(false)} />
                <Appbar.Content title={selectedPerson ? "Editar Persona" : "Agregar Persona"} titleStyle={styles.modalTitle} />
                {selectedPerson && (
                  <Appbar.Action icon="trash-can-outline" color="#d32f2f" onPress={() => handleDelete(selectedPerson.id)} />
                )}
              </Appbar.Header>

              <ScrollView contentContainerStyle={styles.modalScroll}>
                <View style={styles.avatarUploadContainer}>
                  <TouchableOpacity onPress={pickImage} disabled={isLinked} style={styles.avatarPicker}>
                    <Image
                      source={{
                        uri: editAvatarUrl || 'https://api.dicebear.com/7.x/adventurer/png?seed=avatar',
                      }}
                      style={[styles.largeAvatar, isLinked && { opacity: 0.7 }]}
                    />
                    {!isLinked && (
                      <View style={styles.cameraIconBadge}>
                        <IconButton icon="camera" size={16} iconColor="#ffffff" />
                      </View>
                    )}
                  </TouchableOpacity>
                  {isLinked && (
                    <Text style={styles.linkedText}>Sincronizado con el usuario remoto</Text>
                  )}
                </View>

                <TextInput
                  label="Nombre Completo"
                  value={editName}
                  onChangeText={setEditName}
                  style={styles.input}
                  mode="outlined"
                  activeOutlineColor="#6200ee"
                  disabled={isLinked || saving}
                />

                <TextInput
                  label="Apodo"
                  value={editNickname}
                  onChangeText={setEditNickname}
                  style={styles.input}
                  mode="outlined"
                  activeOutlineColor="#6200ee"
                  disabled={saving}
                />

                <View style={styles.dropdownWrap}>
                  <SmartDropdown
                    label="Parentesco o Relación"
                    value={editRelationship}
                    items={RELATIONSHIP_ITEMS}
                    onSelect={(item) => {
                      if (item) setEditRelationship(item.name);
                    }}
                    onCreateNew={(name) => setEditRelationship(name)}
                    placeholder="Selecciona relación"
                    enablePlaces={false}
                  />
                </View>

                <Divider style={styles.divider} />

                <Text style={styles.sectionHeader}>🔗 Vinculación con Mnemósine</Text>
                <Text style={styles.hintText}>
                  Si esta persona también usa la app, coloca su nombre de usuario. Importaremos su foto y nombre real, y le enviaremos una solicitud de conexión.
                </Text>

                <TextInput
                  label="Nombre de Usuario de la App (@)"
                  value={editUsername}
                  onChangeText={setEditUsername}
                  style={styles.input}
                  mode="outlined"
                  activeOutlineColor="#6200ee"
                  autoCapitalize="none"
                  disabled={isLinked || saving}
                  placeholder="Ej: sofiagomez"
                />

                <Button
                  mode="contained"
                  onPress={handleSave}
                  style={styles.saveBtn}
                  buttonColor="#6200ee"
                  loading={saving}
                  disabled={saving}
                >
                  Guardar Cambios
                </Button>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  appbar: {
    backgroundColor: '#ffffff',
    elevation: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f3f5',
  },
  headerTitle: {
    fontWeight: 'bold',
  },
  searchSection: {
    padding: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    marginRight: 10,
    backgroundColor: '#ffffff',
  },
  searchBtn: {
    borderRadius: 8,
    height: 48,
    justifyContent: 'center',
  },
  searchResultCard: {
    marginTop: 12,
    borderColor: '#6200ee',
    backgroundColor: '#f6f0ff',
    borderRadius: 10,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  resultAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ffffff',
    marginRight: 12,
  },
  resultText: {
    flex: 1,
  },
  resultName: {
    fontWeight: 'bold',
    color: '#212529',
  },
  resultUsername: {
    color: '#868e96',
    fontSize: 12,
  },
  list: {
    padding: 16,
    paddingBottom: 80,
  },
  card: {
    marginBottom: 12,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    marginRight: 14,
    backgroundColor: '#f1f3f9',
  },
  cardText: {
    flex: 1,
  },
  cardTitle: {
    fontWeight: 'bold',
    fontSize: 15,
    color: '#212529',
  },
  cardSubtitle: {
    color: '#868e96',
    fontSize: 13,
    marginTop: 2,
  },
  linkedBadge: {
    fontSize: 11,
    color: '#2e7d32',
    fontWeight: '600',
    marginTop: 4,
  },
  editBtn: {
    margin: 0,
  },
  empty: {
    padding: 32,
    alignItems: 'center',
  },
  emptyTitle: {
    fontWeight: 'bold',
    color: '#495057',
    marginTop: 8,
    marginBottom: 4,
  },
  emptySubtitle: {
    textAlign: 'center',
    color: '#868e96',
    lineHeight: 20,
  },
  fab: {
    position: 'absolute',
    margin: 16,
    right: 0,
    bottom: 0,
    backgroundColor: '#6200ee',
    borderRadius: 28,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '90%',
  },
  modalHeader: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f3f5',
    elevation: 0,
  },
  modalTitle: {
    fontWeight: 'bold',
  },
  modalScroll: {
    padding: 20,
  },
  avatarUploadContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  avatarPicker: {
    position: 'relative',
  },
  largeAvatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#f1f3f9',
    borderWidth: 2,
    borderColor: '#e9ecef',
  },
  cameraIconBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#6200ee',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkedText: {
    fontSize: 12,
    color: '#868e96',
    marginTop: 8,
  },
  input: {
    marginBottom: 16,
    backgroundColor: '#ffffff',
  },
  dropdownWrap: {
    marginBottom: 16,
  },
  divider: {
    marginVertical: 16,
  },
  sectionHeader: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#212529',
    marginBottom: 4,
  },
  hintText: {
    fontSize: 12,
    color: '#6c757d',
    lineHeight: 18,
    marginBottom: 16,
  },
  saveBtn: {
    marginTop: 12,
    paddingVertical: 6,
    borderRadius: 10,
    marginBottom: 40,
  },
});
