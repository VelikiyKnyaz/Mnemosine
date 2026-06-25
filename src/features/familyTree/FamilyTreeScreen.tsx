import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, ScrollView, Image, Modal, Alert, TouchableOpacity, Text as RNText } from 'react-native';
import { Text, Appbar, Button, TextInput, IconButton, Portal, Card, Divider, FAB, Chip } from 'react-native-paper';
import { getDb } from '../../core/database';
import { useIsFocused } from '@react-navigation/native';
import { supabase } from '../../core/supabase';
import { useAuthStore } from '../../core/store';
import { syncConnections } from '../../core/socialSync';
import * as ImagePicker from 'expo-image-picker';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import SmartDropdown from '../../components/SmartDropdown';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, useAnimatedReaction, runOnJS } from 'react-native-reanimated';

const RELATIONSHIP_ITEMS = [
  { id: 'Padre', name: 'Padre' },
  { id: 'Madre', name: 'Madre' },
  { id: 'Hermano/a', name: 'Hermano/a' },
  { id: 'Hijo/a', name: 'Hijo/a' },
  { id: 'Abuelo/a', name: 'Abuelo/a' },
  { id: 'Tío/a', name: 'Tío/a' },
  { id: 'Primo/a', name: 'Primo/a' },
  { id: 'Pareja', name: 'Pareja' },
  { id: 'Amigo/a', name: 'Amigo/a' },
  { id: 'Otro', name: 'Otro' },
];

const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 800;
const centerX = CANVAS_WIDTH / 2;
const centerY = CANVAS_HEIGHT / 2;

export default function FamilyTreeScreen({ navigation }: any) {
  const [people, setPeople] = useState<any[]>([]);
  const isFocused = useIsFocused();
  const session = useAuthStore((state) => state.session);
  const myId = session?.user?.id;

  // Tree focus state
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);

  // Search state & Sidebar Drawer
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Edit/Create Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<any | null>(null); // null means "Create New"
  const [editName, setEditName] = useState('');
  const [editNickname, setEditNickname] = useState('');
  const [editRelationship, setEditRelationship] = useState('');
  const [editAvatarUrl, setEditAvatarUrl] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editBirthDate, setEditBirthDate] = useState('');
  const [editDecade, setEditDecade] = useState('');
  const [editFatherId, setEditFatherId] = useState<string | null>(null);
  const [editMotherId, setEditMotherId] = useState<string | null>(null);
  const [isLinked, setIsLinked] = useState(false);
  const [saving, setSaving] = useState(false);

  // Connection mapping state for direct linking from tree '+' buttons
  const [pendingLink, setPendingLink] = useState<{
    childId?: string;
    parentId?: string;
    role: 'father' | 'mother' | 'child';
  } | null>(null);

  const ensureMeNode = async (db: any, currentUserId: string) => {
    try {
      const existingMe = await db.getFirstAsync(
        "SELECT id FROM entities WHERE id = ? AND type = 'PERSON'",
        currentUserId
      );

      if (!existingMe) {
        const profile = await db.getFirstAsync("SELECT * FROM user_profile WHERE id = ?", currentUserId) || 
                        await db.getFirstAsync("SELECT * FROM user_profile LIMIT 1");
        
        const myName = profile?.full_name || 'Yo';
        const myAvatarUrl = profile?.avatar_url || '';
        const myBirthDate = profile?.birth_date || '1995-01-01';

        const meta = {
          nickname: 'Yo',
          relationship: 'Yo',
          avatar_url: myAvatarUrl,
          username: profile?.username || '',
          user_id: currentUserId,
          is_linked: true,
          connection_status: 'ACCEPTED'
        };

        await db.runAsync(
          "INSERT INTO entities (id, type, name, metadata, is_confirmed, birth_date) VALUES (?, 'PERSON', ?, ?, 1, ?)",
          currentUserId,
          myName,
          JSON.stringify(meta),
          myBirthDate
        );
        console.log(`[Tree] Created default (Yo) node for user ID ${currentUserId}`);
      }
    } catch (err) {
      console.warn('[Tree] Error ensuring Yo node:', err);
    }
  };

  const loadPeople = async () => {
    try {
      const db = await getDb();
      if (myId) {
        await ensureMeNode(db, myId);
      }
      const rows = await db.getAllAsync<any>(`
        SELECT e.id, e.name, e.metadata, e.father_id, e.mother_id, e.birth_date, COUNT(me.memory_id) as mentions
        FROM entities e
        LEFT JOIN memory_entities me ON e.id = me.entity_id
        WHERE e.type = 'PERSON'
        GROUP BY e.id
      `);
      setPeople(rows);
      
      // Auto-focus on "Yo" initially
      if (!focusedNodeId && myId) {
        setFocusedNodeId(myId);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSyncAndLoad = async () => {
    if (myId) {
      await syncConnections(myId);
    }
    await loadPeople();
  };

  useEffect(() => {
    if (isFocused) {
      handleSyncAndLoad();
    }
    
    if (myId) {
      const channel = supabase.channel('connections_tree')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'connections' }, () => {
          handleSyncAndLoad();
        })
        .subscribe();
      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [isFocused, myId]);

  // Derived relative birth year calculations for vertical positions
  const getBirthYear = (node: any) => {
    if (!node) return null;
    if (node.birth_date) {
      const yr = parseInt(node.birth_date.substring(0, 4));
      if (!isNaN(yr)) return yr;
    }
    const meta = node.metadata ? JSON.parse(node.metadata) : {};
    if (meta.birth_date) {
      const yr = parseInt(meta.birth_date.substring(0, 4));
      if (!isNaN(yr)) return yr;
    }
    return null;
  };

  const focusedNode = useMemo(() => {
    return people.find(p => p.id === focusedNodeId) || null;
  }, [people, focusedNodeId]);

  // Gesture values
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // Container layout measurements
  const [containerWidth, setContainerWidth] = useState(360);
  const [containerHeight, setContainerHeight] = useState(500);

  const [decadesList, setDecadesList] = useState<string[]>([
    '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'
  ]);
  const [isLoadingDecades, setIsLoadingDecades] = useState(false);
  const [isZoomedOut, setIsZoomedOut] = useState(false);

  useAnimatedReaction(
    () => scale.value,
    (currentScale) => {
      const shouldBeZoomedOut = currentScale < 0.75;
      if (shouldBeZoomedOut !== isZoomedOut) {
        runOnJS(setIsZoomedOut)(shouldBeZoomedOut);
      }
    },
    [isZoomedOut]
  );

  // Helper functions for relationship auto-assignment relative to Yo (the user)
  const getRelationForParent = (childId: string, role: 'father' | 'mother') => {
    if (childId === myId) {
      return role === 'father' ? 'Padre' : 'Madre';
    }
    const childPos = nodePositions[childId];
    if (!childPos) return '';
    const label = childPos.label;
    if (label === 'Yo' || label === 'Hermano/a') {
      return role === 'father' ? 'Padre' : 'Madre';
    }
    if (label === 'Padre' || label === 'Madre' || label === 'Tío/a' || label === 'Tio/a') {
      return role === 'father' ? 'Abuelo' : 'Abuela';
    }
    if (label === 'Hijo/a') {
      return 'Pareja';
    }
    if (label === 'Abuelo' || label === 'Abuela') {
      return role === 'father' ? 'Bisabuelo' : 'Bisabuela';
    }
    if (label === 'Pareja') {
      return role === 'father' ? 'Suegro' : 'Suegra';
    }
    return '';
  };

  const getRelationForChild = (parentId: string) => {
    if (parentId === myId) {
      return 'Hijo/a';
    }
    const parentPos = nodePositions[parentId];
    if (!parentPos) return 'Hijo/a';
    const label = parentPos.label;
    if (label === 'Yo') {
      return 'Hijo/a';
    }
    if (label === 'Padre' || label === 'Madre') {
      return 'Hermano/a';
    }
    if (label === 'Hermano/a') {
      return 'Sobrino/a';
    }
    if (label === 'Hijo/a') {
      return 'Nieto/a';
    }
    if (label === 'Abuelo' || label === 'Abuela') {
      return 'Tío/a';
    }
    if (label === 'Tío/a' || label === 'Tio/a') {
      return 'Primo/a';
    }
    return 'Hijo/a';
  };

  const handleDecadeScroll = (event: any) => {
    const { contentOffset } = event.nativeEvent;
    if (contentOffset.x <= 15 && !isLoadingDecades) {
      setIsLoadingDecades(true);
      setTimeout(() => {
        setDecadesList((prev) => {
          const oldestDecStr = prev[0];
          const oldestDecVal = parseInt(oldestDecStr);
          if (isNaN(oldestDecVal) || oldestDecVal <= 1700) {
            setIsLoadingDecades(false);
            return prev;
          }
          const olderDecades: string[] = [];
          for (let i = 5; i >= 1; i--) {
            olderDecades.push(`${oldestDecVal - i * 10}s`);
          }
          setIsLoadingDecades(false);
          return [...olderDecades, ...prev];
        });
      }, 500);
    }
  };

  const handleContainerLayout = (event: any) => {
    const { width, height } = event.nativeEvent.layout;
    setContainerWidth(width);
    setContainerHeight(height);
  };

  // Animate and center camera on a node
  const centerOnNode = (nodeX: number, nodeY: number) => {
    translateX.value = withTiming(containerWidth / 2 - nodeX, { duration: 450 });
    translateY.value = withTiming(containerHeight / 2 - nodeY, { duration: 450 });
    scale.value = withTiming(1.0, { duration: 450 });
    
    savedTranslateX.value = containerWidth / 2 - nodeX;
    savedTranslateY.value = containerHeight / 2 - nodeY;
    savedScale.value = 1.0;
  };

  const handleZoomIn = () => {
    const nextScale = Math.min(scale.value + 0.25, 3.0);
    scale.value = withTiming(nextScale, { duration: 200 });
    savedScale.value = nextScale;
  };

  const handleZoomOut = () => {
    const nextScale = Math.max(scale.value - 0.25, 0.4);
    scale.value = withTiming(nextScale, { duration: 200 });
    savedScale.value = nextScale;
  };

  // Center on Yo initially when layout is ready
  useEffect(() => {
    if (myId && containerWidth && containerHeight) {
      translateX.value = containerWidth / 2 - centerX;
      translateY.value = containerHeight / 2 - centerY;
      savedTranslateX.value = containerWidth / 2 - centerX;
      savedTranslateY.value = containerHeight / 2 - centerY;
    }
  }, [myId, containerWidth, containerHeight]);

  // Derived stable positions for all nodes
  const nodePositions = useMemo(() => {
    const coords: { [id: string]: { x: number, y: number, label: string } } = {};
    if (!myId || people.length === 0) return coords;

    const findPerson = (id: string) => people.find(p => p.id === id);

    // 1. "Yo"
    coords[myId] = { x: centerX, y: centerY, label: 'Yo' };

    const yoNode = findPerson(myId);
    const fatherId = yoNode?.father_id;
    const motherId = yoNode?.mother_id;

    // 2. Yo's parents
    if (fatherId) {
      coords[fatherId] = { x: centerX - 120, y: centerY - 140, label: 'Padre' };
    }
    if (motherId) {
      coords[motherId] = { x: centerX + 120, y: centerY - 140, label: 'Madre' };
    }

    // 3. Yo's grandparents
    if (fatherId) {
      const fatherNode = findPerson(fatherId);
      if (fatherNode?.father_id) {
        coords[fatherNode.father_id] = { x: centerX - 180, y: centerY - 280, label: 'Abuelo' };
      }
      if (fatherNode?.mother_id) {
        coords[fatherNode.mother_id] = { x: centerX - 60, y: centerY - 280, label: 'Abuela' };
      }
    }
    if (motherId) {
      const motherNode = findPerson(motherId);
      if (motherNode?.father_id) {
        coords[motherNode.father_id] = { x: centerX + 60, y: centerY - 280, label: 'Abuelo' };
      }
      if (motherNode?.mother_id) {
        coords[motherNode.mother_id] = { x: centerX + 180, y: centerY - 280, label: 'Abuela' };
      }
    }

    // 4. Yo's siblings
    const siblingsList = people.filter(p =>
      p.id !== myId &&
      ((fatherId && p.father_id === fatherId) || (motherId && p.mother_id === motherId))
    );
    siblingsList.forEach((sib, index) => {
      const isLeft = index % 2 === 0;
      const step = Math.floor(index / 2) + 1;
      const sibX = isLeft ? (centerX - 100 - step * 110) : (centerX + 100 + step * 110);
      coords[sib.id] = { x: sibX, y: centerY, label: 'Hermano/a' };
    });

    // 5. Yo's children & grandchildren
    const childrenList = people.filter(p => p.father_id === myId || p.mother_id === myId);
    childrenList.forEach((child, index) => {
      const spacing = 120;
      const totalWidth = (childrenList.length - 1) * spacing;
      const startX = centerX - totalWidth / 2;
      const childX = startX + index * spacing;
      coords[child.id] = { x: childX, y: centerY + 140, label: 'Hijo/a' };

      const grandchildrenList = people.filter(p => p.father_id === child.id || p.mother_id === child.id);
      grandchildrenList.forEach((gc, gcIdx) => {
        const gcSpacing = 100;
        const gcTotalW = (grandchildrenList.length - 1) * gcSpacing;
        const gcStartX = childX - gcTotalW / 2;
        coords[gc.id] = { x: gcStartX + gcIdx * gcSpacing, y: centerY + 280, label: 'Nieto/a' };
      });
    });

    // 6. Floating / other nodes
    const placedIds = new Set(Object.keys(coords));
    const floatingList = people.filter(p => !placedIds.has(p.id));
    floatingList.forEach((f, index) => {
      const isLeft = index % 2 === 0;
      const columnX = isLeft ? 80 : CANVAS_WIDTH - 80;
      const yOffset = (Math.floor(index / 2) * 90) % 360;
      const posY = centerY - 120 + yOffset;
      coords[f.id] = { x: columnX, y: posY, label: JSON.parse(f.metadata || '{}').relationship || 'Contacto' };
    });

    return coords;
  }, [people, myId]);

  // Orthogonal connector line builder
  const renderOrthogonalLine = (x1: number, y1: number, x2: number, y2: number, key: string, isDashed = false) => {
    const midY = (y1 + y2) / 2;
    const lines = [];
    
    // Vertical from (x1, y1) to (x1, midY)
    lines.push(
      <View
        key={`${key}-v1`}
        style={[
          styles.connectorLine,
          isDashed && styles.dashedConnector,
          {
            left: x1,
            top: Math.min(y1, midY),
            width: 2,
            height: Math.abs(y1 - midY),
          }
        ]}
      />
    );
    
    // Horizontal from (x1, midY) to (x2, midY)
    lines.push(
      <View
        key={`${key}-h`}
        style={[
          styles.connectorLine,
          isDashed && styles.dashedConnector,
          {
            left: Math.min(x1, x2),
            top: midY,
            width: Math.abs(x1 - x2) + 2,
            height: 2,
          }
        ]}
      />
    );
    
    // Vertical from (x2, midY) to (x2, y2)
    lines.push(
      <View
        key={`${key}-v2`}
        style={[
          styles.connectorLine,
          isDashed && styles.dashedConnector,
          {
            left: x2,
            top: Math.min(midY, y2),
            width: 2,
            height: Math.abs(midY - y2),
          }
        ]}
      />
    );
    return lines;
  };

  const renderAllLines = () => {
    const lines: React.ReactNode[] = [];
    let keyCount = 0;

    // 1. Draw actual family lines
    people.forEach((p) => {
      const pPos = nodePositions[p.id];
      if (!pPos) return;

      if (p.father_id) {
        const fPos = nodePositions[p.father_id];
        if (fPos) {
          lines.push(...renderOrthogonalLine(pPos.x, pPos.y, fPos.x, fPos.y, `line-father-${p.id}-${keyCount++}`));
        }
      }
      if (p.mother_id) {
        const mPos = nodePositions[p.mother_id];
        if (mPos) {
          lines.push(...renderOrthogonalLine(pPos.x, pPos.y, mPos.x, mPos.y, `line-mother-${p.id}-${keyCount++}`));
        }
      }
    });

    // 2. Draw lines to active "+" bubbles of the focused node
    if (focusedNodeId) {
      const p = people.find(x => x.id === focusedNodeId);
      const pos = nodePositions[focusedNodeId];
      if (p && pos) {
        if (!p.father_id) {
          lines.push(...renderOrthogonalLine(pos.x, pos.y, pos.x - 80, pos.y - 120, `line-add-father-${p.id}`, true));
        }
        if (!p.mother_id) {
          lines.push(...renderOrthogonalLine(pos.x, pos.y, pos.x + 80, pos.y - 120, `line-add-mother-${p.id}`, true));
        }
        const nodeChildren = people.filter(x => x.father_id === p.id || x.mother_id === p.id);
        if (nodeChildren.length === 0) {
          lines.push(...renderOrthogonalLine(pos.x, pos.y, pos.x, pos.y + 120, `line-add-child-${p.id}`, true));
        } else {
          // Find rightmost child
          let rightMostPos = { x: pos.x, y: pos.y + 120 };
          let maxChildX = -Infinity;
          nodeChildren.forEach(child => {
            const childPos = nodePositions[child.id];
            if (childPos && childPos.x > maxChildX) {
              maxChildX = childPos.x;
              rightMostPos = { x: childPos.x, y: childPos.y };
            }
          });
          lines.push(...renderOrthogonalLine(pos.x, pos.y, rightMostPos.x + 115, rightMostPos.y, `line-add-child-${p.id}`, true));
        }
      }
    }

    return lines;
  };

  const handleNodePress = (nodeId: string) => {
    if (focusedNodeId === nodeId) {
      // Second tap -> view memories
      navigation.navigate('EntityMemories', { entityId: nodeId });
    } else {
      setFocusedNodeId(nodeId);
      const pos = nodePositions[nodeId];
      if (pos) {
        centerOnNode(pos.x, pos.y);
      }
    }
  };

  const pickImage = async () => {
    if (isLinked) return;
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permiso Denegado', 'Necesitamos acceso a la galería para cambiar la foto.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setEditAvatarUrl(result.assets[0].uri);
      }
    } catch (e) {
      console.warn('Error al seleccionar imagen:', e);
    }
  };

  const handleSave = async () => {
    if (!editName.trim()) {
      Alert.alert('Falta Nombre', 'Por favor ingresa un nombre.');
      return;
    }

    setSaving(true);
    try {
      const db = await getDb();
      let targetUserId: string | null = null;
      let finalName = editName.trim();
      let finalAvatarUrl = editAvatarUrl;
      let finalUsername = editUsername.trim().toLowerCase();
      let linkStatus = isLinked;
      let connStatus = selectedPerson ? JSON.parse(selectedPerson.metadata || '{}').connection_status : null;

      // Handle User Linking/connections
      if (finalUsername && !isLinked) {
        const { data: targetProfile, error: profileErr } = await supabase
          .from('profiles')
          .select('id, username, full_name, avatar_url')
          .eq('username', finalUsername)
          .maybeSingle();

        if (profileErr || !targetProfile) {
          Alert.alert('Error de Vinculación', 'No se encontró un usuario con ese nombre en la app.');
          setSaving(false);
          return;
        }

        targetUserId = targetProfile.id;
        finalName = targetProfile.full_name || finalName;
        finalAvatarUrl = targetProfile.avatar_url || finalAvatarUrl;
        linkStatus = false;
        connStatus = 'PENDING_SENT';

        if (myId && myId !== targetUserId) {
          const { data: conn } = await supabase
            .from('connections')
            .select('*')
            .or(`and(sender_id.eq.${myId},receiver_id.eq.${targetUserId}),and(sender_id.eq.${targetUserId},receiver_id.eq.${myId})`)
            .maybeSingle();

          if (!conn) {
            await supabase.from('connections').insert({
              sender_id: myId,
              receiver_id: targetUserId,
              status: 'PENDING',
            });
            Alert.alert('Solicitud Enviada', `Solicitud de conexión enviada a @${finalUsername}.`);
          }
        }
      }

      const targetEntityId = selectedPerson ? selectedPerson.id : uuidv4();

      let finalBirthDate = editBirthDate.trim();
      let birthDecadeVal = editDecade;

      if (!finalBirthDate && editDecade) {
        const decadeNum = parseInt(editDecade.substring(0, 4));
        if (!isNaN(decadeNum)) {
          finalBirthDate = String(decadeNum + 5);
        }
      } else if (finalBirthDate) {
        birthDecadeVal = '';
      }

      const meta = {
        nickname: editNickname.trim(),
        relationship: editRelationship,
        avatar_url: finalAvatarUrl,
        username: finalUsername,
        user_id: targetUserId || (selectedPerson ? JSON.parse(selectedPerson.metadata || '{}').user_id : null),
        is_linked: linkStatus,
        connection_status: linkStatus ? 'ACCEPTED' : connStatus,
        birth_decade: birthDecadeVal,
      };

      if (selectedPerson) {
        await db.runAsync(
          "UPDATE entities SET name = ?, metadata = ?, father_id = ?, mother_id = ?, birth_date = ? WHERE id = ?",
          finalName,
          JSON.stringify(meta),
          editFatherId,
          editMotherId,
          finalBirthDate,
          targetEntityId
        );
      } else {
        await db.runAsync(
          "INSERT INTO entities (id, type, name, metadata, father_id, mother_id, birth_date, is_confirmed) VALUES (?, 'PERSON', ?, ?, ?, ?, ?, 1)",
          targetEntityId,
          finalName,
          JSON.stringify(meta),
          editFatherId,
          editMotherId,
          finalBirthDate
        );

        // If we opened this modal via a '+' direct link bubble, link it up now
        if (pendingLink) {
          if (pendingLink.role === 'father') {
            await db.runAsync("UPDATE entities SET father_id = ? WHERE id = ?", targetEntityId, pendingLink.childId);
          } else if (pendingLink.role === 'mother') {
            await db.runAsync("UPDATE entities SET mother_id = ? WHERE id = ?", targetEntityId, pendingLink.childId);
          } else if (pendingLink.role === 'child' && pendingLink.parentId) {
            // Check if parent is female or male to assign correctly
            const parent = people.find(p => p.id === pendingLink.parentId);
            const parentMeta = parent?.metadata ? JSON.parse(parent.metadata) : {};
            const rel = (parentMeta.relationship || '').toLowerCase();
            const isFemale = rel.includes('madre') || rel.includes('tía') || rel.includes('tia') || rel.includes('abuela') || rel.includes('prima') || rel.includes('hermana');
            if (isFemale) {
              await db.runAsync("UPDATE entities SET mother_id = ? WHERE id = ?", pendingLink.parentId, targetEntityId);
            } else {
              await db.runAsync("UPDATE entities SET father_id = ? WHERE id = ?", pendingLink.parentId, targetEntityId);
            }
          }
        }
      }

      // Sync nicknames with entity_aliases
      const newNicknames = editNickname.split(',').map(n => n.trim()).filter(Boolean);
      const oldNicknameStr = selectedPerson ? (JSON.parse(selectedPerson.metadata || '{}').nickname || '') : '';
      const oldNicknames = oldNicknameStr.split(',').map((n: string) => n.trim()).filter(Boolean);

      const deletedNicknames = oldNicknames.filter(n => !newNicknames.some(newN => newN.toLowerCase() === n.toLowerCase()));
      for (const alias of deletedNicknames) {
        await db.runAsync("DELETE FROM entity_aliases WHERE entity_id = ? AND alias = ? COLLATE NOCASE", targetEntityId, alias);
      }

      const addedNicknames = newNicknames.filter(n => !oldNicknames.some(oldN => oldN.toLowerCase() === n.toLowerCase()));
      for (const alias of addedNicknames) {
        try {
          const aliasId = uuidv4();
          await db.runAsync("INSERT INTO entity_aliases (id, alias, entity_id) VALUES (?, ?, ?)", aliasId, alias, targetEntityId);
        } catch (_) {}
      }

      setModalVisible(false);
      setPendingLink(null);
      await loadPeople();
      if (!selectedPerson) {
        setFocusedNodeId(targetEntityId); // Auto-focus on new creation
      }
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const person = people.find(p => p.id === id);
    const meta = person && person.metadata ? JSON.parse(person.metadata) : {};
    const targetUserId = meta.user_id;

    Alert.alert(
      'Eliminar Persona',
      '¿Estás seguro de que quieres eliminar a esta persona del árbol?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              if (targetUserId && myId) {
                await supabase
                  .from('connections')
                  .delete()
                  .or(`and(sender_id.eq.${myId},receiver_id.eq.${targetUserId}),and(sender_id.eq.${targetUserId},receiver_id.eq.${myId})`);
              }

              const db = await getDb();
              await db.runAsync("DELETE FROM entity_aliases WHERE entity_id = ?", id);
              await db.runAsync("DELETE FROM memory_entities WHERE entity_id = ?", id);
              // Clean father/mother references pointing to this person
              await db.runAsync("UPDATE entities SET father_id = NULL WHERE father_id = ?", id);
              await db.runAsync("UPDATE entities SET mother_id = NULL WHERE mother_id = ?", id);
              await db.runAsync("DELETE FROM entities WHERE id = ?", id);
              
              setModalVisible(false);
              if (focusedNodeId === id) {
                setFocusedNodeId(myId || null);
              }
              await loadPeople();
            } catch (err) {
              console.error(err);
            }
          }
        }
      ]
    );
  };

  const handleUnlink = (id: string) => {
    const person = people.find(p => p.id === id);
    const meta = person && person.metadata ? JSON.parse(person.metadata) : {};
    const targetUserId = meta.user_id;

    Alert.alert(
      'Desvincular de la App',
      '¿Estás seguro de que quieres desvincular a esta persona?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desvincular',
          style: 'destructive',
          onPress: async () => {
            try {
              if (targetUserId && myId) {
                await supabase
                  .from('connections')
                  .delete()
                  .or(`and(sender_id.eq.${myId},receiver_id.eq.${targetUserId}),and(sender_id.eq.${targetUserId},receiver_id.eq.${myId})`);
              }

              const db = await getDb();
              meta.is_linked = false;
              meta.user_id = null;
              meta.username = '';
              await db.runAsync("UPDATE entities SET metadata = ? WHERE id = ?", JSON.stringify(meta), id);
              setModalVisible(false);
              await loadPeople();
            } catch (err) {
              console.error(err);
            }
          }
        }
      ]
    );
  };

  const openEditModal = (person: any) => {
    setSelectedPerson(person);
    const meta = person.metadata ? JSON.parse(person.metadata) : {};
    setEditName(person.name);
    setEditNickname(meta.nickname || '');
    setEditRelationship(meta.relationship || '');
    setEditAvatarUrl(meta.avatar_url || '');
    setEditUsername(meta.username || '');
    setEditFatherId(person.father_id || null);
    setEditMotherId(person.mother_id || null);
    setIsLinked(!!meta.is_linked);
    
    if (meta.birth_decade) {
      setEditDecade(meta.birth_decade);
      setEditBirthDate('');
    } else {
      setEditBirthDate(person.birth_date || '');
      setEditDecade('');
    }
    
    setModalVisible(true);
  };

  const openCreateModal = (preLink: typeof pendingLink = null) => {
    setPendingLink(preLink);
    setSelectedPerson(null);
    setEditName('');
    setEditNickname('');
    setEditRelationship('');
    setEditAvatarUrl('');
    setEditUsername('');
    setEditBirthDate('');
    setEditDecade('');
    setEditFatherId(null);
    setEditMotherId(null);
    setIsLinked(false);

    // Pre-fill fields if we have a direct tree link context
    if (preLink) {
      if (preLink.childId && (preLink.role === 'father' || preLink.role === 'mother')) {
        setEditRelationship(getRelationForParent(preLink.childId, preLink.role));
      } else if (preLink.role === 'child' && preLink.parentId) {
        setEditRelationship(getRelationForChild(preLink.parentId));

        // Set father/mother reference
        const parent = people.find(p => p.id === preLink.parentId);
        const parentMeta = parent?.metadata ? JSON.parse(parent.metadata) : {};
        const rel = (parentMeta.relationship || '').toLowerCase();
        const isFemale = rel.includes('madre') || rel.includes('tía') || rel.includes('tia') || rel.includes('abuela') || rel.includes('prima') || rel.includes('hermana') || rel.includes('mujer');
        if (isFemale) {
          setEditMotherId(preLink.parentId);
        } else {
          setEditFatherId(preLink.parentId);
        }
      }
    }
    setModalVisible(true);
  };
const filteredList = useMemo(() => {
  if (!searchQuery.trim()) return people;
  const q = searchQuery.toLowerCase().trim();
  return people.filter(p => p.name.toLowerCase().includes(q) || 
    (p.metadata && JSON.parse(p.metadata).nickname?.toLowerCase().includes(q))
  );
}, [people, searchQuery]);

  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      translateX.value = savedTranslateX.value + event.translationX;
      translateY.value = savedTranslateY.value + event.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const pinchGesture = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = Math.max(0.4, Math.min(3, savedScale.value * event.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const combinedGesture = Gesture.Simultaneous(panGesture, pinchGesture);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { scale: scale.value }
      ],
    };
  });

  const animatedBadgeStyle = useAnimatedStyle(() => {
    const yoX = 500;
    const yoY = 400;

    const yoScreenX = yoX + translateX.value;
    const yoScreenY = yoY + translateY.value;

    const w = containerWidth;
    const h = containerHeight;
    const margin = 24;

    const isOffScreen = yoScreenX < 0 || yoScreenX > w || yoScreenY < 0 || yoScreenY > h;

    const badgeX = Math.max(margin, Math.min(w - margin - 40, yoScreenX));
    const badgeY = Math.max(margin, Math.min(h - margin - 40, yoScreenY));

    const opacity = withTiming(isOffScreen ? 1 : 0, { duration: 200 });
    const scaleVal = withTiming(isOffScreen ? 1 : 0, { duration: 200 });

    return {
      position: 'absolute',
      left: badgeX,
      top: badgeY,
      opacity: opacity,
      transform: [{ scale: scaleVal }],
    };
  });

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={styles.container}>
        <Appbar.Header style={styles.appbar}>
          <IconButton icon="menu" iconColor="#6200ee" onPress={() => setSidebarOpen(true)} />
          <Appbar.Content title="Red Social y Árbol" titleStyle={styles.headerTitle} />
          {focusedNodeId !== myId && (
            <Button mode="text" compact textColor="#6200ee" onPress={() => myId && setFocusedNodeId(myId)}>
              Ver Mi Árbol (Yo)
            </Button>
          )}
        </Appbar.Header>

        {/* Modern Mind Map Canvas (2D Free Pan and Zoom) */}
        <View style={styles.canvasContainer} onLayout={handleContainerLayout}>
          <GestureDetector gesture={combinedGesture}>
            <Animated.View style={[styles.mapCanvas, animatedStyle]}>
              {/* Dotted Grid Background */}
              <View style={styles.gridOverlay} />

              {/* Connecting lines */}
              {renderAllLines()}

              {/* RENDER ALL PEOPLE IN FIXED COORDINATES */}
              {people.map((person) => {
                const pos = nodePositions[person.id];
                if (!pos) return null;
                const isFocused = focusedNodeId === person.id;
                const meta = person.metadata ? JSON.parse(person.metadata) : {};

                return (
                  <View key={`node-${person.id}`} style={[styles.nodeWrapper, { left: pos.x - 37.5, top: pos.y - 37.5 }]}>
                    <TouchableOpacity 
                      activeOpacity={0.8} 
                      onPress={() => handleNodePress(person.id)}
                      style={[
                        styles.nodeBubble,
                        isFocused && styles.focusedBubble,
                        pos.label === 'Yo' && styles.yoBubble,
                        !['Yo', 'Padre', 'Madre', 'Hermano/a', 'Hijo/a', 'Abuelo', 'Abuela', 'Nieto/a'].includes(pos.label) && styles.floatingBubble
                      ]}
                    >
                      <Image 
                        source={{ uri: meta.avatar_url || 'https://api.dicebear.com/7.x/adventurer/png?seed=' + person.name }} 
                        style={styles.nodeAvatar} 
                      />
                      {person.id === myId && <View style={styles.meBadge}><Text style={styles.meBadgeText}>Yo</Text></View>}
                    </TouchableOpacity>
                    <ZoomCompensatedText 
                      scale={scale} 
                      name={person.name} 
                      subtitle={meta.nickname || pos.label} 
                      isZoomedOut={isZoomedOut} 
                    />
                  </View>
                );
              })}

              {/* DYNAMIC ADD BRANCH (+) BUBBLES */}
              {focusedNodeId && (() => {
                const p = people.find(x => x.id === focusedNodeId);
                const pos = nodePositions[focusedNodeId];
                if (!p || !pos) return null;

                const addButtons = [];

                if (!p.father_id) {
                  addButtons.push(
                    <View key="add-father" style={[styles.nodeWrapper, { left: pos.x - 80 - 37.5, top: pos.y - 120 - 37.5 }]}>
                      <TouchableOpacity 
                        activeOpacity={0.8} 
                        onPress={() => openCreateModal({ childId: p.id, role: 'father' })}
                        style={styles.plusBubble}
                      >
                        <IconButton icon="plus" size={24} iconColor="#7b1fa2" />
                      </TouchableOpacity>
                      <ZoomCompensatedLabel scale={scale} label="Asignar Padre" />
                    </View>
                  );
                }

                if (!p.mother_id) {
                  addButtons.push(
                    <View key="add-mother" style={[styles.nodeWrapper, { left: pos.x + 80 - 37.5, top: pos.y - 120 - 37.5 }]}>
                      <TouchableOpacity 
                        activeOpacity={0.8} 
                        onPress={() => openCreateModal({ childId: p.id, role: 'mother' })}
                        style={styles.plusBubble}
                      >
                        <IconButton icon="plus" size={24} iconColor="#7b1fa2" />
                      </TouchableOpacity>
                      <ZoomCompensatedLabel scale={scale} label="Asignar Madre" />
                    </View>
                  );
                }

                const nodeChildren = people.filter(x => x.father_id === p.id || x.mother_id === p.id);
                if (nodeChildren.length === 0) {
                  addButtons.push(
                    <View key="add-child" style={[styles.nodeWrapper, { left: pos.x - 37.5, top: pos.y + 120 - 37.5 }]}>
                      <TouchableOpacity 
                        activeOpacity={0.8} 
                        onPress={() => openCreateModal({ parentId: p.id, role: 'child' })}
                        style={styles.plusBubble}
                      >
                        <IconButton icon="plus" size={24} iconColor="#7b1fa2" />
                      </TouchableOpacity>
                      <ZoomCompensatedLabel scale={scale} label="Asignar Hijo/a" />
                    </View>
                  );
                } else {
                  // Find rightmost child
                  let rightMostPos = { x: pos.x, y: pos.y + 120 };
                  let maxChildX = -Infinity;
                  nodeChildren.forEach(child => {
                    const childPos = nodePositions[child.id];
                    if (childPos && childPos.x > maxChildX) {
                      maxChildX = childPos.x;
                      rightMostPos = { x: childPos.x, y: childPos.y };
                    }
                  });
                  addButtons.push(
                    <View key="add-child" style={[styles.nodeWrapper, { left: rightMostPos.x + 115 - 37.5, top: rightMostPos.y - 37.5 }]}>
                      <TouchableOpacity 
                        activeOpacity={0.8} 
                        onPress={() => openCreateModal({ parentId: p.id, role: 'child' })}
                        style={styles.plusBubble}
                      >
                        <IconButton icon="plus" size={24} iconColor="#7b1fa2" />
                      </TouchableOpacity>
                      <ZoomCompensatedLabel scale={scale} label="Asignar Hijo/a" />
                    </View>
                  );
                }

                return addButtons;
              })()}

            </Animated.View>
          </GestureDetector>

          {/* Floating Zoom Controls */}
          <View style={styles.zoomControls}>
            <IconButton
              icon="plus"
              mode="contained"
              containerColor="#ffffff"
              iconColor="#6200ee"
              size={22}
              onPress={handleZoomIn}
              style={styles.zoomBtn}
            />
            <IconButton
              icon="minus"
              mode="contained"
              containerColor="#ffffff"
              iconColor="#6200ee"
              size={22}
              onPress={handleZoomOut}
              style={styles.zoomBtn}
            />
          </View>

          {/* Retorno Rápido (Centering shortcut) */}
          {myId && (() => {
            const yoNode = people.find(p => p.id === myId);
            const yoMeta = yoNode?.metadata ? JSON.parse(yoNode.metadata) : {};
            const yoAvatarUrl = yoMeta.avatar_url || 'https://api.dicebear.com/7.x/adventurer/png?seed=' + (yoNode?.name || 'Yo');
            return (
              <Animated.View style={[styles.floatingYoBadge, animatedBadgeStyle]}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => centerOnNode(500, 400)}
                  style={styles.floatingYoBadgeButton}
                >
                  <Image
                    source={{ uri: yoAvatarUrl }}
                    style={styles.floatingYoBadgeAvatar}
                  />
                  <View style={styles.floatingYoBadgeIndicator}>
                    <IconButton icon="home" size={10} iconColor="#ffffff" style={{ margin: 0, padding: 0 }} />
                  </View>
                </TouchableOpacity>
              </Animated.View>
            );
          })()}
        </View>

    {/* Floating Bottom Panel for Selected / Focused Node Controls */}
    {focusedNode && (
      <Card style={styles.controlPanel} mode="elevated">
        <View style={styles.panelRow}>
          <Image 
            source={{ uri: JSON.parse(focusedNode.metadata || '{}').avatar_url || 'https://api.dicebear.com/7.x/adventurer/png?seed=' + focusedNode.name }} 
            style={styles.panelAvatar} 
          />
          <View style={styles.panelTextWrap}>
            <Text style={styles.panelTitle}>{focusedNode.name}</Text>
            <Text style={styles.panelSubtitle}>{focusedNode.mentions} recuerdos • {focusedNode.birth_date ? `Nac: ${focusedNode.birth_date.substring(0, 4)}` : 'Sin año'}</Text>
          </View>
          <View style={styles.panelActions}>
            <Button 
              mode="contained" 
              buttonColor="#6200ee" 
              compact
              style={styles.actionBtn}
              onPress={() => navigation.navigate('EntityMemories', { entityId: focusedNode.id })}
            >
              Recuerdos
            </Button>
            <IconButton icon="pencil-outline" size={20} iconColor="#6200ee" onPress={() => openEditModal(focusedNode)} />
          </View>
        </View>
      </Card>
    )}

    {/* Floating Action Button for freeform creations */}
    <FAB
      icon="account-plus-outline"
      style={styles.fab}
      color="#ffffff"
      onPress={() => openCreateModal(null)}
      label="Nuevo"
    />

    {/* Sidebar Contacts List Overlay / Drawer */}
    <Portal>
      <Modal visible={sidebarOpen} onDismiss={() => setSidebarOpen(false)} contentContainerStyle={styles.sidebarContent}>
        <Appbar.Header style={styles.sidebarHeader} elevation={0}>
          <Appbar.Content title="Todos los Miembros" titleStyle={styles.sidebarTitle} />
          <IconButton icon="close" onPress={() => setSidebarOpen(false)} />
        </Appbar.Header>
        
        <TextInput
          placeholder="Buscar por nombre o apodo..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          mode="outlined"
          activeOutlineColor="#6200ee"
          dense
          style={styles.sidebarSearch}
          left={<TextInput.Icon icon="magnify" />}
        />
        
        <ScrollView contentContainerStyle={styles.sidebarList}>
          {filteredList.map((p) => {
            const meta = p.metadata ? JSON.parse(p.metadata) : {};
            return (
              <TouchableOpacity 
                key={`list-item-${p.id}`} 
                style={[styles.sidebarItem, focusedNodeId === p.id && styles.sidebarItemFocused]}
                onPress={() => {
                  setFocusedNodeId(p.id);
                  setSidebarOpen(false);
                }}
              >
                <Image source={{ uri: meta.avatar_url || 'https://api.dicebear.com/7.x/adventurer/png?seed=' + p.name }} style={styles.sidebarAvatar} />
                <View style={styles.sidebarItemText}>
                  <Text style={styles.sidebarItemName}>{p.name} {meta.nickname ? `(${meta.nickname})` : ''}</Text>
                  <Text style={styles.sidebarItemRel}>{meta.relationship || 'Contacto'}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </Modal>
    </Portal>

    {/* Creation & Editing Portal Modal */}
    <Portal>
      <Modal visible={modalVisible} onDismiss={() => setModalVisible(false)} contentContainerStyle={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Appbar.Header style={styles.modalHeader}>
            <Appbar.Content title={selectedPerson ? "Editar Perfil" : "Añadir al Árbol / Red"} titleStyle={styles.modalTitle} />
            <IconButton icon="close" disabled={saving} onPress={() => setModalVisible(false)} />
            {selectedPerson && selectedPerson.id !== myId && (
              <IconButton icon="delete-outline" iconColor="#d32f2f" disabled={saving} onPress={() => handleDelete(selectedPerson.id)} />
            )}
          </Appbar.Header>

          <ScrollView contentContainerStyle={styles.modalScroll}>
            <View style={styles.avatarUploadContainer}>
              <TouchableOpacity onPress={pickImage} disabled={isLinked || saving} style={styles.avatarPicker}>
                <Image
                  source={{ uri: editAvatarUrl || 'https://api.dicebear.com/7.x/adventurer/png?seed=avatar' }}
                  style={[styles.largeAvatar, isLinked && { opacity: 0.7 }]}
                />
                {!isLinked && (
                  <View style={styles.cameraIconBadge}>
                    <IconButton icon="camera" size={16} iconColor="#ffffff" />
                  </View>
                )}
              </TouchableOpacity>
              {isLinked && (
                <Text style={styles.linkedText}>Sincronizado con el usuario remoto</Text>
              )}
            </View>

            <TextInput
              label="Nombre Completo"
              value={editName}
              onChangeText={setEditName}
              style={styles.input}
              mode="outlined"
              activeOutlineColor="#6200ee"
              disabled={isLinked || saving}
            />

            <TextInput
              label="Apodos (Separar por comas)"
              value={editNickname}
              onChangeText={setEditNickname}
              style={styles.input}
              mode="outlined"
              activeOutlineColor="#6200ee"
              disabled={saving}
              placeholder="Ej: Beto, Rober, Robertito"
            />

            <TextInput
              label="Año de Nacimiento (AAAA)"
              value={editBirthDate}
              onChangeText={(text) => {
                setEditBirthDate(text);
                if (text) setEditDecade('');
              }}
              style={styles.input}
              mode="outlined"
              activeOutlineColor="#6200ee"
              disabled={saving}
              placeholder="Ej: 1995"
              keyboardType="numeric"
              maxLength={4}
            />

            <Text style={styles.inputLabel}>O elegir década aproximada:</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipScroll}
              onScroll={handleDecadeScroll}
              scrollEventThrottle={16}
            >
              {isLoadingDecades && (
                <View style={{ justifyContent: 'center', paddingHorizontal: 8 }}>
                  <Text style={{ fontSize: 11, color: '#6c757d', fontStyle: 'italic' }}>Cargando...</Text>
                </View>
              )}
              {decadesList.map((dec) => {
                const isSelected = editDecade === dec;
                return (
                  <Chip
                    key={dec}
                    selected={isSelected}
                    onPress={() => {
                      setEditDecade(isSelected ? '' : dec);
                      setEditBirthDate('');
                    }}
                    style={[styles.decadeChip, isSelected && styles.decadeChipSelected]}
                    textStyle={[styles.decadeChipText, isSelected && styles.decadeChipTextSelected]}
                  >
                    {dec}
                  </Chip>
                );
              })}
            </ScrollView>
            <View style={styles.dropdownWrap}>
              <SmartDropdown
                label="Parentesco o Relación"
                value={editRelationship}
                items={RELATIONSHIP_ITEMS}
                onSelect={(item) => {
                  if (item) setEditRelationship(item.name);
                }}
                onCreateNew={(name) => setEditRelationship(name)}
                placeholder="Selecciona relación"
                enablePlaces={false}
              />
            </View>



            <Divider style={styles.divider} />
            <Text style={styles.sectionHeader}>🔗 Vinculación con Mnemósine</Text>
            <Text style={styles.hintText}>
              Si esta persona usa la app, coloca su nombre de usuario para vincular su cuenta.
            </Text>

            <TextInput
              label="Nombre de Usuario de la App (@)"
              value={editUsername}
              onChangeText={setEditUsername}
              style={styles.input}
              mode="outlined"
              activeOutlineColor="#6200ee"
              autoCapitalize="none"
              disabled={isLinked || saving}
              placeholder="Ej: sofiagomez"
            />

            {isLinked && selectedPerson && (
              <Button
                mode="outlined"
                onPress={() => handleUnlink(selectedPerson.id)}
                style={{ borderColor: '#d32f2f', marginBottom: 12, borderRadius: 8 }}
                color="#d32f2f"
                disabled={saving}
              >
                Desvincular de la App
              </Button>
            )}

            <Button
              mode="contained"
              onPress={handleSave}
              style={styles.saveBtn}
              color="#6200ee"
              loading={saving}
              disabled={saving}
            >
              Guardar Cambios
            </Button>
          </ScrollView>
        </View>
      </Modal>
    </Portal>
  </View>
  </GestureHandlerRootView>
);
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f6f7fb',
  },
  appbar: {
    backgroundColor: '#ffffff',
    elevation: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f3f5',
  },
  headerTitle: {
    fontWeight: 'bold',
    fontSize: 18,
    color: '#212529',
  },
  canvasContainer: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  mapCanvas: {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    position: 'relative',
    backgroundColor: '#fcfdff',
  },
  gridOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    opacity: 0.05,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#212529',
    borderStyle: 'dashed',
  },
  connectorLine: {
    position: 'absolute',
    backgroundColor: '#7b1fa2',
    opacity: 0.35,
  },
  dashedConnector: {
    borderStyle: 'dashed',
    borderColor: '#7b1fa2',
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  nodeWrapper: {
    position: 'absolute',
    width: 75,
    alignItems: 'center',
  },
  nodeBubble: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 3,
    borderColor: '#ffffff',
    backgroundColor: '#ffffff',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3.84,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  yoBubble: {
    borderColor: '#6200ee',
    borderWidth: 3,
  },
  focusedBubble: {
    borderColor: '#6200ee',
    borderWidth: 4,
    elevation: 8,
    shadowColor: '#6200ee',
    shadowOpacity: 0.4,
    shadowRadius: 5.46,
  },
  floatingBubble: {
    borderColor: '#ff4081',
    borderWidth: 2.5,
  },
  plusBubble: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 2,
    borderColor: '#7b1fa2',
    borderStyle: 'dashed',
    backgroundColor: '#f3e5f5',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 1,
  },
  smallPlusBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#7b1fa2',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
  zoomControls: {
    position: 'absolute',
    right: 16,
    bottom: 180,
    flexDirection: 'column',
  },
  zoomBtn: {
    marginVertical: 4,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3.84,
  },
  nodeAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 35,
  },
  meBadge: {
    position: 'absolute',
    bottom: 0,
    backgroundColor: '#6200ee',
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: 10,
  },
  meBadgeText: {
    fontSize: 9,
    color: '#ffffff',
    fontWeight: 'bold',
  },
  nodeName: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#212529',
    textAlign: 'center',
  },
  nodeSubtitle: {
    fontSize: 9,
    color: '#6c757d',
    textAlign: 'center',
  },
  textContainer: {
    alignItems: 'center',
    marginTop: 6,
    width: 100,
  },
  floatingYoBadge: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    elevation: 10,
    shadowColor: '#6200ee',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#6200ee',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  floatingYoBadgeButton: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingYoBadgeAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  floatingYoBadgeIndicator: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#6200ee',
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Floating bottom control panel
  controlPanel: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 4.65,
  },
  panelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  panelAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 12,
  },
  panelTextWrap: {
    flex: 1,
  },
  panelTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#212529',
  },
  panelSubtitle: {
    fontSize: 12,
    color: '#6c757d',
  },
  panelActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionBtn: {
    borderRadius: 10,
  },
  fab: {
    position: 'absolute',
    margin: 16,
    right: 0,
    bottom: 90, // Positioned above the bottom card panel
    backgroundColor: '#6200ee',
    borderRadius: 28,
  },
  // Sidebar contacts list styles
  sidebarContent: {
    backgroundColor: '#ffffff',
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '80%',
    maxWidth: 320,
    height: '100%',
    elevation: 16,
  },
  sidebarHeader: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f3f5',
  },
  sidebarTitle: {
    fontWeight: 'bold',
  },
  sidebarSearch: {
    margin: 12,
    backgroundColor: '#ffffff',
  },
  sidebarList: {
    paddingBottom: 24,
  },
  sidebarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f8f9fa',
  },
  sidebarItemFocused: {
    backgroundColor: '#f3e5f5',
  },
  sidebarAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  sidebarItemText: {
    flex: 1,
  },
  sidebarItemName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#212529',
  },
  sidebarItemRel: {
    fontSize: 11,
    color: '#6c757d',
  },
  // Modal layout
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '92%',
  },
  modalHeader: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f3f5',
    elevation: 0,
  },
  modalTitle: {
    fontWeight: 'bold',
  },
  modalScroll: {
    padding: 20,
  },
  avatarUploadContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  avatarPicker: {
    position: 'relative',
  },
  largeAvatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#f1f3f9',
    borderWidth: 2,
    borderColor: '#e9ecef',
  },
  cameraIconBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#6200ee',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkedText: {
    fontSize: 12,
    color: '#868e96',
    marginTop: 8,
  },
  input: {
    marginBottom: 16,
    backgroundColor: '#ffffff',
  },
  dropdownWrap: {
    marginBottom: 16,
  },
  divider: {
    marginVertical: 16,
  },
  sectionHeader: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#212529',
    marginBottom: 12,
  },
  hintText: {
    fontSize: 12,
    color: '#6c757d',
    lineHeight: 18,
    marginBottom: 16,
  },
  saveBtn: {
    marginTop: 12,
    paddingVertical: 6,
    borderRadius: 10,
    marginBottom: 40,
  },
  inputLabel: {
    fontSize: 12,
    color: '#6c757d',
    marginBottom: 8,
  },
  chipScroll: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  decadeChip: {
    marginRight: 8,
    backgroundColor: '#f1f3f9',
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  decadeChipSelected: {
    backgroundColor: '#e8def8',
  },
  decadeChipText: {
    fontSize: 12,
    color: '#49454f',
  },
  decadeChipTextSelected: {
    color: '#1d192b',
    fontWeight: 'bold',
  },
});

const ZoomCompensatedText = ({ scale, name, subtitle, isZoomedOut }: { scale: any, name: string, subtitle: string, isZoomedOut: boolean }) => {
  const animatedTextStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: 1 / scale.value }],
    };
  });

  const displayName = isZoomedOut ? name.split(' ')[0] : name;

  return (
    <Animated.View style={[styles.textContainer, animatedTextStyle]}>
      <RNText style={styles.nodeName} numberOfLines={1}>{displayName}</RNText>
      <RNText style={styles.nodeSubtitle}>{subtitle}</RNText>
    </Animated.View>
  );
};

const ZoomCompensatedLabel = ({ scale, label }: { scale: any, label: string }) => {
  const animatedTextStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: 1 / scale.value }],
    };
  });
  return (
    <Animated.View style={[styles.textContainer, animatedTextStyle]}>
      <RNText style={styles.nodeName}>{label}</RNText>
    </Animated.View>
  );
};
