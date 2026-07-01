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

const CANVAS_WIDTH = 1400;
const CANVAS_HEIGHT = 1200;
const centerX = CANVAS_WIDTH / 2;
const centerY = CANVAS_HEIGHT / 2;

const getPartnerIds = (person: any) => {
  if (!person) return [];
  try {
    const meta = person.metadata ? JSON.parse(person.metadata) : {};
    const ids = new Set<string>();
    if (meta.partner_id) ids.add(meta.partner_id);
    if (Array.isArray(meta.partner_ids)) {
      meta.partner_ids.forEach((id: string) => ids.add(id));
    }
    return Array.from(ids);
  } catch {
    return [];
  }
};

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
    partnerId?: string;
    role: 'father' | 'mother' | 'child' | 'partner' | 'joint_child';
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

  const getRelationForPartner = (parentId: string) => {
    if (parentId === myId) return 'Pareja';
    const parent = people.find(p => p.id === parentId);
    if (!parent) return 'Otro';
    const parentMeta = parent.metadata ? JSON.parse(parent.metadata) : {};
    const parentRel = parentMeta.relationship || 'Contacto';
    
    if (parentRel === 'Yo') return 'Pareja';
    if (parentRel.includes('Padre') || parentRel.includes('Madre')) {
      return 'Pareja de mi ' + parentRel;
    }
    if (parentRel.includes('Abuelo') || parentRel.includes('Abuela')) {
      return 'Pareja de mi ' + parentRel;
    }
    if (parentRel.includes('Hermano') || parentRel.includes('Hermana')) {
      return 'Pareja de mi ' + parentRel;
    }
    if (parentRel.includes('Hijo') || parentRel.includes('Hija')) {
      return 'Pareja de mi ' + parentRel;
    }
    return 'Pareja de ' + (parentMeta.nickname || parent.name);
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

  // Derived visible people based on focusedNodeId (Context-Focus filtering)
  const visiblePeople = useMemo(() => {
    if (!focusedNodeId || people.length === 0) return people;

    const visibleIds = new Set<string>();
    const findPerson = (id: string) => people.find(p => p.id === id);

    // 1. Add focused node
    visibleIds.add(focusedNodeId);

    // 2. Traverse ancestors (up)
    const queueUp = [focusedNodeId];
    while (queueUp.length > 0) {
      const curr = queueUp.shift()!;
      const p = findPerson(curr);
      if (p) {
        if (p.father_id && !visibleIds.has(p.father_id)) {
          visibleIds.add(p.father_id);
          queueUp.push(p.father_id);
        }
        if (p.mother_id && !visibleIds.has(p.mother_id)) {
          visibleIds.add(p.mother_id);
          queueUp.push(p.mother_id);
        }
      }
    }

    // 3. Traverse descendants (down)
    const queueDown = [focusedNodeId];
    const descendants = new Set<string>();
    while (queueDown.length > 0) {
      const curr = queueDown.shift()!;
      const children = people.filter(x => x.father_id === curr || x.mother_id === curr);
      children.forEach(c => {
        if (!visibleIds.has(c.id)) {
          visibleIds.add(c.id);
          descendants.add(c.id);
          queueDown.push(c.id);
        }
      });
    }

    // 4. Add direct partners of the focused node
    const partnersMap: { [id: string]: string[] } = {};
    const addPartnerMapping = (idA: string, idB: string) => {
      if (!idA || !idB) return;
      if (!partnersMap[idA]) partnersMap[idA] = [];
      if (!partnersMap[idA].includes(idB)) partnersMap[idA].push(idB);
      if (!partnersMap[idB]) partnersMap[idB] = [];
      if (!partnersMap[idB].includes(idA)) partnersMap[idB].push(idA);
    };

    people.forEach(p => {
      const metaPartnerIds = getPartnerIds(p);
      metaPartnerIds.forEach(pId => addPartnerMapping(p.id, pId));
      if (p.father_id && p.mother_id) {
        addPartnerMapping(p.father_id, p.mother_id);
      }
      const meta = p.metadata ? JSON.parse(p.metadata) : {};
      if (meta.relationship === 'Pareja') {
        addPartnerMapping(p.id, myId || '');
      }
    });

    const focusedPartners = partnersMap[focusedNodeId] || [];
    focusedPartners.forEach(pId => visibleIds.add(pId));

    // 5. Add co-parents (other parent) of the focused node's descendants
    descendants.forEach(dId => {
      const child = findPerson(dId);
      if (child) {
        if (child.father_id) visibleIds.add(child.father_id);
        if (child.mother_id) visibleIds.add(child.mother_id);
      }
    });

    return people.filter(p => visibleIds.has(p.id));
  }, [people, focusedNodeId, myId]);

  // Derived stable positions for all nodes
  const nodePositions = useMemo(() => {
    const coords: { [id: string]: { x: number, y: number, label: string } } = {};
    if (!myId || people.length === 0) return coords;

    const findPerson = (id: string) => people.find(p => p.id === id);

    const getRelLabel = (p: any, fallback: string) => {
      try {
        const meta = p.metadata ? JSON.parse(p.metadata) : {};
        return meta.relationship || fallback;
      } catch {
        return fallback;
      }
    };

    // Find couples via metadata or shared children
    const partnersMap: { [id: string]: string[] } = {};
    const addPartnerMapping = (idA: string, idB: string) => {
      if (!idA || !idB) return;
      if (!partnersMap[idA]) partnersMap[idA] = [];
      if (!partnersMap[idA].includes(idB)) partnersMap[idA].push(idB);
      if (!partnersMap[idB]) partnersMap[idB] = [];
      if (!partnersMap[idB].includes(idA)) partnersMap[idB].push(idA);
    };
    people.forEach(p => {
      const metaPartnerIds = getPartnerIds(p);
      metaPartnerIds.forEach(pId => addPartnerMapping(p.id, pId));
      if (p.father_id && p.mother_id) {
        addPartnerMapping(p.father_id, p.mother_id);
      }
      const meta = p.metadata ? JSON.parse(p.metadata) : {};
      if (meta.relationship === 'Pareja') {
        addPartnerMapping(p.id, myId || '');
      }
    });

    // BFS generations assignment (stable, global)
    const generations: { [id: string]: number } = {};
    generations[myId] = 0;
    const queue = [myId];

    while (queue.length > 0) {
      const currId = queue.shift()!;
      const currGen = generations[currId];
      const p = findPerson(currId);
      if (!p) continue;

      if (p.father_id && generations[p.father_id] === undefined) {
        generations[p.father_id] = currGen - 1;
        queue.push(p.father_id);
      }
      if (p.mother_id && generations[p.mother_id] === undefined) {
        generations[p.mother_id] = currGen - 1;
        queue.push(p.mother_id);
      }
      const children = people.filter(x => x.father_id === currId || x.mother_id === currId);
      children.forEach(child => {
        if (generations[child.id] === undefined) {
          generations[child.id] = currGen + 1;
          queue.push(child.id);
        }
      });
      const partnerIds = partnersMap[currId] || [];
      partnerIds.forEach(partnerId => {
        if (generations[partnerId] === undefined) {
          generations[partnerId] = currGen;
          queue.push(partnerId);
        }
      });
    }

    // Floating/disconnected generation fallback mapping
    const getGenerationFromLabel = (label: string): number => {
      const l = label.toLowerCase();
      if (l.includes('bisabuel')) return -3;
      if (l.includes('abuel')) return -2;
      if (l.includes('padre') || l.includes('madre') || l.includes('tío') || l.includes('tio') || l.includes('suegro') || l.includes('suegra')) return -1;
      if (l.includes('hijo') || l.includes('sobrino') || l.includes('yerno') || l.includes('nuera')) return 1;
      if (l.includes('nieto')) return 2;
      if (l.includes('bisnieto')) return 3;
      return 0;
    };

    people.forEach(p => {
      if (generations[p.id] === undefined) {
        generations[p.id] = getGenerationFromLabel(getRelLabel(p, ''));
      }
    });

    // Initial X positions based on relations
    const initialX: { [id: string]: number } = {};
    initialX[myId] = centerX;

    const placedX = new Set<string>();
    placedX.add(myId);
    const layoutQueue = [myId];

    const rootNode = findPerson(myId);
    const fatherId = rootNode?.father_id;
    const motherId = rootNode?.mother_id;

    while (layoutQueue.length > 0) {
      const currId = layoutQueue.shift()!;
      const currX = initialX[currId];
      const p = findPerson(currId);
      if (!p) continue;

      const gen = generations[currId];
      // spacing gets narrower higher up to fit multiple branches nicely
      const parentSpacing = gen === 0 ? 180 : gen === -1 ? 120 : gen === -2 ? 80 : 60;

      // Position partners next to spouse
      const partnerIds = partnersMap[currId] || [];
      let partnerOffset = 180;
      partnerIds.forEach(partnerId => {
        if (!placedX.has(partnerId)) {
          initialX[partnerId] = currX + partnerOffset;
          placedX.add(partnerId);
          layoutQueue.push(partnerId);
          partnerOffset = partnerOffset > 0 ? -partnerOffset : -partnerOffset + 180;
        }
      });

      // Position parents
      if (p.father_id && !placedX.has(p.father_id)) {
        initialX[p.father_id] = currX - parentSpacing;
        placedX.add(p.father_id);
        layoutQueue.push(p.father_id);
      }
      if (p.mother_id && !placedX.has(p.mother_id)) {
        initialX[p.mother_id] = currX + parentSpacing;
        placedX.add(p.mother_id);
        layoutQueue.push(p.mother_id);
      }

      // Position children grouped by biological parent couples
      const children = people.filter(x => (x.father_id === currId || x.mother_id === currId) && !placedX.has(x.id));
      if (children.length > 0) {
        const groups: { [otherParentId: string]: any[] } = {};
        const individualChildren: any[] = [];

        children.forEach(child => {
          const otherParentId = child.father_id === currId ? child.mother_id : child.father_id;
          if (otherParentId) {
            if (!groups[otherParentId]) groups[otherParentId] = [];
            groups[otherParentId].push(child);
          } else {
            individualChildren.push(child);
          }
        });

        Object.keys(groups).forEach(otherParentId => {
          const groupChildren = groups[otherParentId];
          const hasOtherParentPos = initialX[otherParentId] !== undefined;
          const centerAnchor = hasOtherParentPos ? (currX + initialX[otherParentId]) / 2 : currX;
          const spacing = 180;
          const totalW = (groupChildren.length - 1) * spacing;
          const startX = centerAnchor - totalW / 2;
          groupChildren.forEach((child, idx) => {
            initialX[child.id] = startX + idx * spacing;
            placedX.add(child.id);
            layoutQueue.push(child.id);
          });
        });

        if (individualChildren.length > 0) {
          const spacing = 180;
          const totalW = (individualChildren.length - 1) * spacing;
          const startX = currX - totalW / 2;
          individualChildren.forEach((child, idx) => {
            initialX[child.id] = startX + idx * spacing;
            placedX.add(child.id);
            layoutQueue.push(child.id);
          });
        }
      }
    }

    // Place any remaining floating nodes
    people.forEach(p => {
      if (!placedX.has(p.id)) {
        // Place them based on generation, spread around center
        initialX[p.id] = centerX - 300 + Math.random() * 600;
        placedX.add(p.id);
      }
    });

    // Save target/preferred positions to center around them
    const preferredX = { ...initialX };

    // Spacing Constraint Solver (25 iterations of Relaxation)
    const minDistance = 200;
    const coupleDistance = 170;
    for (let iter = 0; iter < 25; iter++) {
      const genGroups: { [gen: number]: string[] } = {};
      people.forEach(p => {
        const gen = generations[p.id] ?? 0;
        if (!genGroups[gen]) genGroups[gen] = [];
        genGroups[gen].push(p.id);
      });

      Object.keys(genGroups).forEach(genStr => {
        const gen = parseInt(genStr);
        const ids = genGroups[gen];
        if (ids.length <= 1) return;

        ids.sort((a, b) => initialX[a] - initialX[b]);

        // Left-to-right push pass
        for (let i = 0; i < ids.length - 1; i++) {
          const a = ids[i];
          const b = ids[i + 1];
          const aPartners = partnersMap[a] || [];
          const isCouple = aPartners.includes(b) || (partnersMap[b] || []).includes(a);
          const reqDist = isCouple ? coupleDistance : minDistance;
          if (initialX[b] < initialX[a] + reqDist) {
            initialX[b] = initialX[a] + reqDist;
          }
        }

        // Right-to-left push pass
        for (let i = ids.length - 1; i > 0; i--) {
          const a = ids[i];
          const b = ids[i - 1];
          const aPartners = partnersMap[a] || [];
          const isCouple = aPartners.includes(b) || (partnersMap[b] || []).includes(a);
          const reqDist = isCouple ? coupleDistance : minDistance;
          if (initialX[b] > initialX[a] - reqDist) {
            initialX[b] = initialX[a] - reqDist;
          }
        }

        // Center nodes in this generation around the target average position
        let sumCurrentX = 0;
        let sumPreferredX = 0;
        ids.forEach(id => {
          sumCurrentX += initialX[id];
          sumPreferredX += preferredX[id] ?? centerX;
        });
        const offset = (sumPreferredX - sumCurrentX) / ids.length;
        ids.forEach(id => {
          initialX[id] += offset;
        });
      });
    }

    // Assign final coordinates
    people.forEach(p => {
      const gen = generations[p.id] ?? 0;
      const x = initialX[p.id];
      const y = centerY + gen * 140;
      coords[p.id] = { x, y, label: getRelLabel(p, 'Contacto') };
    });

    return coords;
  }, [people, myId]);

  // Derived display labels for visible nodes relative to the clicked/focused node
  const displayLabels = useMemo(() => {
    const labels: { [id: string]: string } = {};
    const refId = focusedNodeId || myId;
    if (!refId || visiblePeople.length === 0) return labels;

    const findPerson = (id: string) => people.find(p => p.id === id);

    // Re-build partnersMap for checking
    const partnersMap: { [id: string]: string[] } = {};
    const addPartnerMapping = (idA: string, idB: string) => {
      if (!idA || !idB) return;
      if (!partnersMap[idA]) partnersMap[idA] = [];
      if (!partnersMap[idA].includes(idB)) partnersMap[idA].push(idB);
      if (!partnersMap[idB]) partnersMap[idB] = [];
      if (!partnersMap[idB].includes(idA)) partnersMap[idB].push(idA);
    };
    people.forEach(p => {
      const metaPartnerIds = getPartnerIds(p);
      metaPartnerIds.forEach(pId => addPartnerMapping(p.id, pId));
      if (p.father_id && p.mother_id) {
        addPartnerMapping(p.father_id, p.mother_id);
      }
      const meta = p.metadata ? JSON.parse(p.metadata) : {};
      if (meta.relationship === 'Pareja') {
        addPartnerMapping(p.id, myId || '');
      }
    });

    const getDynamicRelationshipLabel = (personId: string) => {
      if (personId === refId) {
        return refId === myId ? 'Yo' : 'Enfocado/a';
      }
      
      const refPerson = findPerson(refId);
      const person = findPerson(personId);
      if (!refPerson || !person) return 'Contacto';

      // Is partner?
      const refPartners = partnersMap[refId] || [];
      if (refPartners.includes(personId)) return 'Pareja';

      // Is parent?
      if (refPerson.father_id === personId) return 'Padre';
      if (refPerson.mother_id === personId) return 'Madre';

      // Is child?
      if (person.father_id === refId || person.mother_id === refId) return 'Hijo/a';

      // Is grandparent?
      const fatherNode = refPerson.father_id ? findPerson(refPerson.father_id) : null;
      const motherNode = refPerson.mother_id ? findPerson(refPerson.mother_id) : null;
      if (fatherNode?.father_id === personId || motherNode?.father_id === personId) return 'Abuelo';
      if (fatherNode?.mother_id === personId || motherNode?.mother_id === personId) return 'Abuela';

      // Is sibling?
      if (refPerson.father_id && person.father_id === refPerson.father_id && refPerson.mother_id && person.mother_id === refPerson.mother_id) {
        return 'Hermano/a';
      }

      // If refId is myId, fallback to metadata saved label
      if (refId === myId) {
        try {
          const meta = person.metadata ? JSON.parse(person.metadata) : {};
          return meta.relationship || 'Contacto';
        } catch {
          return 'Contacto';
        }
      }

      // Check partner of parents
      if (fatherNode) {
        const fatherPartners = partnersMap[fatherNode.id] || [];
        if (fatherPartners.includes(personId)) return 'Pareja de mi Padre';
      }
      if (motherNode) {
        const motherPartners = partnersMap[motherNode.id] || [];
        if (motherPartners.includes(personId)) return 'Pareja de mi Madre';
      }

      return 'Familiar';
    };

    visiblePeople.forEach(p => {
      labels[p.id] = getDynamicRelationshipLabel(p.id);
    });

    return labels;
  }, [people, visiblePeople, focusedNodeId, myId]);

  const findFreePosition = (targetX: number, targetY: number, preferDir: 'left' | 'right' | 'down' | 'up', focusedId: string) => {
    let testX = targetX;
    let testY = targetY;

    const isCollision = (tx: number, ty: number) => {
      // Check collision with all visiblePeople nodes
      return visiblePeople.some(node => {
        if (node.id === focusedId) return false;
        const nPos = nodePositions[node.id];
        if (!nPos) return false;
        const dx = Math.abs(nPos.x - tx);
        const dy = Math.abs(nPos.y - ty);
        return dx < 95 && dy < 110;
      });
    };

    let step = 0;
    const maxSteps = 15;
    while (isCollision(testX, testY) && step < maxSteps) {
      step++;
      if (preferDir === 'left') {
        testX -= 70;
      } else if (preferDir === 'right') {
        testX += 70;
      } else if (preferDir === 'down') {
        testY += 70;
      } else if (preferDir === 'up') {
        testY -= 70;
      }
      
      if (step === 6) {
        if (preferDir === 'left' || preferDir === 'right') {
          testY -= 80;
          testX = targetX;
        } else {
          testX += 80;
          testY = targetY;
        }
      }
    }
    return { x: testX, y: testY };
  };

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

    // Build partnersMap inside renderAllLines to know the couples
    const partnersMap: { [id: string]: string[] } = {};
    const addPartnerMapping = (idA: string, idB: string) => {
      if (!idA || !idB) return;
      if (!partnersMap[idA]) partnersMap[idA] = [];
      if (!partnersMap[idA].includes(idB)) partnersMap[idA].push(idB);
      if (!partnersMap[idB]) partnersMap[idB] = [];
      if (!partnersMap[idB].includes(idA)) partnersMap[idB].push(idA);
    };
    people.forEach(p => {
      const metaPartnerIds = getPartnerIds(p);
      metaPartnerIds.forEach(pId => addPartnerMapping(p.id, pId));
      if (p.father_id && p.mother_id) {
        addPartnerMapping(p.father_id, p.mother_id);
      }
      const meta = p.metadata ? JSON.parse(p.metadata) : {};
      if (meta.relationship === 'Pareja') {
        addPartnerMapping(p.id, myId || '');
      }
    });

    // Draw couple lines (only draw once per couple by ordering IDs)
    const drawnCouples = new Set<string>();
    const visibleIds = new Set(visiblePeople.map(x => x.id));

    visiblePeople.forEach(p => {
      const partnerIds = partnersMap[p.id] || [];
      partnerIds.forEach(partnerId => {
        if (visibleIds.has(partnerId)) {
          const key = [p.id, partnerId].sort().join('-');
          if (!drawnCouples.has(key)) {
            drawnCouples.add(key);
            const pPos = nodePositions[p.id];
            const partPos = nodePositions[partnerId];
            if (pPos && partPos && pPos.y === partPos.y) {
              lines.push(
                <View
                  key={`couple-${keyCount++}`}
                  style={[
                    styles.connectorLine,
                    styles.dashedConnector,
                    {
                      left: Math.min(pPos.x, partPos.x) + 35,
                      top: pPos.y,
                      width: Math.abs(pPos.x - partPos.x) - 70,
                      height: 2,
                    }
                  ]}
                />
              );
            }
          }
        }
      });
    });

    // 1. Draw actual family lines
    visiblePeople.forEach((p) => {
      const pPos = nodePositions[p.id];
      if (!pPos) return;

      // Check if this is a joint child
      if (p.father_id && p.mother_id && visibleIds.has(p.father_id) && visibleIds.has(p.mother_id)) {
        const fPos = nodePositions[p.father_id];
        const mPos = nodePositions[p.mother_id];
        if (fPos && mPos && fPos.y === mPos.y) {
          const parentMidX = (fPos.x + mPos.x) / 2;
          const parentY = fPos.y;
          const midY = (parentY + pPos.y) / 2;
          
          lines.push(
            <View
              key={`line-joint-v1-${p.id}-${keyCount++}`}
              style={[
                styles.connectorLine,
                {
                  left: parentMidX,
                  top: parentY,
                  width: 2,
                  height: midY - parentY,
                }
              ]}
            />
          );
          lines.push(
            <View
              key={`line-joint-h-${p.id}-${keyCount++}`}
              style={[
                styles.connectorLine,
                {
                  left: Math.min(parentMidX, pPos.x),
                  top: midY,
                  width: Math.abs(parentMidX - pPos.x) + 2,
                  height: 2,
                }
              ]}
            />
          );
          lines.push(
            <View
              key={`line-joint-v2-${p.id}-${keyCount++}`}
              style={[
                styles.connectorLine,
                {
                  left: pPos.x,
                  top: midY,
                  width: 2,
                  height: pPos.y - midY,
                }
              ]}
            />
          );
          return;
        }
      }

      if (p.father_id && visibleIds.has(p.father_id)) {
        const fPos = nodePositions[p.father_id];
        if (fPos) {
          lines.push(...renderOrthogonalLine(pPos.x, pPos.y, fPos.x, fPos.y, `line-father-${p.id}-${keyCount++}`));
        }
      }
      if (p.mother_id && visibleIds.has(p.mother_id)) {
        const mPos = nodePositions[p.mother_id];
        if (mPos) {
          lines.push(...renderOrthogonalLine(pPos.x, pPos.y, mPos.x, mPos.y, `line-mother-${p.id}-${keyCount++}`));
        }
      }
    });

    // 2. Draw lines to active "+" bubbles of the focused node (hidden on zoom out)
    if (!isZoomedOut && focusedNodeId) {
      const p = visiblePeople.find(x => x.id === focusedNodeId);
      const pos = nodePositions[focusedNodeId];
      if (p && pos) {
        if (!p.father_id) {
          const freePos = findFreePosition(pos.x - 80, pos.y - 120, 'left', focusedNodeId);
          lines.push(...renderOrthogonalLine(pos.x, pos.y, freePos.x, freePos.y, `line-add-father-${p.id}`, true));
        }
        if (!p.mother_id) {
          const freePos = findFreePosition(pos.x + 80, pos.y - 120, 'right', focusedNodeId);
          lines.push(...renderOrthogonalLine(pos.x, pos.y, freePos.x, freePos.y, `line-add-mother-${p.id}`, true));
        }
        // Always draw line to "+" Añadir Pareja bubble
        const freePartnerPos = findFreePosition(pos.x + 115, pos.y, 'right', focusedNodeId);
        lines.push(...renderOrthogonalLine(pos.x, pos.y, freePartnerPos.x, freePartnerPos.y, `line-add-partner-${p.id}`, true));
      }
    }

    return lines;
  };

  const handleNodePress = (nodeId: string) => {
    setFocusedNodeId(nodeId);
    const pos = nodePositions[nodeId];
    if (pos) {
      centerOnNode(pos.x, pos.y);
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

      const meta: any = {
        nickname: editNickname.trim(),
        relationship: editRelationship,
        avatar_url: finalAvatarUrl,
        username: finalUsername,
        user_id: targetUserId || (selectedPerson ? JSON.parse(selectedPerson.metadata || '{}').user_id : null),
        is_linked: linkStatus,
        connection_status: linkStatus ? 'ACCEPTED' : connStatus,
        birth_decade: birthDecadeVal,
      };

      const isFemale = (pNode: any) => {
        if (!pNode) return false;
        const pMeta = pNode.metadata ? JSON.parse(pNode.metadata) : {};
        const rel = (pMeta.relationship || '').toLowerCase();
        return rel.includes('madre') || rel.includes('tía') || rel.includes('tia') || rel.includes('abuela') || rel.includes('prima') || rel.includes('hermana') || rel.includes('mujer');
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
        let insertFatherId = editFatherId;
        let insertMotherId = editMotherId;

        if (pendingLink && pendingLink.role === 'joint_child') {
          const parentA = people.find(p => p.id === pendingLink.parentId);
          const parentB = pendingLink.partnerId ? people.find(p => p.id === pendingLink.partnerId) : null;
          if (isFemale(parentA)) {
            insertMotherId = parentA?.id || null;
            insertFatherId = parentB?.id || null;
          } else {
            insertFatherId = parentA?.id || null;
            insertMotherId = parentB?.id || null;
          }
        }

        await db.runAsync(
          "INSERT INTO entities (id, type, name, metadata, father_id, mother_id, birth_date, is_confirmed) VALUES (?, 'PERSON', ?, ?, ?, ?, ?, 1)",
          targetEntityId,
          finalName,
          JSON.stringify(meta),
          insertFatherId,
          insertMotherId,
          finalBirthDate
        );

        // If we opened this modal via a '+' direct link bubble, link it up now
        if (pendingLink) {
          if (pendingLink.role === 'father') {
            await db.runAsync("UPDATE entities SET father_id = ? WHERE id = ?", targetEntityId, pendingLink.childId ?? null);
          } else if (pendingLink.role === 'mother') {
            await db.runAsync("UPDATE entities SET mother_id = ? WHERE id = ?", targetEntityId, pendingLink.childId ?? null);
          } else if (pendingLink.role === 'partner') {
            // Reciprocal partner linking
            const newPartnerId = pendingLink.parentId;
            if (newPartnerId) {
              const targetPartners = meta.partner_ids || [];
              if (meta.partner_id && !targetPartners.includes(meta.partner_id)) {
                targetPartners.push(meta.partner_id);
              }
              if (!targetPartners.includes(newPartnerId)) {
                targetPartners.push(newPartnerId);
              }
              meta.partner_ids = targetPartners;
              meta.partner_id = newPartnerId; // fallback
              await db.runAsync("UPDATE entities SET metadata = ? WHERE id = ?", JSON.stringify(meta), targetEntityId);
              
              const spouseNode = people.find(x => x.id === newPartnerId);
              if (spouseNode) {
                const spouseMeta = spouseNode.metadata ? JSON.parse(spouseNode.metadata) : {};
                const spousePartners = spouseMeta.partner_ids || [];
                if (spouseMeta.partner_id && !spousePartners.includes(spouseMeta.partner_id)) {
                  spousePartners.push(spouseMeta.partner_id);
                }
                if (!spousePartners.includes(targetEntityId)) {
                  spousePartners.push(targetEntityId);
                }
                spouseMeta.partner_ids = spousePartners;
                spouseMeta.partner_id = targetEntityId; // fallback
                await db.runAsync("UPDATE entities SET metadata = ? WHERE id = ?", JSON.stringify(spouseMeta), newPartnerId);
              }
            }
          } else if (pendingLink.role === 'child' && pendingLink.parentId) {
            // Check if parent is female or male to assign correctly
            const parent = people.find(p => p.id === pendingLink.parentId);
            if (isFemale(parent)) {
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

      const deletedNicknames = oldNicknames.filter((n: string) => !newNicknames.some((newN: string) => newN.toLowerCase() === n.toLowerCase()));
      for (const alias of deletedNicknames) {
        await db.runAsync("DELETE FROM entity_aliases WHERE entity_id = ? AND alias = ? COLLATE NOCASE", targetEntityId, alias);
      }

      const addedNicknames = newNicknames.filter((n: string) => !oldNicknames.some((oldN: string) => oldN.toLowerCase() === n.toLowerCase()));
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
      } else if (preLink.role === 'partner') {
        setEditRelationship(getRelationForPartner(preLink.parentId || ''));
      } else if (preLink.role === 'joint_child' && preLink.parentId) {
        setEditRelationship(getRelationForChild(preLink.parentId));
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
    .minDistance(10)
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
    const yoX = 700;
    const yoY = 600;

    const yoScreenX = yoX + translateX.value;
    const yoScreenY = yoY + translateY.value;

    const w = containerWidth;
    const h = containerHeight;
    const margin = 24;

    const isOffScreen = yoScreenX < 0 || yoScreenX > w || yoScreenY < 0 || yoScreenY > h;

    const badgeX = Math.max(margin, Math.min(w - margin - 40, yoScreenX));
    const hasPanel = focusedNodeId !== null;
    const bottomMargin = hasPanel ? 160 : 100;
    const badgeY = Math.max(margin, Math.min(h - bottomMargin - 40, yoScreenY));

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
              {visiblePeople.map((person) => {
                const pos = nodePositions[person.id];
                if (!pos) return null;
                const isFocused = focusedNodeId === person.id;
                const meta = person.metadata ? JSON.parse(person.metadata) : {};

                return (
                  <TouchableOpacity 
                    key={`node-${person.id}`} 
                    activeOpacity={0.8}
                    onPress={() => handleNodePress(person.id)}
                    style={[
                      styles.nodeWrapper, 
                      { left: pos.x - 37.5, top: pos.y - 37.5 },
                      isFocused && { zIndex: 10 }
                    ]}
                  >
                    <View 
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
                    </View>
                    <ZoomCompensatedText 
                      scale={scale} 
                      name={person.name} 
                      subtitle={meta.nickname || displayLabels[person.id] || ''} 
                      isZoomedOut={isZoomedOut} 
                    />
                  </TouchableOpacity>
                );
              })}

              {/* DYNAMIC ADD BRANCH (+) BUBBLES */}
              {!isZoomedOut && focusedNodeId && (() => {
                const p = visiblePeople.find(x => x.id === focusedNodeId);
                const pos = nodePositions[focusedNodeId];
                if (!p || !pos) return null;

                const addButtons = [];

                // Re-build partnersMap for checking in branch rendering
                const partnersMap: { [id: string]: string[] } = {};
                const addPartnerMapping = (idA: string, idB: string) => {
                  if (!idA || !idB) return;
                  if (!partnersMap[idA]) partnersMap[idA] = [];
                  if (!partnersMap[idA].includes(idB)) partnersMap[idA].push(idB);
                  if (!partnersMap[idB]) partnersMap[idB] = [];
                  if (!partnersMap[idB].includes(idA)) partnersMap[idB].push(idA);
                };
                visiblePeople.forEach(x => {
                  const metaPartnerIds = getPartnerIds(x);
                  metaPartnerIds.forEach(pId => addPartnerMapping(x.id, pId));
                  if (x.father_id && x.mother_id) {
                    addPartnerMapping(x.father_id, x.mother_id);
                  }
                  const meta = x.metadata ? JSON.parse(x.metadata) : {};
                  if (meta.relationship === 'Pareja') {
                    addPartnerMapping(x.id, myId || '');
                  }
                });

                const partnerIds = partnersMap[p.id] || [];

                if (!p.father_id) {
                  const freePos = findFreePosition(pos.x - 80, pos.y - 120, 'left', focusedNodeId);
                  addButtons.push(
                    <View key="add-father" style={[styles.nodeWrapper, { left: freePos.x - 37.5, top: freePos.y - 37.5 }]}>
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
                  const freePos = findFreePosition(pos.x + 80, pos.y - 120, 'right', focusedNodeId);
                  addButtons.push(
                    <View key="add-mother" style={[styles.nodeWrapper, { left: freePos.x - 37.5, top: freePos.y - 37.5 }]}>
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

                // Always allow adding a partner (Añadir Pareja)
                let searchPartnerX = pos.x;
                partnerIds.forEach(pId => {
                  const partnerPos = nodePositions[pId];
                  if (partnerPos && partnerPos.x > searchPartnerX) {
                    searchPartnerX = partnerPos.x;
                  }
                });
                const freePartnerPos = findFreePosition(searchPartnerX + 115, pos.y, 'right', focusedNodeId);
                addButtons.push(
                  <View key="add-partner" style={[styles.nodeWrapper, { left: freePartnerPos.x - 37.5, top: freePartnerPos.y - 37.5 }]}>
                    <TouchableOpacity 
                      activeOpacity={0.8} 
                      onPress={() => openCreateModal({ parentId: p.id, role: 'partner' })}
                      style={styles.plusBubble}
                    >
                      <IconButton icon="plus" size={24} iconColor="#7b1fa2" />
                    </TouchableOpacity>
                    <ZoomCompensatedLabel scale={scale} label="Añadir Pareja" />
                  </View>
                );

                // Render Hijo en Común for all partners
                partnerIds.forEach(partnerId => {
                  const partnerPos = nodePositions[partnerId];
                  if (partnerPos) {
                    const midX = (pos.x + partnerPos.x) / 2;
                    const midY = pos.y + 70;
                    const coupleKey = [p.id, partnerId].sort().join('-');
                    addButtons.push(
                      <View key={`add-joint-child-${coupleKey}`} style={[styles.nodeWrapper, { left: midX - 37.5, top: midY - 37.5 }]}>
                        <TouchableOpacity 
                          activeOpacity={0.8} 
                          onPress={() => openCreateModal({ parentId: p.id, partnerId: partnerId, role: 'joint_child' })}
                          style={[styles.plusBubble, { backgroundColor: '#e8def8', borderColor: '#6200ee' }]}
                        >
                          <IconButton icon="account-multiple-plus" size={24} iconColor="#6200ee" />
                        </TouchableOpacity>
                        <ZoomCompensatedLabel scale={scale} label="Hijo en Común" />
                      </View>
                    );
                  }
                });

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
                  onPress={() => centerOnNode(700, 600)}
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
