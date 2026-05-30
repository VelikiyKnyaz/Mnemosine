import React, { useState } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { Appbar, Card, Text, Avatar, Button, IconButton, Badge } from 'react-native-paper';

interface NotificationItem {
  id: string;
  type: 'mention' | 'family' | 'inbox' | 'system';
  title: string;
  message: string;
  time: string;
  read: boolean;
  avatarUrl?: string;
  avatarInitials?: string;
  avatarColor?: string;
}

const INITIAL_NOTIFICATIONS: NotificationItem[] = [
  {
    id: '1',
    type: 'mention',
    title: 'Nueva mención en un recuerdo',
    message: 'Juan te etiquetó en el recuerdo "Vacaciones de verano en la playa en 2012".',
    time: 'Hace 5 min',
    read: false,
    avatarInitials: 'JD',
    avatarColor: '#6200ee',
  },
  {
    id: '2',
    type: 'family',
    title: 'Actualización del Árbol Familiar',
    message: 'Sofía agregó una foto de perfil antigua a tu abuelo "Carlos Gómez".',
    time: 'Hace 2 horas',
    read: false,
    avatarInitials: 'SG',
    avatarColor: '#03dac6',
  },
  {
    id: '3',
    type: 'inbox',
    title: 'Pregunta pendiente de Mnemósine',
    message: 'Se detectó una ambigüedad: ¿En qué año fue tu mudanza a Medellín con tu familia?',
    time: 'Ayer',
    read: true,
    avatarInitials: 'M',
    avatarColor: '#ff0266',
  },
  {
    id: '4',
    type: 'system',
    title: 'Procesamiento de IA Completo',
    message: 'El analizador cronológico procesó tu último audio y generó 3 hitos de vida nuevos.',
    time: 'Hace 2 días',
    read: true,
    avatarInitials: 'IA',
    avatarColor: '#3f51b5',
  },
];

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState<NotificationItem[]>(INITIAL_NOTIFICATIONS);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const toggleRead = (id: string) => {
    setNotifications(prev =>
      prev.map(n => (n.id === id ? { ...n, read: !n.read } : n))
    );
  };

  const deleteNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const clearAll = () => {
    Alert.alert(
      'Limpiar notificaciones',
      '¿Estás seguro de que quieres borrar todas las notificaciones?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Borrar Todo', style: 'destructive', onPress: () => setNotifications([]) },
      ]
    );
  };

  const getIcon = (type: NotificationItem['type']) => {
    switch (type) {
      case 'mention':
        return 'at';
      case 'family':
        return 'account-multiple-outline';
      case 'inbox':
        return 'help-circle-outline';
      case 'system':
        return 'robot-outline';
      default:
        return 'bell-outline';
    }
  };

  const renderItem = ({ item }: { item: NotificationItem }) => {
    const iconName = getIcon(item.type);

    return (
      <Card style={[styles.card, !item.read && styles.unreadCard]} mode="flat">
        <Card.Content style={styles.cardContent}>
          {item.avatarInitials ? (
            <Avatar.Text
              size={48}
              label={item.avatarInitials}
              style={[styles.avatar, { backgroundColor: item.avatarColor || '#6200ee' }]}
              labelStyle={styles.avatarText}
            />
          ) : (
            <Avatar.Icon
              size={48}
              icon={iconName}
              style={[styles.avatar, { backgroundColor: '#f0f0f0' }]}
              color="#333"
            />
          )}

          <View style={styles.textContainer}>
            <View style={styles.rowHeader}>
              <Text style={[styles.title, !item.read && styles.unreadText]}>{item.title}</Text>
              {!item.read && <Badge size={8} style={styles.dot} />}
            </View>
            <Text style={styles.message}>{item.message}</Text>
            <Text style={styles.time}>{item.time}</Text>
          </View>
        </Card.Content>
        <Card.Actions style={styles.actions}>
          <Button
            mode="text"
            compact
            onPress={() => toggleRead(item.id)}
            textColor="#6200ee"
          >
            {item.read ? 'Marcar no leído' : 'Marcar leído'}
          </Button>
          <IconButton
            icon="trash-can-outline"
            iconColor="#B00020"
            size={18}
            onPress={() => deleteNotification(item.id)}
          />
        </Card.Actions>
      </Card>
    );
  };

  return (
    <View style={styles.container}>
      <Appbar.Header style={styles.appbar}>
        <Appbar.Content
          title={
            <View style={styles.titleContainer}>
              <Text variant="titleLarge" style={styles.headerTitle}>Notificaciones</Text>
              {unreadCount > 0 && (
                <Badge style={styles.headerBadge} size={20}>
                  {unreadCount}
                </Badge>
              )}
            </View>
          }
        />
        {notifications.length > 0 && (
          <>
            <Appbar.Action icon="check-all" onPress={markAllAsRead} title="Marcar todo leído" />
            <Appbar.Action icon="delete-sweep-outline" onPress={clearAll} title="Borrar todo" />
          </>
        )}
      </Appbar.Header>

      {notifications.length === 0 ? (
        <View style={styles.emptyContainer}>
          <IconButton icon="bell-off-outline" size={64} iconColor="#aaa" />
          <Text variant="titleMedium" style={styles.emptyTitle}>Todo al día</Text>
          <Text variant="bodyMedium" style={styles.emptySubtitle}>
            No tienes notificaciones pendientes. Cuando haya interacciones sociales o tareas de IA, aparecerán aquí.
          </Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
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
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontWeight: 'bold',
  },
  headerBadge: {
    marginLeft: 8,
    backgroundColor: '#6200ee',
    fontWeight: 'bold',
  },
  listContent: {
    padding: 16,
  },
  card: {
    marginBottom: 12,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  unreadCard: {
    backgroundColor: '#f1f3f9',
    borderColor: '#d0ebff',
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingBottom: 8,
  },
  avatar: {
    marginRight: 12,
  },
  avatarText: {
    fontWeight: 'bold',
    fontSize: 16,
    color: '#ffffff',
  },
  textContainer: {
    flex: 1,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#343a40',
    flex: 1,
    marginRight: 8,
  },
  unreadText: {
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  dot: {
    backgroundColor: '#6200ee',
  },
  message: {
    fontSize: 13,
    color: '#495057',
    lineHeight: 18,
    marginBottom: 6,
  },
  time: {
    fontSize: 11,
    color: '#868e96',
  },
  actions: {
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f3f5',
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
