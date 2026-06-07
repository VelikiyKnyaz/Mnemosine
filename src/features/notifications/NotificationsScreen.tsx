import React, { useState, useEffect } from 'react';
import { View, StyleSheet, FlatList, Alert, Image, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Appbar, Card, Text, Button, IconButton } from 'react-native-paper';
import { supabase } from '../../core/supabase';
import { useAuthStore } from '../../core/store';
import { useIsFocused } from '@react-navigation/native';
import { syncConnections, fetchPendingSharedMemories, acceptSharedMemory, rejectSharedMemory } from '../../core/socialSync';

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
  const [notifications, setNotifications] = useState<any[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);

  const session = useAuthStore((state) => state.session);
  const myId = session?.user?.id;
  const isFocused = useIsFocused();

  const fetchRequests = async () => {
    if (!myId) return;
    setLoading(true);
    try {
      const [connsRes, sharedRes] = await Promise.all([
        supabase
          .from('connections')
          .select('*')
          .eq('receiver_id', myId)
          .eq('status', 'PENDING'),
        supabase
          .from('shared_memories')
          .select('*')
          .eq('receiver_id', myId)
          .eq('status', 'PENDING')
      ]);

      const conns = connsRes.data || [];
      const shared = sharedRes.data || [];

      const connSenderIds = conns.map((c: any) => c.sender_id);
      const sharedSenderIds = shared.map((s: any) => s.sender_id);
      const senderIds = Array.from(new Set([...connSenderIds, ...sharedSenderIds]));

      let profiles: any[] = [];
      if (senderIds.length > 0) {
        const { data: profs, error: profilesError } = await supabase
          .from('profiles')
          .select('id, username, full_name, avatar_url')
          .in('id', senderIds);

        if (profilesError) {
          console.warn('Error loading profiles:', profilesError);
        } else {
          profiles = profs || [];
        }
      }

      const formattedConns = conns.map((conn: any) => {
        const profile = profiles.find(p => p.id === conn.sender_id);
        return {
          id: conn.id,
          type: 'CONNECTION_REQUEST',
          created_at: conn.created_at,
          sender: profile || {
            id: conn.sender_id,
            username: 'usuario',
            full_name: 'Usuario de Mnemósine',
            avatar_url: '',
          },
          raw: conn
        };
      });

      const formattedShared = shared.map((sm: any) => {
        const profile = profiles.find(p => p.id === sm.sender_id);
        return {
          id: sm.id,
          type: 'SHARED_MEMORY',
          created_at: sm.created_at,
          sender: profile || {
            id: sm.sender_id,
            username: 'usuario',
            full_name: 'Usuario de Mnemósine',
            avatar_url: '',
          },
          raw: sm
        };
      });

      const allNotifications = [...formattedConns, ...formattedShared].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setNotifications(allNotifications);
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

  const handleAcceptSharedMemory = async (item: any) => {
    setActionId(item.id);
    try {
      const success = await acceptSharedMemory(item.raw, item.sender);
      if (success) {
        Alert.alert('Añadido', 'El recuerdo ha sido añadido a tu colección.');
        fetchRequests();
      } else {
        Alert.alert('Error', 'No se pudo añadir el recuerdo.');
      }
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Hubo un problema al aceptar el recuerdo.');
    } finally {
      setActionId(null);
    }
  };

  const handleRejectSharedMemory = async (item: any) => {
    setActionId(item.id);
    try {
      const success = await rejectSharedMemory(item.id);
      if (success) {
        Alert.alert('Descartado', 'El recuerdo ha sido descartado.');
        fetchRequests();
      } else {
        Alert.alert('Error', 'No se pudo descartar el recuerdo.');
      }
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Hubo un problema al descartar el recuerdo.');
    } finally {
      setActionId(null);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const renderConnectionRequestNotification = (item: any) => {
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
              uri: (() => {
                const url = item.sender.avatar_url || 'https://api.dicebear.com/7.x/adventurer/png?seed=placeholder';
                return url.startsWith('http') ? `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}` : url;
              })(),
              cache: 'reload',
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
              onPress={() => handleAccept(item.raw)}
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
              onPress={() => handleReject(item.raw)}
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
              onPress={() => handleBlock(item.raw)}
              disabled={isBusy}
              style={styles.blockBtn}
            />
          </View>
        </Card.Actions>
      </Card>
    );
  };

  const renderSharedMemoryNotification = (item: any) => {
    const isBusy = actionId === item.id;
    const isExpanded = expandedIds.has(item.id);
    const timeText = new Date(item.created_at).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });

    const entitiesList = Array.isArray(item.raw.entities) ? item.raw.entities : [];

    return (
      <Card style={styles.card} mode="flat">
        <TouchableOpacity activeOpacity={0.8} onPress={() => toggleExpand(item.id)}>
          <Card.Content style={styles.cardContent}>
            <Image
              source={{
                uri: (() => {
                  const url = item.sender.avatar_url || 'https://api.dicebear.com/7.x/adventurer/png?seed=placeholder';
                  return url.startsWith('http') ? `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}` : url;
                })(),
                cache: 'reload',
              }}
              style={styles.avatar}
            />
            <View style={styles.textContainer}>
              <Text style={[styles.title, { color: '#2e7d32' }]}>
                Mención en Recuerdo
              </Text>
              <Text style={styles.message}>
                <Text style={{ fontWeight: 'bold' }}>{item.sender.full_name}</Text> (@{item.sender.username}) te ha mencionado en un recuerdo: "{item.raw.title || 'Recuerdo'}".
              </Text>
              <Text style={styles.time}>{timeText}</Text>
              {!isExpanded && (
                <Text style={{ fontSize: 11, color: '#6200ee', marginTop: 4, fontWeight: 'bold' }}>
                  Presiona para leer contenido
                </Text>
              )}
            </View>
          </Card.Content>
        </TouchableOpacity>

        {isExpanded && (
          <Card.Content style={styles.expandedContent}>
            <View style={styles.divider} />
            <Text style={styles.sharedTitleText}>{item.raw.title || 'Recuerdo'}</Text>
            <Text style={styles.sharedBodyText}>{item.raw.raw_text}</Text>
            {entitiesList.length > 0 && (
              <View style={styles.tagsContainer}>
                {entitiesList.map((ent: any, idx: number) => (
                  <Text key={idx} style={styles.tagText}>
                    #{ent.name}
                  </Text>
                ))}
              </View>
            )}
          </Card.Content>
        )}

        <Card.Actions style={styles.actions}>
          <View style={styles.actionRow}>
            <Button
              mode="contained"
              onPress={() => handleAcceptSharedMemory(item)}
              loading={isBusy}
              disabled={isBusy}
              style={styles.acceptBtn}
              buttonColor="#2e7d32"
              labelStyle={styles.btnLabel}
            >
              Añadir
            </Button>
            <Button
              mode="outlined"
              onPress={() => handleRejectSharedMemory(item)}
              disabled={isBusy}
              style={styles.rejectBtn}
              textColor="#d32f2f"
              labelStyle={styles.btnLabel}
            >
              Descartar
            </Button>
          </View>
        </Card.Actions>
      </Card>
    );
  };

  const renderItem = ({ item }: { item: any }) => {
    if (item.type === 'SHARED_MEMORY') {
      return renderSharedMemoryNotification(item);
    }
    return renderConnectionRequestNotification(item);
  };

  return (
    <View style={styles.container}>
      <Appbar.Header style={styles.appbar}>
        <Appbar.Content title="Notificaciones" titleStyle={styles.headerTitle} />
      </Appbar.Header>

      {loading && notifications.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6200ee" />
        </View>
      ) : notifications.length === 0 ? (
        <View style={styles.emptyContainer}>
          <IconButton icon="bell-off-outline" size={64} iconColor="#aaa" />
          <Text variant="titleMedium" style={styles.emptyTitle}>Todo al día</Text>
          <Text variant="bodyMedium" style={styles.emptySubtitle}>
            No tienes notificaciones pendientes por el momento.
          </Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
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
  expandedContent: {
    paddingVertical: 4,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  divider: {
    height: 1,
    backgroundColor: '#f1f3f5',
    marginVertical: 8,
  },
  sharedTitleText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#212529',
    marginBottom: 6,
  },
  sharedBodyText: {
    fontSize: 14,
    color: '#495057',
    lineHeight: 20,
    fontStyle: 'italic',
    marginBottom: 12,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tagText: {
    fontSize: 11,
    color: '#2e7d32',
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
});
