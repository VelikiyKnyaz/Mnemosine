import React, { useState, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, Text, IconButton } from 'react-native-paper';

const QUESTIONS = [
  '¿Cuál era tu juguete favorito cuando eras niño?',
  '¿Recuerdas alguna anécdota divertida en la escuela secundaria?',
  '¿Cuál ha sido el viaje más memorable de tu vida y por qué?',
  '¿Qué consejo le darías a tu yo de 20 años?',
  'Háblame de una persona que haya cambiado el rumbo de tu vida.',
];

interface BiographerCardProps {
  onPressQuestion: (question: string) => void;
}

export default function BiographerCard({ onPressQuestion }: BiographerCardProps) {
  const [question, setQuestion] = useState('');

  useEffect(() => {
    // In a real app, this would change daily. For now, random on mount.
    const randomQ = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
    setQuestion(randomQ);
  }, []);

  const handleRefresh = () => {
    const randomQ = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
    setQuestion(randomQ);
  };

  return (
    <Card style={styles.card} onPress={() => onPressQuestion(question)}>
      <Card.Content>
        <View style={styles.header}>
          <Text variant="labelMedium" style={styles.label}>EL BIÓGRAFO DIARIO</Text>
          <IconButton icon="refresh" size={16} onPress={handleRefresh} style={styles.refreshBtn} />
        </View>
        <Text variant="bodyLarge" style={styles.question}>{question}</Text>
        <Text variant="bodySmall" style={styles.hint}>Toca para responder...</Text>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    margin: 16,
    backgroundColor: '#fff4e6',
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    color: '#d97706',
    fontWeight: 'bold',
  },
  refreshBtn: {
    margin: 0,
  },
  question: {
    marginTop: 8,
    fontWeight: '500',
    color: '#333',
  },
  hint: {
    marginTop: 12,
    color: '#888',
    fontStyle: 'italic',
  },
});
