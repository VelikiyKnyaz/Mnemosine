import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator, Alert, Image, ScrollView } from 'react-native';
import { Appbar, Card, Button, Text, Title, Paragraph, Divider } from 'react-native-paper';
import { supabase } from '../../core/supabase';
import { useAuthStore } from '../../core/store';

export default function MemberProfileScreen({ route, navigation }: any) {
  const { targetUser: initialTargetUser } = route.params; // Contiene id, username, full_name, avatar_url
  const session = useAuthStore((state) => state.session);
  const myId = session?.user?.id;

  // Perfil actualizado en vivo desde Supabase (en lugar de usar datos estáticos de navegación)
  const [targetUser, setTargetUser] = useState(initialTargetUser);

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  
  // Estado de conexión: null = no hay relación, 'PENDING_SENT' = enviada por mí, 'PENDING_RECEIVED' = recibida, 'ACCEPTED' = conectados
  const [connectionState, setConnectionState] = useState<'NONE' | 'PENDING_SENT' | 'PENDING_RECEIVED' | 'ACCEPTED'>('NONE');
  const [connectionId, setConnectionId] = useState<string | null>(null);

  // Obtener perfil actualizado desde Supabase al montar
  const fetchLatestProfile = async () => {
    if (!initialTargetUser?.id) return;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, full_name, avatar_url')
        .eq('id', initialTargetUser.id)
        .maybeSingle();

      if (!error && data) {
        setTargetUser(data);
      }
    } catch (_) {}
  };

  const fetchConnectionStatus = async () => {
    if (!myId || !targetUser?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('connections')
        .select('*')
        .or(`and(sender_id.eq.${myId},receiver_id.eq.${targetUser.id}),and(sender_id.eq.${targetUser.id},receiver_id.eq.${myId})`)
        .maybeSingle();

      if (error) {
        console.warn('Error fetching connection status:', error);
      } else if (data) {
        setConnectionId(data.id);
        if (data.status === 'ACCEPTED') {
          setConnectionState('ACCEPTED');
        } else if (data.status === 'PENDING') {
          if (data.sender_id === myId) {
            setConnectionState('PENDING_SENT');
          } else {
            setConnectionState('PENDING_RECEIVED');
          }
        }
      } else {
        setConnectionState('NONE');
        setConnectionId(null);
      }
    } catch (e) {
      console.warn('Network error checking connection status:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLatestProfile();
    fetchConnectionStatus();
    
    // Real-time listener para conexiones
    const channel = supabase.channel('connections_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'connections' }, () => {
        fetchConnectionStatus();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [initialTargetUser?.id, myId]);

  const handleRequestConnection = async () => {
    if (!myId || !targetUser?.id) return;
    setActionLoading(true);
    try {
      const { data, error } = await supabase
        .from('connections')
        .insert({
          sender_id: myId,
          receiver_id: targetUser.id,
          status: 'PENDING',
          updated_at: new Date().toISOString()
        });

      if (error) {
        Alert.alert('Error', 'No se pudo enviar la solicitud de conexión.');
        console.error(error);
      } else {
        setConnectionState('PENDING_SENT');
        // connectionId will be updated by the real-time listener
        Alert.alert('Solicitud Enviada', `Se envió la solicitud de conexión a @${targetUser.username}.`);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelRequest = async () => {
    if (!connectionId) return;
    setActionLoading(true);
    try {
      const { error } = await supabase
        .from('connections')
        .delete()
        .eq('id', connectionId);

      if (error) {
        Alert.alert('Error', 'No se pudo cancelar la solicitud.');
      } else {
        setConnectionState('NONE');
        setConnectionId(null);
        Alert.alert('Cancelado', 'La solicitud de conexión ha sido cancelada.');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAcceptRequest = async () => {
    if (!connectionId) return;
    setActionLoading(true);
    try {
      const { error } = await supabase
        .from('connections')
        .update({ status: 'ACCEPTED', updated_at: new Date().toISOString() })
        .eq('id', connectionId);

      if (error) {
        Alert.alert('Error', 'No se pudo aceptar la solicitud.');
      } else {
        setConnectionState('ACCEPTED');
        Alert.alert('Conectados', `¡Ahora estás conectado con @${targetUser.username}!`);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveConnection = () => {
    Alert.alert(
      'Eliminar Conexión',
      `¿Estás seguro de que quieres eliminar tu conexión con @${targetUser.username}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            if (!connectionId) return;
            setActionLoading(true);
            try {
              const { error } = await supabase
                .from('connections')
                .delete()
                .eq('id', connectionId);

              if (error) {
                Alert.alert('Error', 'No se pudo eliminar la conexión.');
              } else {
                setConnectionState('NONE');
                setConnectionId(null);
                Alert.alert('Conexión Eliminada', 'Ya no estás conectado con esta persona.');
              }
            } catch (e) {
              console.error(e);
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleBlockUser = () => {
    Alert.alert(
      'Bloquear Usuario',
      `¿Estás seguro de que quieres bloquear a @${targetUser.username}? No podrá buscar tu perfil ni enviarte solicitudes nunca más.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Bloquear',
          style: 'destructive',
          onPress: async () => {
            if (!myId || !targetUser?.id) return;
            setActionLoading(true);
            try {
              // 1. Eliminar cualquier conexión previa
              if (connectionId) {
                await supabase.from('connections').delete().eq('id', connectionId);
              }

              // 2. Insertar en bloques
              const { error } = await supabase.from('blocks').insert({
                blocker_id: myId,
                blocked_id: targetUser.id,
              });

              if (error) {
                Alert.alert('Error', 'No se pudo bloquear al usuario.');
              } else {
                Alert.alert('Usuario Bloqueado', `@${targetUser.username} ha sido bloqueado.`);
                navigation.goBack();
              }
            } catch (e) {
              console.error(e);
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <Appbar.Header style={styles.appbar}>
        <Appbar.BackAction onPress={() => navigation.goBack()} />
        <Appbar.Content title={`Perfil de @${targetUser?.username || 'usuario'}`} titleStyle={styles.headerTitle} />
      </Appbar.Header>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6200ee" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Card style={styles.profileCard} mode="flat">
            <Card.Content style={styles.avatarSection}>
              <Image
                source={{
                  uri: targetUser?.avatar_url || 'https://api.dicebear.com/7.x/adventurer/png?seed=placeholder',
                  cache: 'reload',
                }}
                style={styles.avatar}
              />
              <Title style={styles.fullName}>{targetUser?.full_name || 'Usuario de Mnemósine'}</Title>
              <Paragraph style={styles.username}>@{targetUser?.username}</Paragraph>
            </Card.Content>

            <Divider style={styles.divider} />

            <Card.Content style={styles.bioSection}>
              <Text style={styles.privacyNote}>
                🔒 Este perfil es privado. Solo los usuarios conectados mutuamente pueden visualizar contenidos compartidos o relacionarse en el árbol familiar.
              </Text>
            </Card.Content>

            <Card.Content style={styles.actionsSection}>
              {connectionState === 'NONE' && (
                <Button
                  mode="contained"
                  onPress={handleRequestConnection}
                  loading={actionLoading}
                  disabled={actionLoading}
                  style={styles.actionBtn}
                  buttonColor="#6200ee"
                >
                  Solicitar Conexión
                </Button>
              )}

              {connectionState === 'PENDING_SENT' && (
                <View style={styles.pendingContainer}>
                  <Text style={styles.pendingText}>📨 Solicitud de conexión enviada</Text>
                  <Button
                    mode="outlined"
                    onPress={handleCancelRequest}
                    loading={actionLoading}
                    disabled={actionLoading}
                    style={[styles.actionBtn, { marginTop: 10, borderColor: '#B00020' }]}
                    textColor="#B00020"
                  >
                    Cancelar Solicitud
                  </Button>
                </View>
              )}

              {connectionState === 'PENDING_RECEIVED' && (
                <View style={styles.pendingContainer}>
                  <Text style={styles.pendingText}>📥 Te ha enviado una solicitud de conexión</Text>
                  <View style={styles.rowActions}>
                    <Button
                      mode="contained"
                      onPress={handleAcceptRequest}
                      loading={actionLoading}
                      disabled={actionLoading}
                      style={[styles.halfBtn, { marginRight: 8 }]}
                      buttonColor="#2e7d32"
                    >
                      Aceptar
                    </Button>
                    <Button
                      mode="outlined"
                      onPress={handleCancelRequest}
                      loading={actionLoading}
                      disabled={actionLoading}
                      style={[styles.halfBtn, { borderColor: '#B00020' }]}
                      textColor="#B00020"
                    >
                      Rechazar
                    </Button>
                  </View>
                </View>
              )}

              {connectionState === 'ACCEPTED' && (
                <View style={styles.pendingContainer}>
                  <Text style={styles.connectedBadge}>👥 Conectados en la Red Familiar</Text>
                  <Button
                    mode="outlined"
                    onPress={handleRemoveConnection}
                    loading={actionLoading}
                    disabled={actionLoading}
                    style={[styles.actionBtn, { marginTop: 12, borderColor: '#B00020' }]}
                    textColor="#B00020"
                  >
                    Eliminar Conexión
                  </Button>
                </View>
              )}

              <Button
                mode="text"
                onPress={handleBlockUser}
                disabled={actionLoading}
                style={styles.blockBtn}
                textColor="#B00020"
              >
                Bloquear Usuario
              </Button>
            </Card.Content>
          </Card>
        </ScrollView>
      )}
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: 20,
  },
  profileCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
    elevation: 0,
    paddingVertical: 20,
  },
  avatarSection: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  avatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 3,
    borderColor: '#6200ee',
    backgroundColor: '#f1f3f9',
    marginBottom: 16,
  },
  fullName: {
    fontWeight: 'bold',
    fontSize: 22,
    color: '#212529',
    textAlign: 'center',
  },
  username: {
    color: '#868e96',
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
  },
  divider: {
    marginVertical: 15,
  },
  bioSection: {
    paddingHorizontal: 15,
  },
  privacyNote: {
    fontSize: 13,
    color: '#6c757d',
    textAlign: 'center',
    lineHeight: 18,
  },
  actionsSection: {
    paddingTop: 20,
    alignItems: 'center',
  },
  actionBtn: {
    width: '100%',
    paddingVertical: 6,
    borderRadius: 12,
  },
  pendingContainer: {
    width: '100%',
    alignItems: 'center',
  },
  pendingText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#495057',
    marginBottom: 10,
    textAlign: 'center',
  },
  rowActions: {
    flexDirection: 'row',
    width: '100%',
  },
  halfBtn: {
    flex: 1,
    paddingVertical: 4,
    borderRadius: 10,
  },
  connectedBadge: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#2e7d32',
    backgroundColor: '#e8f5e9',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    textAlign: 'center',
    overflow: 'hidden',
  },
  blockBtn: {
    marginTop: 20,
  },
});
