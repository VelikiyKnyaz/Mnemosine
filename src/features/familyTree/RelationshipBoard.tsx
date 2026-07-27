import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { IconButton, Surface, Text, TouchableRipple } from 'react-native-paper';
import PersonNodeCard from './PersonNodeCard';
import {
  PersonRecord,
  RelationshipKind,
  RelationshipSnapshot,
  isExplicitPartnerPair,
} from './relationshipModel';

interface RelationshipBoardProps {
  snapshot: RelationshipSnapshot;
  onFocusPerson: (personId: string) => void;
  onAddRelation: (kind?: RelationshipKind) => void;
}

interface RelationSectionProps {
  eyebrow: string;
  title: string;
  description: string;
  people: Array<{ person: PersonRecord; roleLabel?: string }>;
  emptyLabel: string;
  onPersonPress: (personId: string) => void;
  onAdd: () => void;
}

function EmptyRelationCard({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableRipple
      onPress={onPress}
      style={styles.emptyCard}
      borderless
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.emptyCardContent}>
        <IconButton
          icon="plus"
          size={20}
          iconColor="#6d3fc0"
          style={styles.emptyIcon}
        />
        <Text style={styles.emptyText}>{label}</Text>
      </View>
    </TouchableRipple>
  );
}

function RelationSection({
  eyebrow,
  title,
  description,
  people,
  emptyLabel,
  onPersonPress,
  onAdd,
}: RelationSectionProps) {
  return (
    <Surface mode="flat" style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleWrap}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionDescription}>{description}</Text>
        </View>
        <IconButton
          icon="plus"
          mode="contained-tonal"
          size={19}
          iconColor="#6037a7"
          containerColor="#eee6ff"
          onPress={onAdd}
          accessibilityLabel={`Añadir en ${title}`}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.cardRow}
      >
        {people.length > 0 ? (
          people.map(({ person, roleLabel }) => (
            <PersonNodeCard
              key={person.id}
              person={person}
              roleLabel={roleLabel}
              onPress={() => onPersonPress(person.id)}
            />
          ))
        ) : (
          <EmptyRelationCard label={emptyLabel} onPress={onAdd} />
        )}
      </ScrollView>
    </Surface>
  );
}

function Connector({ label }: { label: string }) {
  return (
    <View style={styles.connector} accessibilityElementsHidden>
      <View style={styles.connectorLine} />
      <View style={styles.connectorPill}>
        <Text style={styles.connectorLabel}>{label}</Text>
      </View>
      <View style={styles.connectorLine} />
    </View>
  );
}

export default function RelationshipBoard({
  snapshot,
  onFocusPerson,
  onAddRelation,
}: RelationshipBoardProps) {
  const parents = [
    snapshot.father
      ? { person: snapshot.father, roleLabel: 'Padre' }
      : null,
    snapshot.mother
      ? { person: snapshot.mother, roleLabel: 'Madre' }
      : null,
  ].filter(
    (
      entry,
    ): entry is {
      person: PersonRecord;
      roleLabel: string;
    } => Boolean(entry),
  );

  return (
    <View style={styles.board}>
      <RelationSection
        eyebrow="Generación anterior"
        title="Progenitores"
        description="Padre y madre registrados para la persona central."
        people={parents}
        emptyLabel="Añadir progenitor"
        onPersonPress={onFocusPerson}
        onAdd={() => onAddRelation(snapshot.father ? 'mother' : 'father')}
      />

      <Connector label="origen" />

      <Surface mode="flat" style={[styles.section, styles.focusSection]}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleWrap}>
            <Text style={styles.eyebrow}>Persona central</Text>
            <Text style={styles.sectionTitle}>Núcleo relacional</Text>
            <Text style={styles.sectionDescription}>
              Cambia el foco tocando cualquier tarjeta.
            </Text>
          </View>
          <IconButton
            icon="account-multiple-plus-outline"
            mode="contained-tonal"
            size={19}
            iconColor="#6037a7"
            containerColor="#eee6ff"
            onPress={() => onAddRelation('partner')}
            accessibilityLabel="Añadir pareja"
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.focusRow}
        >
          <PersonNodeCard
            person={snapshot.focus}
            roleLabel="Foco"
            selected
            onPress={() => onFocusPerson(snapshot.focus.id)}
          />
          {snapshot.partners.map((partner) => (
            <View key={partner.id} style={styles.partnerItem}>
              <View style={styles.partnerLink}>
                <View style={styles.partnerLine} />
                <Text style={styles.partnerSymbol}>∞</Text>
              </View>
              <PersonNodeCard
                person={partner}
                roleLabel={
                  isExplicitPartnerPair(snapshot.focus, partner)
                    ? 'Pareja'
                    : 'Coparental'
                }
                onPress={() => onFocusPerson(partner.id)}
              />
            </View>
          ))}
          {snapshot.partners.length === 0 ? (
            <View style={styles.partnerItem}>
              <View style={styles.partnerLink}>
                <View style={styles.partnerLine} />
              </View>
              <EmptyRelationCard
                label="Añadir pareja"
                onPress={() => onAddRelation('partner')}
              />
            </View>
          ) : null}
        </ScrollView>
      </Surface>

      <Connector label="descendencia" />

      <RelationSection
        eyebrow="Generación siguiente"
        title="Hijos e hijas"
        description="Descendientes directos de la persona central."
        people={snapshot.children.map((person) => ({ person }))}
        emptyLabel="Añadir descendiente"
        onPersonPress={onFocusPerson}
        onAdd={() => onAddRelation()}
      />

      <RelationSection
        eyebrow="Misma generación"
        title="Hermanos y hermanas"
        description="Personas con al menos un progenitor compartido."
        people={snapshot.siblings.map((person) => ({ person }))}
        emptyLabel="No hay hermanos registrados"
        onPersonPress={onFocusPerson}
        onAdd={() => onAddRelation('sibling')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    paddingHorizontal: 16,
    paddingBottom: 120,
  },
  section: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#ebe5ef',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  focusSection: {
    borderColor: '#d8c9ef',
    backgroundColor: '#fdfbff',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 18,
    paddingTop: 17,
    paddingBottom: 8,
  },
  sectionTitleWrap: {
    flex: 1,
    paddingRight: 8,
  },
  eyebrow: {
    color: '#7650ad',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  sectionTitle: {
    marginTop: 2,
    color: '#2c2730',
    fontSize: 19,
    fontWeight: '800',
  },
  sectionDescription: {
    marginTop: 3,
    color: '#746d79',
    fontSize: 12,
    lineHeight: 17,
  },
  cardRow: {
    minWidth: '100%',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 18,
  },
  focusRow: {
    minWidth: '100%',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 20,
  },
  partnerItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  partnerLink: {
    width: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  partnerLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#b9a4d6',
  },
  partnerSymbol: {
    paddingHorizontal: 4,
    color: '#7042b2',
    backgroundColor: '#fdfbff',
    fontSize: 22,
    fontWeight: '600',
  },
  emptyCard: {
    width: 148,
    minHeight: 172,
    marginHorizontal: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#b9a9ca',
    backgroundColor: '#faf7fd',
    overflow: 'hidden',
  },
  emptyCardContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
  },
  emptyIcon: {
    margin: 0,
    backgroundColor: '#eee6ff',
  },
  emptyText: {
    marginTop: 7,
    color: '#674992',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
    textAlign: 'center',
  },
  connector: {
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectorLine: {
    flex: 1,
    width: 2,
    backgroundColor: '#d0bfdc',
  },
  connectorPill: {
    borderRadius: 999,
    backgroundColor: '#eee6f4',
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  connectorLabel: {
    color: '#725b81',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
