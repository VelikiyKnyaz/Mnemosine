import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Surface, Text, TouchableRipple } from 'react-native-paper';
import {
  getAvatarUri,
  getBirthLabel,
  getPersonSubtitle,
  PersonRecord,
} from './relationshipModel';

interface PersonNodeCardProps {
  person: PersonRecord;
  roleLabel?: string;
  selected?: boolean;
  onPress: () => void;
}

export default function PersonNodeCard({
  person,
  roleLabel,
  selected = false,
  onPress,
}: PersonNodeCardProps) {
  return (
    <Surface
      mode="flat"
      elevation={selected ? 2 : 0}
      style={[styles.surface, selected && styles.selectedSurface]}
    >
      <TouchableRipple
        onPress={onPress}
        borderless
        style={styles.touchable}
        accessibilityRole="button"
        accessibilityLabel={`Ver relaciones de ${person.name}`}
      >
        <View style={styles.content}>
          {roleLabel ? (
            <View style={styles.rolePill}>
              <Text style={styles.roleText}>{roleLabel}</Text>
            </View>
          ) : null}
          <Image source={{ uri: getAvatarUri(person) }} style={styles.avatar} />
          <Text style={styles.name} numberOfLines={2}>
            {person.name}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {getPersonSubtitle(person)}
          </Text>
          <Text style={styles.year}>{getBirthLabel(person)}</Text>
        </View>
      </TouchableRipple>
    </Surface>
  );
}

const styles = StyleSheet.create({
  surface: {
    width: 148,
    minHeight: 172,
    marginHorizontal: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e6e0ec',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  selectedSurface: {
    borderWidth: 2,
    borderColor: '#6d3fc0',
    backgroundColor: '#fbf8ff',
  },
  touchable: {
    flex: 1,
    borderRadius: 20,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  rolePill: {
    alignSelf: 'center',
    borderRadius: 999,
    backgroundColor: '#eee6ff',
    paddingHorizontal: 9,
    paddingVertical: 3,
    marginBottom: 8,
  },
  roleText: {
    color: '#5c31a9',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#ede7f2',
  },
  name: {
    minHeight: 38,
    marginTop: 9,
    color: '#29242d',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
    textAlign: 'center',
  },
  subtitle: {
    width: '100%',
    marginTop: 3,
    color: '#6f6875',
    fontSize: 12,
    textAlign: 'center',
  },
  year: {
    marginTop: 4,
    color: '#8c8491',
    fontSize: 10,
  },
});
