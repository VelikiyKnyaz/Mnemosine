import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Alert,
  Image,
  Modal,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  Appbar,
  Button,
  FAB,
  IconButton,
  Searchbar,
  Surface,
  Text,
  TouchableRipple,
} from 'react-native-paper';
import { useIsFocused } from '@react-navigation/native';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../core/database';
import { supabase } from '../../core/supabase';
import { syncConnections } from '../../core/socialSync';
import { useAuthStore } from '../../core/store';
import PersonEditorModal, {
  PersonEditorValues,
} from './PersonEditorModal';
import RelationshipBoard from './RelationshipBoard';
import RelationshipManagerModal from './RelationshipManagerModal';
import {
  buildRelationshipSnapshot,
  getAvatarUri,
  getBirthLabel,
  getExplicitPartnerIds,
  getPartnerMetadata,
  matchesPersonSearch,
  normalizeBirthYear,
  parsePersonMetadata,
  PersonRecord,
  RelationshipKind,
  wouldCreateParentCycle,
} from './relationshipModel';

interface EditorState {
  personId: string | null;
  anchorId?: string;
  pendingKind?: RelationshipKind;
  suggestedRelationship?: string;
}

const RELATIONSHIP_SUGGESTIONS: Record<RelationshipKind, string> = {
  father: 'Padre',
  mother: 'Madre',
  partner: 'Pareja',
  sibling: 'Hermano/a',
  child_as_father: 'Hijo/a',
  child_as_mother: 'Hijo/a',
};

function nicknamesFrom(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((nickname) => nickname.trim())
    .filter(Boolean);
}

export default function FamilyTreeScreen({ navigation }: any) {
  const session = useAuthStore((state) => state.session);
  const myId = session?.user?.id as string | undefined;
  const isFocused = useIsFocused();

  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [directoryVisible, setDirectoryVisible] = useState(false);
  const [directoryQuery, setDirectoryQuery] = useState('');
  const [managerVisible, setManagerVisible] = useState(false);
  const [managerKind, setManagerKind] =
    useState<RelationshipKind>('father');
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [relationshipBusy, setRelationshipBusy] = useState(false);

  const ensureCurrentUser = useCallback(
    async (db: Awaited<ReturnType<typeof getDb>>) => {
      if (!myId) return;

      const existing = await db.getFirstAsync<{ id: string }>(
        "SELECT id FROM entities WHERE id = ? AND type = 'PERSON'",
        myId,
      );
      if (existing) return;

      const profile =
        (await db.getFirstAsync<any>(
          'SELECT * FROM user_profile WHERE id = ?',
          myId,
        )) ??
        (await db.getFirstAsync<any>('SELECT * FROM user_profile LIMIT 1'));
      const name = profile?.full_name || 'Yo';
      const metadata = {
        nickname: 'Yo',
        relationship: 'Yo',
        avatar_url: profile?.avatar_url || '',
        username: profile?.username || '',
        user_id: myId,
        is_linked: true,
        connection_status: 'ACCEPTED',
      };

      await db.runAsync(
        "INSERT INTO entities (id, type, name, metadata, is_confirmed, birth_date) VALUES (?, 'PERSON', ?, ?, 1, ?)",
        myId,
        name,
        JSON.stringify(metadata),
        profile?.birth_date || '',
      );
    },
    [myId],
  );

  const loadPeople = useCallback(async () => {
    try {
      const db = await getDb();
      await ensureCurrentUser(db);
      const rows = await db.getAllAsync<PersonRecord>(`
        SELECT
          e.id,
          e.name,
          e.metadata,
          e.father_id,
          e.mother_id,
          e.birth_date,
          COUNT(me.memory_id) AS mentions
        FROM entities e
        LEFT JOIN memory_entities me ON e.id = me.entity_id
        WHERE e.type = 'PERSON'
        GROUP BY e.id
        ORDER BY e.name COLLATE NOCASE
      `);
      const normalizedRows = rows.map((row) => ({
        ...row,
        mentions: Number(row.mentions || 0),
      }));

      setPeople(normalizedRows);
      setFocusedId((current) => {
        if (
          current &&
          normalizedRows.some((person) => person.id === current)
        ) {
          return current;
        }
        if (myId && normalizedRows.some((person) => person.id === myId)) {
          return myId;
        }
        return normalizedRows[0]?.id ?? null;
      });
    } catch (error) {
      console.error('[Relationship tree] Could not load people:', error);
      Alert.alert('No se pudo cargar el árbol relacional');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [ensureCurrentUser, myId]);

  const refresh = useCallback(
    async (syncRemote: boolean) => {
      setRefreshing(true);
      if (syncRemote && myId) {
        try {
          await syncConnections(myId);
        } catch (error) {
          console.warn('[Relationship tree] Remote sync failed:', error);
        }
      }
      await loadPeople();
    },
    [loadPeople, myId],
  );

  useEffect(() => {
    if (isFocused) {
      void refresh(true);
    }
  }, [isFocused, refresh]);

  useEffect(() => {
    if (!myId) return;

    const channel = supabase
      .channel(`relationship_tree_${myId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'connections' },
        () => {
          void refresh(true);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [myId, refresh]);

  const snapshot = useMemo(
    () => buildRelationshipSnapshot(people, focusedId),
    [focusedId, people],
  );

  const editorPerson = useMemo(
    () =>
      editorState?.personId
        ? people.find((person) => person.id === editorState.personId) ?? null
        : null,
    [editorState?.personId, people],
  );

  const filteredDirectory = useMemo(
    () =>
      people.filter((person) =>
        matchesPersonSearch(person, directoryQuery),
      ),
    [directoryQuery, people],
  );

  const showManager = (kind?: RelationshipKind) => {
    if (!snapshot) return;
    setManagerKind(kind ?? 'child_as_father');
    setManagerVisible(true);
  };

  const openCreateEditor = (
    pendingKind?: RelationshipKind,
    anchorId?: string,
  ) => {
    setEditorState({
      personId: null,
      anchorId,
      pendingKind,
      suggestedRelationship: pendingKind
        ? RELATIONSHIP_SUGGESTIONS[pendingKind]
        : '',
    });
  };

  const getPersonFromDb = async (
    id: string,
  ): Promise<PersonRecord | null> => {
    const db = await getDb();
    return db.getFirstAsync<PersonRecord>(
      `SELECT
        id, name, metadata, father_id, mother_id, birth_date, 0 AS mentions
       FROM entities
       WHERE id = ? AND type = 'PERSON'`,
      id,
    );
  };

  const linkPeople = async (
    kind: RelationshipKind,
    anchorId: string,
    targetId: string,
  ): Promise<boolean> => {
    if (anchorId === targetId) {
      Alert.alert(
        'Vínculo inválido',
        'Una persona no puede relacionarse consigo misma.',
      );
      return false;
    }

    const db = await getDb();
    const currentPeople = people;
    const anchor =
      currentPeople.find((person) => person.id === anchorId) ??
      (await getPersonFromDb(anchorId));
    const target =
      currentPeople.find((person) => person.id === targetId) ??
      (await getPersonFromDb(targetId));

    if (!anchor || !target) {
      Alert.alert('No se encontró una de las personas');
      return false;
    }

    if (kind === 'father' || kind === 'mother') {
      if (wouldCreateParentCycle(currentPeople, anchorId, targetId)) {
        Alert.alert(
          'Ciclo familiar inválido',
          `${target.name} aparece entre los descendientes de ${anchor.name} y no puede registrarse como progenitor.`,
        );
        return false;
      }

      const field = kind === 'father' ? 'father_id' : 'mother_id';
      const occupiedId =
        kind === 'father' ? anchor.father_id : anchor.mother_id;
      if (occupiedId && occupiedId !== targetId) {
        Alert.alert(
          'Lugar ya ocupado',
          `Quita primero el vínculo de ${
            kind === 'father' ? 'padre' : 'madre'
          } actual.`,
        );
        return false;
      }
      await db.runAsync(
        `UPDATE entities SET ${field} = ? WHERE id = ?`,
        targetId,
        anchorId,
      );
    } else if (kind === 'child_as_father' || kind === 'child_as_mother') {
      if (wouldCreateParentCycle(currentPeople, targetId, anchorId)) {
        Alert.alert(
          'Ciclo familiar inválido',
          `${anchor.name} aparece entre los descendientes de ${target.name} y no puede registrarse como progenitor.`,
        );
        return false;
      }

      const asFather = kind === 'child_as_father';
      const field = asFather ? 'father_id' : 'mother_id';
      const occupiedId = asFather ? target.father_id : target.mother_id;
      if (occupiedId && occupiedId !== anchorId) {
        Alert.alert(
          'Lugar ya ocupado',
          `${target.name} ya tiene ${
            asFather ? 'padre' : 'madre'
          } registrado. Quita primero ese vínculo.`,
        );
        return false;
      }
      await db.runAsync(
        `UPDATE entities SET ${field} = ? WHERE id = ?`,
        anchorId,
        targetId,
      );
    } else if (kind === 'sibling') {
      const sharedParents: Array<{
        field: 'father_id' | 'mother_id';
        id: string;
        occupiedId: string | null;
      }> = [];

      if (anchor.father_id) {
        sharedParents.push({
          field: 'father_id',
          id: anchor.father_id,
          occupiedId: target.father_id,
        });
      }
      if (anchor.mother_id) {
        sharedParents.push({
          field: 'mother_id',
          id: anchor.mother_id,
          occupiedId: target.mother_id,
        });
      }

      if (sharedParents.length === 0) {
        Alert.alert(
          'Faltan progenitores',
          `Registra primero al menos un progenitor de ${anchor.name}; ese vínculo permitirá definir la hermandad.`,
        );
        return false;
      }

      const availableParents = sharedParents.filter(
        ({ occupiedId, id }) => !occupiedId || occupiedId === id,
      );
      if (availableParents.length === 0) {
        Alert.alert(
          'No se puede compartir un progenitor',
          `${target.name} ya tiene otros progenitores ocupando esos lugares.`,
        );
        return false;
      }

      for (const parent of availableParents) {
        if (wouldCreateParentCycle(currentPeople, target.id, parent.id)) {
          Alert.alert(
            'Ciclo familiar inválido',
            'La relación de hermandad produciría un ciclo entre generaciones.',
          );
          return false;
        }
      }

      for (const parent of availableParents) {
        await db.runAsync(
          `UPDATE entities SET ${parent.field} = ? WHERE id = ?`,
          parent.id,
          target.id,
        );
      }
    } else {
      const anchorPartners = new Set(getExplicitPartnerIds(anchor));
      const targetPartners = new Set(getExplicitPartnerIds(target));
      anchorPartners.add(targetId);
      targetPartners.add(anchorId);

      await db.runAsync(
        'UPDATE entities SET metadata = ? WHERE id = ?',
        JSON.stringify(
          getPartnerMetadata(anchor, [...anchorPartners]),
        ),
        anchorId,
      );
      await db.runAsync(
        'UPDATE entities SET metadata = ? WHERE id = ?',
        JSON.stringify(
          getPartnerMetadata(target, [...targetPartners]),
        ),
        targetId,
      );
    }

    return true;
  };

  const handleLinkExisting = async (
    kind: RelationshipKind,
    target: PersonRecord,
  ) => {
    if (!snapshot) return;
    setRelationshipBusy(true);
    try {
      const linked = await linkPeople(kind, snapshot.focus.id, target.id);
      if (linked) {
        setManagerVisible(false);
        await loadPeople();
      }
    } catch (error) {
      console.error('[Relationship tree] Link failed:', error);
      Alert.alert('No se pudo crear el vínculo');
    } finally {
      setRelationshipBusy(false);
    }
  };

  const handleRemoveRelationship = async (
    kind: RelationshipKind,
    target: PersonRecord,
  ) => {
    if (!snapshot) return;
    setRelationshipBusy(true);

    try {
      const db = await getDb();
      const anchor = snapshot.focus;

      if (kind === 'father') {
        await db.runAsync(
          'UPDATE entities SET father_id = NULL WHERE id = ? AND father_id = ?',
          anchor.id,
          target.id,
        );
      } else if (kind === 'mother') {
        await db.runAsync(
          'UPDATE entities SET mother_id = NULL WHERE id = ? AND mother_id = ?',
          anchor.id,
          target.id,
        );
      } else if (
        kind === 'child_as_father' ||
        kind === 'child_as_mother'
      ) {
        const field =
          kind === 'child_as_father' ? 'father_id' : 'mother_id';
        await db.runAsync(
          `UPDATE entities SET ${field} = NULL WHERE id = ? AND ${field} = ?`,
          target.id,
          anchor.id,
        );
      } else if (kind === 'partner') {
        const anchorExplicit = getExplicitPartnerIds(anchor);
        const targetExplicit = getExplicitPartnerIds(target);
        await db.runAsync(
          'UPDATE entities SET metadata = ? WHERE id = ?',
          JSON.stringify(
            getPartnerMetadata(
              anchor,
              anchorExplicit.filter((id) => id !== target.id),
            ),
          ),
          anchor.id,
        );
        await db.runAsync(
          'UPDATE entities SET metadata = ? WHERE id = ?',
          JSON.stringify(
            getPartnerMetadata(
              target,
              targetExplicit.filter((id) => id !== anchor.id),
            ),
          ),
          target.id,
        );
      }

      await loadPeople();
    } catch (error) {
      console.error('[Relationship tree] Unlink failed:', error);
      Alert.alert('No se pudo quitar el vínculo');
    } finally {
      setRelationshipBusy(false);
    }
  };

  const syncAliases = async (
    personId: string,
    previousValue: unknown,
    nextValue: string,
  ) => {
    const db = await getDb();
    const previous = nicknamesFrom(previousValue);
    const next = nicknamesFrom(nextValue);

    for (const nickname of previous) {
      if (
        !next.some(
          (candidate) =>
            candidate.toLocaleLowerCase('es') ===
            nickname.toLocaleLowerCase('es'),
        )
      ) {
        await db.runAsync(
          'DELETE FROM entity_aliases WHERE entity_id = ? AND alias = ? COLLATE NOCASE',
          personId,
          nickname,
        );
      }
    }

    for (const nickname of next) {
      if (
        !previous.some(
          (candidate) =>
            candidate.toLocaleLowerCase('es') ===
            nickname.toLocaleLowerCase('es'),
        )
      ) {
        try {
          await db.runAsync(
            'INSERT INTO entity_aliases (id, alias, entity_id) VALUES (?, ?, ?)',
            uuidv4(),
            nickname,
            personId,
          );
        } catch {
          // The alias can already belong to this person.
        }
      }
    }
  };

  const handleSavePerson = async (values: PersonEditorValues) => {
    if (!editorState) return;
    if (!values.name.trim()) {
      Alert.alert('Falta el nombre', 'Escribe un nombre para continuar.');
      return;
    }

    const birthYear = normalizeBirthYear(values.birthYear);
    if (birthYear === null) {
      Alert.alert(
        'Año inválido',
        'Usa un año de cuatro cifras o elige una década aproximada.',
      );
      return;
    }

    setSaving(true);
    try {
      const db = await getDb();
      const previousMetadata = parsePersonMetadata(editorPerson?.metadata);
      let finalName = values.name.trim();
      let finalAvatar = values.avatarUrl;
      let finalUsername = values.username.trim().toLowerCase();
      let targetUserId =
        typeof previousMetadata.user_id === 'string'
          ? previousMetadata.user_id
          : null;
      let connectionStatus =
        typeof previousMetadata.connection_status === 'string'
          ? previousMetadata.connection_status
          : null;
      let isLinked = Boolean(previousMetadata.is_linked);

      if (finalUsername && !isLinked) {
        const { data: targetProfile, error } = await supabase
          .from('profiles')
          .select('id, username, full_name, avatar_url')
          .eq('username', finalUsername)
          .maybeSingle();

        if (error || !targetProfile) {
          Alert.alert(
            'Usuario no encontrado',
            'No existe una cuenta con ese nombre de usuario.',
          );
          return;
        }

        targetUserId = targetProfile.id;
        finalName = targetProfile.full_name || finalName;
        finalAvatar = targetProfile.avatar_url || finalAvatar;
        finalUsername = targetProfile.username || finalUsername;
        connectionStatus = 'PENDING_SENT';

        if (myId && targetUserId !== myId) {
          const { data: connection } = await supabase
            .from('connections')
            .select('id')
            .or(
              `and(sender_id.eq.${myId},receiver_id.eq.${targetUserId}),and(sender_id.eq.${targetUserId},receiver_id.eq.${myId})`,
            )
            .maybeSingle();

          if (!connection) {
            await supabase.from('connections').insert({
              sender_id: myId,
              receiver_id: targetUserId,
              status: 'PENDING',
            });
          }
        }
      }

      const personId = editorPerson?.id ?? uuidv4();
      const metadata = {
        ...previousMetadata,
        nickname: values.nickname.trim(),
        relationship: values.relationship.trim(),
        avatar_url: finalAvatar,
        username: finalUsername,
        user_id: targetUserId,
        is_linked: isLinked,
        connection_status: isLinked ? 'ACCEPTED' : connectionStatus,
        birth_decade: birthYear ? '' : values.birthDecade,
      };

      if (editorPerson) {
        await db.runAsync(
          'UPDATE entities SET name = ?, metadata = ?, birth_date = ? WHERE id = ?',
          finalName,
          JSON.stringify(metadata),
          birthYear,
          personId,
        );
      } else {
        await db.runAsync(
          "INSERT INTO entities (id, type, name, metadata, birth_date, is_confirmed) VALUES (?, 'PERSON', ?, ?, ?, 1)",
          personId,
          finalName,
          JSON.stringify(metadata),
          birthYear,
        );
      }

      await syncAliases(
        personId,
        previousMetadata.nickname,
        values.nickname,
      );

      if (
        !editorPerson &&
        editorState.pendingKind &&
        editorState.anchorId
      ) {
        await linkPeople(
          editorState.pendingKind,
          editorState.anchorId,
          personId,
        );
      }

      setEditorState(null);
      await loadPeople();
      if (!focusedId) setFocusedId(personId);
    } catch (error) {
      console.error('[Relationship tree] Save failed:', error);
      Alert.alert('No se pudo guardar la persona');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePerson = () => {
    if (!editorPerson || editorPerson.id === myId) return;

    Alert.alert(
      'Eliminar persona',
      `Se eliminará a ${editorPerson.name} del árbol. Sus recuerdos no se borrarán, pero dejarán de estar asociados a esta persona.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              const metadata = parsePersonMetadata(editorPerson.metadata);
              const remoteUserId =
                typeof metadata.user_id === 'string'
                  ? metadata.user_id
                  : null;
              if (remoteUserId && myId) {
                await supabase
                  .from('connections')
                  .delete()
                  .or(
                    `and(sender_id.eq.${myId},receiver_id.eq.${remoteUserId}),and(sender_id.eq.${remoteUserId},receiver_id.eq.${myId})`,
                  );
              }

              const db = await getDb();
              for (const person of people) {
                if (getExplicitPartnerIds(person).includes(editorPerson.id)) {
                  const updated = getPartnerMetadata(
                    person,
                    getExplicitPartnerIds(person).filter(
                      (id) => id !== editorPerson.id,
                    ),
                  );
                  await db.runAsync(
                    'UPDATE entities SET metadata = ? WHERE id = ?',
                    JSON.stringify(updated),
                    person.id,
                  );
                }
              }
              await db.runAsync(
                'DELETE FROM entity_aliases WHERE entity_id = ?',
                editorPerson.id,
              );
              await db.runAsync(
                'DELETE FROM memory_entities WHERE entity_id = ?',
                editorPerson.id,
              );
              await db.runAsync(
                'UPDATE entities SET father_id = NULL WHERE father_id = ?',
                editorPerson.id,
              );
              await db.runAsync(
                'UPDATE entities SET mother_id = NULL WHERE mother_id = ?',
                editorPerson.id,
              );
              await db.runAsync(
                'DELETE FROM entities WHERE id = ?',
                editorPerson.id,
              );

              setEditorState(null);
              if (focusedId === editorPerson.id) {
                setFocusedId(myId ?? null);
              }
              await loadPeople();
            } catch (error) {
              console.error('[Relationship tree] Delete failed:', error);
              Alert.alert('No se pudo eliminar la persona');
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  const handleUnlinkAccount = () => {
    if (!editorPerson) return;
    Alert.alert(
      'Desvincular cuenta',
      'La persona y sus relaciones permanecerán en el árbol, pero dejarán de sincronizarse con esa cuenta.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desvincular',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              const metadata = parsePersonMetadata(editorPerson.metadata);
              const remoteUserId =
                typeof metadata.user_id === 'string'
                  ? metadata.user_id
                  : null;
              if (remoteUserId && myId) {
                await supabase
                  .from('connections')
                  .delete()
                  .or(
                    `and(sender_id.eq.${myId},receiver_id.eq.${remoteUserId}),and(sender_id.eq.${remoteUserId},receiver_id.eq.${myId})`,
                  );
              }

              const nextMetadata = {
                ...metadata,
                user_id: null,
                username: '',
                is_linked: false,
                connection_status: null,
              };
              const db = await getDb();
              await db.runAsync(
                'UPDATE entities SET metadata = ? WHERE id = ?',
                JSON.stringify(nextMetadata),
                editorPerson.id,
              );
              setEditorState(null);
              await loadPeople();
            } catch (error) {
              console.error('[Relationship tree] Account unlink failed:', error);
              Alert.alert('No se pudo desvincular la cuenta');
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  const handleCreateFromManager = (kind: RelationshipKind) => {
    if (!snapshot) return;
    setManagerVisible(false);
    openCreateEditor(kind, snapshot.focus.id);
  };

  const focusPerson = (personId: string) => {
    setFocusedId(personId);
    setDirectoryVisible(false);
  };

  const focusedMetadata = snapshot
    ? parsePersonMetadata(snapshot.focus.metadata)
    : {};
  const connectionLabel =
    focusedMetadata.connection_status === 'PENDING_SENT'
      ? 'Solicitud pendiente'
      : focusedMetadata.is_linked
        ? 'Cuenta conectada'
        : null;

  return (
    <View style={styles.container}>
      <Appbar.Header style={styles.appbar}>
        <Appbar.Action
          icon="account-search-outline"
          color="#6037a7"
          onPress={() => setDirectoryVisible(true)}
          accessibilityLabel="Abrir directorio de personas"
        />
        <Appbar.Content
          title="Árbol relacional"
          subtitle={`${people.length} ${
            people.length === 1 ? 'persona' : 'personas'
          } en tu red`}
          titleStyle={styles.headerTitle}
        />
        <Appbar.Action
          icon="refresh"
          color="#6037a7"
          disabled={refreshing}
          onPress={() => void refresh(true)}
          accessibilityLabel="Sincronizar árbol"
        />
      </Appbar.Header>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh(true)}
            tintColor="#6840b2"
          />
        }
      >
        {snapshot ? (
          <>
            <Surface mode="flat" style={styles.focusSummary}>
              <Image
                source={{ uri: getAvatarUri(snapshot.focus) }}
                style={styles.focusAvatar}
              />
              <View style={styles.focusInfo}>
                <Text style={styles.focusEyebrow}>Explorando desde</Text>
                <Text style={styles.focusName} numberOfLines={2}>
                  {snapshot.focus.name}
                </Text>
                <Text style={styles.focusMeta}>
                  {getBirthLabel(snapshot.focus)}
                  {'  ·  '}
                  {snapshot.focus.mentions}{' '}
                  {snapshot.focus.mentions === 1
                    ? 'recuerdo'
                    : 'recuerdos'}
                </Text>
                {connectionLabel ? (
                  <Text style={styles.connectionLabel}>
                    {connectionLabel}
                  </Text>
                ) : null}
              </View>
              <View style={styles.focusActions}>
                <IconButton
                  icon="pencil-outline"
                  mode="contained-tonal"
                  iconColor="#6037a7"
                  containerColor="#eee6ff"
                  onPress={() =>
                    setEditorState({ personId: snapshot.focus.id })
                  }
                  accessibilityLabel="Editar persona"
                />
                <IconButton
                  icon="book-open-variant"
                  mode="contained-tonal"
                  iconColor="#6037a7"
                  containerColor="#eee6ff"
                  onPress={() =>
                    navigation.navigate('EntityMemories', {
                      entityId: snapshot.focus.id,
                    })
                  }
                  accessibilityLabel="Ver recuerdos"
                />
              </View>
              <Button
                mode="contained"
                icon="link-variant-plus"
                textColor="#ffffff"
                onPress={() => showManager()}
                style={styles.manageButton}
                contentStyle={styles.manageButtonContent}
              >
                Gestionar vínculos
              </Button>
            </Surface>

            <RelationshipBoard
              snapshot={snapshot}
              onFocusPerson={focusPerson}
              onAddRelation={showManager}
            />
          </>
        ) : (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconCircle}>
              <IconButton
                icon="family-tree"
                size={40}
                iconColor="#6840b2"
                style={styles.emptyIcon}
              />
            </View>
            <Text style={styles.emptyTitle}>
              Tu árbol relacional empieza aquí
            </Text>
            <Text style={styles.emptyDescription}>
              Añade la primera persona y luego conecta progenitores, parejas y
              descendientes de forma ordenada.
            </Text>
            <Button
              mode="contained"
              icon="account-plus-outline"
              textColor="#ffffff"
              onPress={() => openCreateEditor()}
              style={styles.emptyButton}
            >
              Añadir primera persona
            </Button>
          </View>
        )}
      </ScrollView>

      {snapshot ? (
        <FAB
          icon="account-plus-outline"
          label="Persona"
          color="#ffffff"
          style={styles.fab}
          onPress={() => openCreateEditor()}
        />
      ) : null}

      <DirectoryModal
        visible={directoryVisible}
        people={filteredDirectory}
        focusedId={focusedId}
        query={directoryQuery}
        onQueryChange={setDirectoryQuery}
        onDismiss={() => setDirectoryVisible(false)}
        onSelect={focusPerson}
        onCreate={() => {
          setDirectoryVisible(false);
          openCreateEditor();
        }}
      />

      <RelationshipManagerModal
        visible={managerVisible}
        snapshot={snapshot}
        people={people}
        initialKind={managerKind}
        busy={relationshipBusy}
        onDismiss={() => setManagerVisible(false)}
        onLink={handleLinkExisting}
        onCreate={handleCreateFromManager}
        onRemove={handleRemoveRelationship}
      />

      <PersonEditorModal
        visible={Boolean(editorState)}
        person={editorPerson}
        suggestedRelationship={editorState?.suggestedRelationship}
        saving={saving}
        isCurrentUser={Boolean(editorPerson && editorPerson.id === myId)}
        onDismiss={() => setEditorState(null)}
        onSave={handleSavePerson}
        onDelete={editorPerson ? handleDeletePerson : undefined}
        onUnlink={editorPerson ? handleUnlinkAccount : undefined}
      />

      {loading && people.length === 0 ? (
        <View pointerEvents="none" style={styles.loadingOverlay}>
          <Text style={styles.loadingText}>Organizando relaciones…</Text>
        </View>
      ) : null}
    </View>
  );
}

interface DirectoryModalProps {
  visible: boolean;
  people: PersonRecord[];
  focusedId: string | null;
  query: string;
  onQueryChange: (value: string) => void;
  onDismiss: () => void;
  onSelect: (personId: string) => void;
  onCreate: () => void;
}

function DirectoryModal({
  visible,
  people,
  focusedId,
  query,
  onQueryChange,
  onDismiss,
  onSelect,
  onCreate,
}: DirectoryModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onDismiss}
    >
      <SafeAreaView style={styles.directorySafeArea}>
        <Appbar.Header style={styles.directoryHeader}>
          <Appbar.Action icon="close" onPress={onDismiss} />
          <Appbar.Content
            title="Directorio"
            subtitle="Elige una persona para centrar sus relaciones"
            titleStyle={styles.headerTitle}
          />
          <Appbar.Action icon="account-plus-outline" onPress={onCreate} />
        </Appbar.Header>
        <View style={styles.directoryContent}>
          <Searchbar
            placeholder="Buscar por nombre, apodo o relación"
            value={query}
            onChangeText={onQueryChange}
            style={styles.directorySearch}
          />
          <ScrollView
            contentContainerStyle={styles.directoryList}
            keyboardShouldPersistTaps="handled"
          >
            {people.map((person) => {
              const metadata = parsePersonMetadata(person.metadata);
              const subtitle =
                (typeof metadata.nickname === 'string' &&
                  metadata.nickname) ||
                (typeof metadata.relationship === 'string' &&
                  metadata.relationship) ||
                getBirthLabel(person);

              return (
                <Surface
                  key={person.id}
                  mode="flat"
                  style={[
                    styles.directoryPerson,
                    person.id === focusedId &&
                      styles.directoryPersonFocused,
                  ]}
                >
                  <TouchableRipple
                    onPress={() => onSelect(person.id)}
                    accessibilityRole="button"
                  >
                    <View style={styles.directoryRow}>
                      <Image
                        source={{ uri: getAvatarUri(person) }}
                        style={styles.directoryAvatar}
                      />
                      <View style={styles.directoryText}>
                        <Text style={styles.directoryName}>
                          {person.name}
                        </Text>
                        <Text style={styles.directorySubtitle}>
                          {subtitle}
                        </Text>
                      </View>
                      {person.id === focusedId ? (
                        <IconButton
                          icon="target"
                          iconColor="#6840b2"
                          size={20}
                        />
                      ) : (
                        <IconButton
                          icon="chevron-right"
                          iconColor="#746d79"
                          size={20}
                        />
                      )}
                    </View>
                  </TouchableRipple>
                </Surface>
              );
            })}
            {people.length === 0 ? (
              <Text style={styles.directoryEmpty}>
                No hay personas que coincidan con la búsqueda.
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f6f2f8',
  },
  appbar: {
    backgroundColor: '#ffffff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e7e0e9',
  },
  headerTitle: {
    color: '#2c2730',
    fontWeight: '800',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 980,
    alignSelf: 'center',
    paddingTop: 16,
  },
  focusSummary: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#dfd5e6',
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  focusAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#ece6ef',
  },
  focusInfo: {
    flex: 1,
    minWidth: 150,
    paddingHorizontal: 14,
  },
  focusEyebrow: {
    color: '#7650ad',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  focusName: {
    marginTop: 2,
    color: '#2b2630',
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 24,
  },
  focusMeta: {
    marginTop: 4,
    color: '#716a76',
    fontSize: 12,
  },
  connectionLabel: {
    marginTop: 4,
    color: '#4f7d4a',
    fontSize: 11,
    fontWeight: '700',
  },
  focusActions: {
    flexDirection: 'row',
  },
  manageButton: {
    width: '100%',
    marginTop: 14,
    borderRadius: 13,
    backgroundColor: '#6740b2',
  },
  manageButtonContent: {
    minHeight: 46,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 34,
    paddingBottom: 60,
  },
  emptyIconCircle: {
    width: 92,
    height: 92,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 46,
    backgroundColor: '#ebe1f7',
  },
  emptyIcon: {
    margin: 0,
  },
  emptyTitle: {
    marginTop: 22,
    color: '#2d2831',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyDescription: {
    maxWidth: 420,
    marginTop: 9,
    color: '#706976',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  emptyButton: {
    marginTop: 22,
    borderRadius: 13,
    backgroundColor: '#6740b2',
  },
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 18,
    backgroundColor: '#6740b2',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(250, 248, 252, 0.86)',
  },
  loadingText: {
    color: '#6740b2',
    fontSize: 14,
    fontWeight: '700',
  },
  directorySafeArea: {
    flex: 1,
    backgroundColor: '#f8f5fa',
  },
  directoryHeader: {
    backgroundColor: '#ffffff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e7e0e9',
  },
  directoryContent: {
    flex: 1,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    padding: 16,
  },
  directorySearch: {
    marginBottom: 14,
    borderRadius: 16,
    backgroundColor: '#ffffff',
  },
  directoryList: {
    paddingBottom: 36,
  },
  directoryPerson: {
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e7e0ea',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  directoryPersonFocused: {
    borderColor: '#9271c5',
    backgroundColor: '#faf7ff',
  },
  directoryRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 2,
  },
  directoryAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#ece6ef',
  },
  directoryText: {
    flex: 1,
    paddingHorizontal: 12,
  },
  directoryName: {
    color: '#302b34',
    fontSize: 15,
    fontWeight: '700',
  },
  directorySubtitle: {
    marginTop: 3,
    color: '#766f7a',
    fontSize: 12,
  },
  directoryEmpty: {
    paddingVertical: 40,
    color: '#736c78',
    fontSize: 14,
    textAlign: 'center',
  },
});
