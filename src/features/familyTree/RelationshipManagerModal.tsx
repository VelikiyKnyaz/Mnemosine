import React, { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  Appbar,
  Button,
  Chip,
  Divider,
  IconButton,
  Searchbar,
  Surface,
  Text,
  TouchableRipple,
} from 'react-native-paper';
import {
  getAvatarUri,
  isExplicitPartnerPair,
  matchesPersonSearch,
  PersonRecord,
  RelationshipKind,
  RelationshipSnapshot,
} from './relationshipModel';

const RELATIONSHIP_OPTIONS: Array<{
  kind: RelationshipKind;
  label: string;
  description: string;
}> = [
  {
    kind: 'father',
    label: 'Padre',
    description: 'Esta persona será el padre del foco.',
  },
  {
    kind: 'mother',
    label: 'Madre',
    description: 'Esta persona será la madre del foco.',
  },
  {
    kind: 'partner',
    label: 'Pareja',
    description: 'Se crea un vínculo recíproco de pareja.',
  },
  {
    kind: 'sibling',
    label: 'Hermano/a',
    description:
      'Compartirá los progenitores ya registrados de la persona central.',
  },
  {
    kind: 'child_as_father',
    label: 'Hijo/a · como padre',
    description: 'El foco ocupará el campo padre del descendiente.',
  },
  {
    kind: 'child_as_mother',
    label: 'Hijo/a · como madre',
    description: 'El foco ocupará el campo madre del descendiente.',
  },
];

interface RelationshipManagerModalProps {
  visible: boolean;
  snapshot: RelationshipSnapshot | null;
  people: PersonRecord[];
  initialKind?: RelationshipKind;
  busy: boolean;
  onDismiss: () => void;
  onLink: (kind: RelationshipKind, target: PersonRecord) => Promise<void>;
  onCreate: (kind: RelationshipKind) => void;
  onRemove: (
    kind: RelationshipKind,
    target: PersonRecord,
  ) => Promise<void>;
}

interface CurrentRelation {
  key: string;
  kind: RelationshipKind;
  label: string;
  person: PersonRecord;
  removable: boolean;
}

export default function RelationshipManagerModal({
  visible,
  snapshot,
  people,
  initialKind = 'father',
  busy,
  onDismiss,
  onLink,
  onCreate,
  onRemove,
}: RelationshipManagerModalProps) {
  const [selectedKind, setSelectedKind] =
    useState<RelationshipKind>(initialKind);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!visible) return;
    setSelectedKind(initialKind);
    setQuery('');
  }, [initialKind, visible]);

  const candidates = useMemo(() => {
    if (!snapshot) return [];
    return people
      .filter((person) => person.id !== snapshot.focus.id)
      .filter((person) => matchesPersonSearch(person, query))
      .sort((a, b) =>
        a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }),
      );
  }, [people, query, snapshot]);

  const currentRelations = useMemo<CurrentRelation[]>(() => {
    if (!snapshot) return [];
    const relations: CurrentRelation[] = [];

    if (snapshot.father) {
      relations.push({
        key: `father-${snapshot.father.id}`,
        kind: 'father',
        label: 'Padre',
        person: snapshot.father,
        removable: true,
      });
    }
    if (snapshot.mother) {
      relations.push({
        key: `mother-${snapshot.mother.id}`,
        kind: 'mother',
        label: 'Madre',
        person: snapshot.mother,
        removable: true,
      });
    }
    snapshot.partners.forEach((person) => {
      const isExplicit = isExplicitPartnerPair(snapshot.focus, person);
      relations.push({
        key: `partner-${person.id}`,
        kind: 'partner',
        label: isExplicit ? 'Pareja' : 'Coparental por descendencia',
        person,
        removable: isExplicit,
      });
    });
    snapshot.children.forEach((person) => {
      const kind =
        person.father_id === snapshot.focus.id
          ? 'child_as_father'
          : 'child_as_mother';
      relations.push({
        key: `child-${person.id}`,
        kind,
        label: 'Hijo/a',
        person,
        removable: true,
      });
    });
    return relations;
  }, [snapshot]);

  const selectedOption =
    RELATIONSHIP_OPTIONS.find((option) => option.kind === selectedKind) ??
    RELATIONSHIP_OPTIONS[0];

  if (!snapshot) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onDismiss}
    >
      <SafeAreaView style={styles.safeArea}>
        <Appbar.Header style={styles.header}>
          <Appbar.Action icon="close" disabled={busy} onPress={onDismiss} />
          <Appbar.Content
            title="Gestionar vínculos"
            subtitle={snapshot.focus.name}
            titleStyle={styles.headerTitle}
          />
        </Appbar.Header>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.eyebrow}>Relaciones actuales</Text>
          <Text style={styles.title}>Mapa directo</Text>
          <Text style={styles.description}>
            Quitar un vínculo no elimina a la persona ni sus recuerdos.
          </Text>

          <Surface mode="flat" style={styles.currentCard}>
            {currentRelations.length > 0 ? (
              currentRelations.map((relation, index) => (
                <React.Fragment key={relation.key}>
                  {index > 0 ? <Divider /> : null}
                  <View style={styles.currentRow}>
                    <Image
                      source={{ uri: getAvatarUri(relation.person) }}
                      style={styles.smallAvatar}
                    />
                    <View style={styles.currentText}>
                      <Text style={styles.currentName}>
                        {relation.person.name}
                      </Text>
                      <Text style={styles.currentLabel}>{relation.label}</Text>
                    </View>
                    <IconButton
                      icon={
                        relation.removable
                          ? 'link-off'
                          : 'information-outline'
                      }
                      iconColor={
                        relation.removable ? '#a23b35' : '#766f7b'
                      }
                      disabled={busy || !relation.removable}
                      onPress={() =>
                        onRemove(relation.kind, relation.person)
                      }
                      accessibilityLabel={
                        relation.removable
                          ? `Quitar vínculo con ${relation.person.name}`
                          : 'Este vínculo procede de un descendiente compartido'
                      }
                    />
                  </View>
                </React.Fragment>
              ))
            ) : (
              <View style={styles.noRelations}>
                <Text style={styles.noRelationsText}>
                  Todavía no hay vínculos familiares directos.
                </Text>
              </View>
            )}
          </Surface>

          <Divider style={styles.sectionDivider} />
          <Text style={styles.eyebrow}>Nuevo vínculo</Text>
          <Text style={styles.title}>¿Cómo se relacionan?</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.optionChips}
          >
            {RELATIONSHIP_OPTIONS.map((option) => (
              <Chip
                key={option.kind}
                selected={selectedKind === option.kind}
                onPress={() => setSelectedKind(option.kind)}
                disabled={busy}
                style={styles.optionChip}
              >
                {option.label}
              </Chip>
            ))}
          </ScrollView>
          <Text style={styles.optionDescription}>
            {selectedOption.description}
          </Text>

          <Searchbar
            placeholder="Buscar una persona existente"
            value={query}
            onChangeText={setQuery}
            style={styles.search}
            inputStyle={styles.searchInput}
          />

          <Button
            mode="contained-tonal"
            icon="account-plus-outline"
            disabled={busy}
            onPress={() => onCreate(selectedKind)}
            style={styles.createButton}
            contentStyle={styles.createButtonContent}
          >
            Crear una persona para este vínculo
          </Button>

          <Text style={styles.listLabel}>O elige alguien de tu red</Text>
          <Surface mode="flat" style={styles.peopleCard}>
            {candidates.length > 0 ? (
              candidates.map((person, index) => (
                <React.Fragment key={person.id}>
                  {index > 0 ? <Divider /> : null}
                  <TouchableRipple
                    onPress={() => onLink(selectedKind, person)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={`Vincular a ${person.name}`}
                  >
                    <View style={styles.personRow}>
                      <Image
                        source={{ uri: getAvatarUri(person) }}
                        style={styles.avatar}
                      />
                      <Text style={styles.personName} numberOfLines={1}>
                        {person.name}
                      </Text>
                      <IconButton
                        icon="chevron-right"
                        size={20}
                        iconColor="#776d7c"
                        style={styles.chevron}
                      />
                    </View>
                  </TouchableRipple>
                </React.Fragment>
              ))
            ) : (
              <View style={styles.noRelations}>
                <Text style={styles.noRelationsText}>
                  No hay coincidencias. Puedes crear una persona nueva.
                </Text>
              </View>
            )}
          </Surface>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    maxWidth: 720,
    alignSelf: 'center',
    padding: 20,
    paddingBottom: 48,
  },
  eyebrow: {
    color: '#7451a4',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  title: {
    marginTop: 3,
    color: '#2d2831',
    fontSize: 21,
    fontWeight: '800',
  },
  description: {
    marginTop: 4,
    marginBottom: 13,
    color: '#736c77',
    fontSize: 13,
    lineHeight: 19,
  },
  currentCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e5dee9',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  currentRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    paddingRight: 4,
  },
  smallAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ece7ef',
  },
  currentText: {
    flex: 1,
    paddingHorizontal: 12,
  },
  currentName: {
    color: '#332e36',
    fontSize: 14,
    fontWeight: '700',
  },
  currentLabel: {
    marginTop: 2,
    color: '#786f7e',
    fontSize: 11,
  },
  noRelations: {
    paddingHorizontal: 18,
    paddingVertical: 24,
  },
  noRelationsText: {
    color: '#77707c',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  sectionDivider: {
    marginVertical: 26,
    backgroundColor: '#ded7e2',
  },
  optionChips: {
    paddingTop: 13,
    paddingRight: 12,
  },
  optionChip: {
    marginRight: 8,
  },
  optionDescription: {
    minHeight: 38,
    marginTop: 10,
    color: '#716a76',
    fontSize: 12,
    lineHeight: 18,
  },
  search: {
    marginTop: 8,
    borderRadius: 16,
    backgroundColor: '#ffffff',
  },
  searchInput: {
    minHeight: 0,
  },
  createButton: {
    marginTop: 14,
    borderRadius: 13,
  },
  createButtonContent: {
    minHeight: 46,
  },
  listLabel: {
    marginTop: 22,
    marginBottom: 9,
    color: '#625b66',
    fontSize: 12,
    fontWeight: '700',
  },
  peopleCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e5dee9',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  personRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    paddingRight: 2,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#ece7ef',
  },
  personName: {
    flex: 1,
    paddingHorizontal: 12,
    color: '#332e36',
    fontSize: 14,
    fontWeight: '700',
  },
  chevron: {
    margin: 0,
  },
});
