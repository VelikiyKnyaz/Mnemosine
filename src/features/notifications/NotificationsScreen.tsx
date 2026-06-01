import React, { useState, useEffect } from 'react';
import { View, StyleSheet, FlatList, Alert, Image, ActivityIndicator } from 'react-native';
import { Appbar, Card, Text, Button, IconButton } from 'react-native-paper';
import { supabase } from '../../core/supabase';
import { useAuthStore } from '../../core/store';
import { useIsFocused } from '@react-navigation/native';
import { syncConnections } from '../../core/socialSync';

interface ConnectionRequest {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: string;
  created_at: string;
  sender: {
    id: string;
    username: string;
    full_name: string;
    avatar_url: string;
  };
}

export default function NotificationsScreen() {
  const [requests, setRequests] = useState<ConnectionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);

  const session = useAuthStore((state) => state.session);
  const myId = session?.user?.id;
  const isFocused = useIsFocused();

  const fetchRequests = async () => {
    if (!myId) return;
    setLoading(true);
    try {
      const { data: conns, error: connsError } = await supabase
        .from('connections')
        .select('*')
        .eq('receiver_id', myId)
        .eq('status', 'PENDING');

      if (connsError) {
        console.warn('Error loading connections:', connsError);
      } else if (conns && conns.length > 0) {
        const senderIds = conns.map(c => c.sender_id);
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('id, username, full_name, avatar_url')
          .in('id', senderIds);

        if (profilesError) {
          console.warn('Error loading profiles:', profilesError);
        } else {
          const formatted = conns.map(conn => {
            const profile = profiles.find(p => p.id === conn.sender_id);
            return {
              ...conn,
              sender: profile || {
                id: conn.sender_id,
                username: 'usuario',
                full_name: 'Usuario de Mnemósine',
                avatar_url: '',
              }
            };
          });
          setRequests(formatted);
        }
      } else {
        setRequests([]);
      }
    } catch (e) {
      console.warn('Network request failed loading notifications:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isFocused) {
      fetchRequests();
    }
  }, [isFocused, myId]);

  const handleAccept = async (request: ConnectionRequest) => {
    setActionId(request.id);
    try {
      const { error } = await supabase
        .from('connections')
        .update({ status: 'ACCEPTED', updated_at: new Date().toISOString() })
        .eq('id', request.id);

      if (error) {
        Alert.alert('Error', 'No se pudo aceptar la solicitud.');
      } else {
        Alert.alert('Conectados', `¡Ahora estás conectado con @${request.sender.username}!`);
        await syncConnections(myId);
        fetchRequests();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setActionId(null);
    }
  };

  const handleReject = async (request: ConnectionRequest) => {
    setActionId(request.id);
    try {
      const { error } = await supabase
        .from('connections')
        .delete()
        .eq('id', request.id);

      if (error) {
        Alert.alert('Error', 'No se pudo rechazar la solicitud.');
      } else {
        Alert.alert('Rechazada', 'La solicitud ha sido rechazada.');
        fetchRequests();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setActionId(null);
    }
  };

  const handleBlock = (request: ConnectionRequest) => {
    Alert.alert(
      'Bloquear Usuario',
      `¿Estás seguro de que quieres bloquear a @${request.sender.username}? No podrá buscar tu perfil ni enviarte solicitudes nunca más.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Bloquear',
          style: 'destructive',
          onPress: async () => {
            setActionId(request.id);
            try {
              await supabase.from('connections').delete().eq('id', request.id);
              const { error } = await supabase.from('blocks').insert({
                blocker_id: myId,
                blocked_id: request.sender_id,
              });

              if (error) {
                Alert.alert('Error', 'No se pudo bloquear al usuario.');
              } else {
                Alert.alert('Bloqueado', `@${request.sender.username} ha sido bloqueado.`);
                fetchRequests();
              }
            } catch (e) {
              console.error(e);
            } finally {
              setActionId(null);
            }
          }
        }
      ]
    );
  };

  const renderItem = ({ item }: { item: ConnectionRequest }) => {
    const isBusy = actionId === item.id;
    const timeText = new Date(item.created_at).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });

    return (
      <Card style={styles.card} mode="flat">
        <Card.Content style={styles.cardContent}>
          <Image
            source={{
              uri: item.sender.avatar_url || 'https://api.dicebear.com/7.x/adventurer/png?seed=placeholder',
            }}
            style={styles.avatar}
          />
          <View style={styles.textContainer}>
            <Text style={styles.title}>
              Solicitud de Conexión
            </Text>
            <Text style={styles.message}>
              <Text style={{ fontWeight: 'bold' }}>{item.sender.full_name}</Text> (@{item.sender.username}) quiere conectarse contigo en Mnemósine.
            </Text>
            <Text style={styles.time}>{timeText}</Text>
          </View>
        </Card.Content>
        <Card.Actions style={styles.actions}>
          <View style={styles.actionRow}>
            <Button
              mode="contained"
              onPress={() => handleAccept(item)}
              loading={isBusy}
              disabled={isBusy}
              style={styles.acceptBtn}
              buttonColor="#2e7d32"
              labelStyle={styles.btnLabel}
            >
              Aceptar
            </Button>
            <Button
              mode="outlined"
              onPress={() => handleReject(item)}
              disabled={isBusy}
              style={styles.rejectBtn}
              textColor="#d32f2f"
              labelStyle={styles.btnLabel}
            >
              Rechazar
            </Button>
            <IconButton
              icon="account-cancel-outline"
              iconColor="#d32f2f"
              size={20}
              onPress={() => handleBlock(item)}
              disabled={isBusy}
              style={styles.blockBtn}
            />
          </View>
        </Card.Actions>
      </Card>
    );
  };

  return (
    <View style={styles.container}>
      <Appbar.Header style={styles.appbar}>
        <Appbar.Content title="Notificaciones" titleStyle={styles.headerTitle} />
      </Appbar.Header>

      {loading && requests.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6200ee" />
        </View>
      ) : requests.length === 0 ? (
        <View style={styles.emptyContainer}>
          <IconButton icon="bell-off-outline" size={64} iconColor="#aaa" />
          <Text variant="titleMedium" style={styles.emptyTitle}>Todo al día</Text>
          <Text variant="bodyMedium" style={styles.emptySubtitle}>
            No tienes solicitudes de conexión pendientes por el momento.
          </Text>
        </View>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshing={loading}
          onRefresh={fetchRequests}
        />
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
  listContent: {
    padding: 16,
  },
  card: {
    marginBottom: 16,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e9ecef',
    elevation: 0,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 8,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#f1f3f9',
    marginRight: 16,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#6200ee',
    marginBottom: 4,
  },
  message: {
    fontSize: 13,
    color: '#343a40',
    lineHeight: 18,
    marginBottom: 6,
  },
  time: {
    fontSize: 11,
    color: '#868e96',
  },
  actions: {
    borderTopWidth: 1,
    borderTopColor: '#f1f3f5',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  acceptBtn: {
    flex: 1,
    marginRight: 8,
    borderRadius: 8,
  },
  rejectBtn: {
    flex: 1,
    marginRight: 8,
    borderRadius: 8,
    borderColor: '#d32f2f',
  },
  blockBtn: {
    margin: 0,
  },
  btnLabel: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
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
});
