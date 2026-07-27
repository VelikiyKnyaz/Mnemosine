import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Appbar,
  Button,
  Chip,
  Divider,
  IconButton,
  Text,
  TextInput,
} from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import {
  getAvatarUri,
  parsePersonMetadata,
  PersonRecord,
} from './relationshipModel';

const RELATIONSHIP_ITEMS = [
  'Yo',
  'Padre',
  'Madre',
  'Hermano/a',
  'Hijo/a',
  'Abuelo/a',
  'Tío/a',
  'Primo/a',
  'Pareja',
  'Amigo/a',
  'Otro',
].map((name) => ({ id: name, name }));

export interface PersonEditorValues {
  name: string;
  nickname: string;
  relationship: string;
  avatarUrl: string;
  username: string;
  birthYear: string;
  birthDecade: string;
}

interface PersonEditorModalProps {
  visible: boolean;
  person: PersonRecord | null;
  suggestedRelationship?: string;
  saving: boolean;
  isCurrentUser: boolean;
  onDismiss: () => void;
  onSave: (values: PersonEditorValues) => void;
  onDelete?: () => void;
  onUnlink?: () => void;
}

export default function PersonEditorModal({
  visible,
  person,
  suggestedRelationship = '',
  saving,
  isCurrentUser,
  onDismiss,
  onSave,
  onDelete,
  onUnlink,
}: PersonEditorModalProps) {
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [relationship, setRelationship] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [username, setUsername] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [birthDecade, setBirthDecade] = useState('');

  const metadata = useMemo(
    () => parsePersonMetadata(person?.metadata),
    [person],
  );
  const isLinked = Boolean(metadata.is_linked);

  const decades = useMemo(() => {
    const currentDecade = Math.floor(new Date().getFullYear() / 10) * 10;
    const values: string[] = [];
    for (let decade = currentDecade; decade >= 1880; decade -= 10) {
      values.push(`${decade}s`);
    }
    return values;
  }, []);

  useEffect(() => {
    if (!visible) return;

    const nextMetadata = parsePersonMetadata(person?.metadata);
    setName(person?.name ?? '');
    setNickname(
      typeof nextMetadata.nickname === 'string' ? nextMetadata.nickname : '',
    );
    setRelationship(
      suggestedRelationship ||
        (typeof nextMetadata.relationship === 'string'
          ? nextMetadata.relationship
          : ''),
    );
    setAvatarUrl(
      typeof nextMetadata.avatar_url === 'string'
        ? nextMetadata.avatar_url
        : '',
    );
    setUsername(
      typeof nextMetadata.username === 'string' ? nextMetadata.username : '',
    );
    setBirthDecade(
      typeof nextMetadata.birth_decade === 'string'
        ? nextMetadata.birth_decade
        : '',
    );
    setBirthYear(nextMetadata.birth_decade ? '' : person?.birth_date ?? '');
  }, [person, suggestedRelationship, visible]);

  const pickImage = async () => {
    if (isLinked || saving) return;

    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Permiso necesario',
          'Permite el acceso a la galería para elegir una fotografía.',
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]?.uri) {
        setAvatarUrl(result.assets[0].uri);
      }
    } catch (error) {
      console.warn('[Relationship tree] Image selection failed:', error);
      Alert.alert('No se pudo abrir la galería');
    }
  };

  const submit = () => {
    onSave({
      name,
      nickname,
      relationship,
      avatarUrl,
      username,
      birthYear,
      birthDecade,
    });
  };

  const avatarSource =
    avatarUrl ||
    (person
      ? getAvatarUri(person)
      : 'https://api.dicebear.com/7.x/initials/png?seed=Nueva%20persona');

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onDismiss}
    >
      <SafeAreaView style={styles.safeArea}>
        <Appbar.Header style={styles.header}>
          <Appbar.Action
            icon="close"
            disabled={saving}
            onPress={onDismiss}
          />
          <Appbar.Content
            title={person ? 'Editar persona' : 'Nueva persona'}
            subtitle={
              person
                ? 'Datos personales y vínculo con la app'
                : 'Añádela a tu red relacional'
            }
            titleStyle={styles.headerTitle}
          />
          {person && !isCurrentUser && onDelete ? (
            <Appbar.Action
              icon="delete-outline"
              color="#b3261e"
              disabled={saving}
              onPress={onDelete}
            />
          ) : null}
        </Appbar.Header>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.avatarSection}>
              <TouchableOpacity
                onPress={pickImage}
                disabled={isLinked || saving}
                style={styles.avatarButton}
                accessibilityRole="button"
                accessibilityLabel="Elegir fotografía"
              >
                <Image source={{ uri: avatarSource }} style={styles.avatar} />
                {!isLinked ? (
                  <View style={styles.cameraBadge}>
                    <IconButton
                      icon="camera-outline"
                      iconColor="#ffffff"
                      size={16}
                      style={styles.cameraIcon}
                    />
                  </View>
                ) : null}
              </TouchableOpacity>
              <Text style={styles.avatarHint}>
                {isLinked
                  ? 'Foto sincronizada con su cuenta'
                  : 'Toca la imagen para cambiarla'}
              </Text>
            </View>

            <Text style={styles.sectionTitle}>Identidad</Text>
            <TextInput
              mode="outlined"
              label="Nombre completo"
              value={name}
              onChangeText={setName}
              disabled={isLinked || saving}
              style={styles.input}
              activeOutlineColor="#6d3fc0"
            />
            <TextInput
              mode="outlined"
              label="Apodos"
              value={nickname}
              onChangeText={setNickname}
              disabled={saving}
              placeholder="Ej.: Beto, Robertito"
              style={styles.input}
              activeOutlineColor="#6d3fc0"
            />
            <TextInput
              mode="outlined"
              label="Relación general contigo"
              value={relationship}
              onChangeText={setRelationship}
              disabled={saving}
              placeholder="Ej.: Tía, amigo de la infancia"
              style={styles.input}
              activeOutlineColor="#6d3fc0"
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.relationshipOptions}
            >
              {RELATIONSHIP_ITEMS.slice(0, -2).map((item) => (
                <Chip
                  key={item.id}
                  selected={relationship === item.name}
                  onPress={() => setRelationship(item.name)}
                  disabled={saving}
                  style={styles.relationshipChip}
                >
                  {item.name}
                </Chip>
              ))}
            </ScrollView>

            <Divider style={styles.divider} />
            <Text style={styles.sectionTitle}>Tiempo</Text>
            <TextInput
              mode="outlined"
              label="Año de nacimiento"
              value={birthYear}
              onChangeText={(value) => {
                setBirthYear(value.replace(/[^\d]/g, '').slice(0, 4));
                if (value) setBirthDecade('');
              }}
              keyboardType="number-pad"
              maxLength={4}
              disabled={saving}
              placeholder="Ej.: 1984"
              style={styles.input}
              activeOutlineColor="#6d3fc0"
            />
            <Text style={styles.fieldHint}>
              Si no conoces el año exacto, elige una década aproximada.
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.decades}
            >
              {decades.map((decade) => (
                <Chip
                  key={decade}
                  selected={birthDecade === decade}
                  onPress={() => {
                    setBirthDecade(
                      birthDecade === decade ? '' : decade,
                    );
                    setBirthYear('');
                  }}
                  style={styles.decadeChip}
                  disabled={saving}
                >
                  {decade}
                </Chip>
              ))}
            </ScrollView>

            <Divider style={styles.divider} />
            <Text style={styles.sectionTitle}>Cuenta de Mnemosine</Text>
            <Text style={styles.fieldHint}>
              Si esta persona usa la app, puedes enviarle una solicitud mediante
              su nombre de usuario.
            </Text>
            <TextInput
              mode="outlined"
              label="Usuario de la app"
              value={username}
              onChangeText={(value) =>
                setUsername(value.trimStart().replace(/^@/, '').toLowerCase())
              }
              autoCapitalize="none"
              autoCorrect={false}
              disabled={isLinked || saving}
              left={<TextInput.Affix text="@" />}
              style={styles.input}
              activeOutlineColor="#6d3fc0"
            />

            {isLinked && person && onUnlink ? (
              <Button
                mode="outlined"
                icon="link-off"
                textColor="#b3261e"
                disabled={saving}
                onPress={onUnlink}
                style={styles.unlinkButton}
              >
                Desvincular cuenta
              </Button>
            ) : null}

            <Button
              mode="contained"
              icon="content-save-outline"
              textColor="#ffffff"
              loading={saving}
              disabled={saving}
              onPress={submit}
              style={styles.saveButton}
              contentStyle={styles.saveButtonContent}
            >
              {person ? 'Guardar cambios' : 'Crear persona'}
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: {
    flex: 1,
    backgroundColor: '#faf8fc',
  },
  header: {
    backgroundColor: '#ffffff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e2eb',
  },
  headerTitle: {
    color: '#2c2730',
    fontWeight: '800',
  },
  content: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    padding: 20,
    paddingBottom: 48,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarButton: {
    width: 104,
    height: 104,
  },
  avatar: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: '#ece6ef',
  },
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    borderWidth: 3,
    borderColor: '#faf8fc',
    backgroundColor: '#6d3fc0',
  },
  cameraIcon: {
    width: 30,
    height: 30,
    margin: 0,
  },
  avatarHint: {
    marginTop: 10,
    color: '#766f7b',
    fontSize: 12,
  },
  sectionTitle: {
    marginBottom: 10,
    color: '#302a34',
    fontSize: 16,
    fontWeight: '800',
  },
  input: {
    marginBottom: 12,
    backgroundColor: '#ffffff',
  },
  fieldHint: {
    marginTop: -3,
    marginBottom: 10,
    color: '#756e7a',
    fontSize: 12,
    lineHeight: 18,
  },
  divider: {
    marginVertical: 22,
    backgroundColor: '#e3dce7',
  },
  decades: {
    paddingVertical: 4,
    paddingRight: 12,
  },
  decadeChip: {
    marginRight: 8,
  },
  relationshipOptions: {
    paddingTop: 1,
    paddingRight: 12,
  },
  relationshipChip: {
    marginRight: 8,
  },
  unlinkButton: {
    marginTop: 4,
    borderColor: '#d9a29d',
    borderRadius: 12,
  },
  saveButton: {
    marginTop: 22,
    borderRadius: 14,
    backgroundColor: '#6740b2',
  },
  saveButtonContent: {
    minHeight: 50,
  },
});
