import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Dimensions, Modal, ActivityIndicator } from 'react-native';
import { Text, IconButton, Button, Appbar, Portal } from 'react-native-paper';
import { getDb } from '../core/database';
import { v4 as uuidv4 } from 'uuid';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const COLUMN_WIDTH = SCREEN_WIDTH / 2;

// Alturas base para la unidad de la derecha en cada nivel
const ROW_HEIGHT = 60; // Pixeles por fila unitaria

interface TimeEntity {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_custom_period: number;
}

interface TimeCascadeSelectorProps {
  visible: boolean;
  onClose: () => void;
  onSelectTime: (entity: any) => void;
  onManageCustom: () => void;
}

const parseDateStr = (dateStr: string) => {
  const parts = dateStr.split('-');
  return new Date(parseInt(parts[0]), parseInt(parts[1] || '1') - 1, parseInt(parts[2] || '1'));
};

const getDaysBetween = (start: Date, end: Date) => {
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
};

export default function TimeCascadeSelector({ visible, onClose, onSelectTime, onManageCustom }: TimeCascadeSelectorProps) {
  const [loading, setLoading] = useState(true);
  const [stages, setStages] = useState<TimeEntity[]>([]);
  const [customPeriods, setCustomPeriods] = useState<TimeEntity[]>([]);
  const [startYear, setStartYear] = useState(1990);
  const [endYear, setEndYear] = useState(new Date().getFullYear());
  
  // Paginación horizontal (Zoom Level)
  const [zoomLevel, setZoomLevel] = useState(0); 
  // 0: Etapas Generales | Etapas Personalizadas
  // 1: Etapas Personalizadas | Años
  // 2: Años | Meses
  // 3: Meses | Días

  // Virtualization state
  const [scrollY, setScrollY] = useState(0);
  const scrollViewRef = useRef<ScrollView>(null);
  const horizontalScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (visible) {
      loadData();
    }
  }, [visible]);

  const loadData = async () => {
    setLoading(true);
    const db = await getDb();
    
    // Get profile to find start year
    const profile = await db.getFirstAsync<any>('SELECT birth_date FROM user_profile LIMIT 1');
    let bYear = 1990;
    if (profile?.birth_date) {
      bYear = parseInt(profile.birth_date.split('-')[0]);
    }
    setStartYear(bYear);
    setEndYear(new Date().getFullYear());

    // Load entities
    const entities = await db.getAllAsync<any>("SELECT id, name, metadata FROM entities WHERE type = 'TIME'");
    
    const general: TimeEntity[] = [];
    const custom: TimeEntity[] = [];

    for (const e of entities) {
      if (e.metadata) {
        try {
          const meta = typeof e.metadata === 'string' ? JSON.parse(e.metadata) : e.metadata;
          if (meta.start_date && meta.end_date) {
            const mapped = {
              id: e.id,
              name: e.name,
              start_date: meta.start_date,
              end_date: meta.end_date,
              is_custom_period: meta.is_custom_period || 0
            };
            if (mapped.is_custom_period === 1) {
              custom.push(mapped);
            } else {
              general.push(mapped);
            }
          }
        } catch (err) {}
      }
    }
    
    // Sort by start_date
    general.sort((a, b) => a.start_date.localeCompare(b.start_date));
    custom.sort((a, b) => a.start_date.localeCompare(b.start_date));
    
    setStages(general);
    setCustomPeriods(custom);
    setLoading(false);
  };

  const handleScroll = (e: any) => {
    setScrollY(e.nativeEvent.contentOffset.y);
  };

  const handleHorizontalScroll = (e: any) => {
    const x = e.nativeEvent.contentOffset.x;
    const page = Math.round(x / SCREEN_WIDTH);
    if (page !== zoomLevel) {
      setZoomLevel(page);
    }
  };

  // --- MEMOIZED DATA GENERATION ---
  
  const baseStartDate = useMemo(() => new Date(startYear, 0, 1), [startYear]);
  const baseEndDate = useMemo(() => new Date(endYear, 11, 31), [endYear]);
  const totalDaysLife = useMemo(() => getDaysBetween(baseStartDate, baseEndDate), [baseStartDate, baseEndDate]);
  const totalMonthsLife = (endYear - startYear + 1) * 12;
  const totalYearsLife = endYear - startYear + 1;

  // Render helpers
  const renderVirtualItem = (
    key: string,
    label: string, 
    yPos: number, 
    height: number, 
    isLeft: boolean, 
    dataPayload: any
  ) => {
    // Virtualization check: Render only if visible within window + buffer
    const isVisible = (yPos + height > scrollY - 500) && (yPos < scrollY + SCREEN_HEIGHT + 500);
    if (!isVisible) return null;

    return (
      <TouchableOpacity 
        key={key}
        activeOpacity={0.7}
        onPress={() => onSelectTime(dataPayload)}
        style={[
          styles.itemContainer, 
          { 
            top: yPos, 
            height: Math.max(height, 20), // Minimum visible height
            left: isLeft ? 0 : COLUMN_WIDTH,
            width: COLUMN_WIDTH,
            backgroundColor: isLeft ? '#f0f4c3' : '#e8f5e9',
            borderRightWidth: isLeft ? 1 : 0,
          }
        ]}
      >
        <Text style={styles.itemText} numberOfLines={2} adjustsFontSizeToFit>{label}</Text>
      </TouchableOpacity>
    );
  };

  // --- CALCULATE HEIGHTS AND POSITIONS BASED ON ZOOM LEVEL ---
  
  const renderLevel0 = () => {
    // Scale: 1 Year = ROW_HEIGHT
    // Total Height: totalYearsLife * ROW_HEIGHT
    const scaleDaysToPx = (ROW_HEIGHT * 12 * 30) / 360; // Approx 1 year = 360 days for simple scaling
    const yearToPx = ROW_HEIGHT;
    const totalHeight = totalYearsLife * yearToPx;

    const items = [];
    
    // Left: General
    stages.forEach((stg) => {
      const sY = parseInt(stg.start_date.split('-')[0]) - startYear;
      const eY = parseInt(stg.end_date.split('-')[0]) - startYear;
      const yPos = sY * yearToPx;
      const h = ((eY - sY) + 1) * yearToPx;
      items.push(renderVirtualItem(`gen-${stg.id}`, stg.name, yPos, h, true, stg));
    });

    // Right: Custom
    customPeriods.forEach((stg) => {
      const sY = parseInt(stg.start_date.split('-')[0]) - startYear;
      const eY = parseInt(stg.end_date.split('-')[0]) - startYear;
      const yPos = sY * yearToPx;
      const h = ((eY - sY) + 1) * yearToPx;
      items.push(renderVirtualItem(`cust-${stg.id}`, stg.name, yPos, h, false, stg));
    });

    if (customPeriods.length === 0) {
      items.push(
        <View key="no-custom" style={{ position: 'absolute', left: COLUMN_WIDTH, top: 200, width: COLUMN_WIDTH, padding: 20, alignItems: 'center' }}>
          <Text style={{ textAlign: 'center', color: '#888' }}>No hay periodos personalizados</Text>
          <Button mode="outlined" onPress={onManageCustom} style={{ marginTop: 10 }}>Crear Uno</Button>
        </View>
      );
    }

    return { totalHeight, items };
  };

  const renderLevel1 = () => {
    // Scale: 1 Year = ROW_HEIGHT
    const yearToPx = ROW_HEIGHT;
    const totalHeight = totalYearsLife * yearToPx;
    const items = [];

    // Left: Custom
    customPeriods.forEach((stg) => {
      const sY = parseInt(stg.start_date.split('-')[0]) - startYear;
      const eY = parseInt(stg.end_date.split('-')[0]) - startYear;
      const yPos = sY * yearToPx;
      const h = ((eY - sY) + 1) * yearToPx;
      items.push(renderVirtualItem(`cust-${stg.id}`, stg.name, yPos, h, true, stg));
    });

    // Right: Years
    for (let y = 0; y < totalYearsLife; y++) {
      const actualYear = startYear + y;
      const yPos = y * yearToPx;
      const payload = {
        name: `Año ${actualYear}`,
        start_date: `${actualYear}-01-01`,
        end_date: `${actualYear}-12-31`,
        is_custom_period: 0
      };
      items.push(renderVirtualItem(`yr-${actualYear}`, String(actualYear), yPos, yearToPx, false, payload));
    }

    return { totalHeight, items };
  };

  const renderLevel2 = () => {
    // Scale: 1 Month = ROW_HEIGHT
    // 1 Year = 12 * ROW_HEIGHT
    const monthToPx = ROW_HEIGHT;
    const yearToPx = 12 * monthToPx;
    const totalHeight = totalYearsLife * yearToPx;
    const items = [];

    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    // Left: Years
    for (let y = 0; y < totalYearsLife; y++) {
      const actualYear = startYear + y;
      const yPos = y * yearToPx;
      const payload = {
        name: `Año ${actualYear}`,
        start_date: `${actualYear}-01-01`,
        end_date: `${actualYear}-12-31`,
        is_custom_period: 0
      };
      items.push(renderVirtualItem(`yr-${actualYear}`, String(actualYear), yPos, yearToPx, true, payload));
      
      // Right: Months (Optimization: only loop if year is visible)
      if (yPos + yearToPx > scrollY - 500 && yPos < scrollY + SCREEN_HEIGHT + 500) {
        for (let m = 0; m < 12; m++) {
          const myPos = yPos + (m * monthToPx);
          const mm = String(m + 1).padStart(2, '0');
          const payloadMonth = {
            name: `${monthNames[m]} ${actualYear}`,
            start_date: `${actualYear}-${mm}-01`,
            end_date: `${actualYear}-${mm}-28`, // simplificado para no calcular ultimo dia aqui
            is_custom_period: 0
          };
          items.push(renderVirtualItem(`mo-${actualYear}-${m}`, monthNames[m], myPos, monthToPx, false, payloadMonth));
        }
      }
    }

    return { totalHeight, items };
  };

  const renderLevel3 = () => {
    // Scale: 1 Day = ROW_HEIGHT
    const dayToPx = ROW_HEIGHT;
    const items = [];
    let currentYPos = 0;

    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    for (let y = 0; y < totalYearsLife; y++) {
      const actualYear = startYear + y;
      
      for (let m = 0; m < 12; m++) {
        const daysInMonth = new Date(actualYear, m + 1, 0).getDate();
        const monthHeight = daysInMonth * dayToPx;
        
        // Is month visible?
        if (currentYPos + monthHeight > scrollY - 500 && currentYPos < scrollY + SCREEN_HEIGHT + 500) {
          // Render Left: Month
          const mm = String(m + 1).padStart(2, '0');
          const payloadMonth = {
            name: `${monthNames[m]} ${actualYear}`,
            start_date: `${actualYear}-${mm}-01`,
            end_date: `${actualYear}-${mm}-${daysInMonth}`,
            is_custom_period: 0
          };
          items.push(renderVirtualItem(`mo-${actualYear}-${m}`, payloadMonth.name, currentYPos, monthHeight, true, payloadMonth));

          // Render Right: Days
          for (let d = 1; d <= daysInMonth; d++) {
            const dyPos = currentYPos + ((d - 1) * dayToPx);
            const dd = String(d).padStart(2, '0');
            const payloadDay = {
              name: `${d} ${monthNames[m]} ${actualYear}`,
              start_date: `${actualYear}-${mm}-${dd}`,
              end_date: `${actualYear}-${mm}-${dd}`,
              is_custom_period: 0
            };
            items.push(renderVirtualItem(`day-${actualYear}-${m}-${d}`, String(d), dyPos, dayToPx, false, payloadDay));
          }
        }
        
        currentYPos += monthHeight;
      }
    }

    return { totalHeight: currentYPos, items };
  };

  const renderCurrentLevel = () => {
    switch (zoomLevel) {
      case 0: return renderLevel0();
      case 1: return renderLevel1();
      case 2: return renderLevel2();
      case 3: return renderLevel3();
      default: return { totalHeight: 1000, items: [] };
    }
  };

  const currentData = loading ? { totalHeight: 0, items: [] } : renderCurrentLevel();

  return (
    <Portal>
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <Appbar.Header style={{ backgroundColor: '#2e7d32' }}>
          <Appbar.Action icon="close" color="white" onPress={onClose} />
          <Appbar.Content title="Seleccionar Momento" color="white" />
          <Appbar.Action icon="pencil-outline" color="white" onPress={onManageCustom} />
        </Appbar.Header>
        
        <View style={styles.headerRow}>
          <Text style={styles.colHeader}>{zoomLevel === 0 ? 'Etapas Vida' : zoomLevel === 1 ? 'Etapas Personales' : zoomLevel === 2 ? 'Años' : 'Meses'}</Text>
          <Text style={styles.colHeader}>{zoomLevel === 0 ? 'Etapas Personales' : zoomLevel === 1 ? 'Años' : zoomLevel === 2 ? 'Meses' : 'Días'}</Text>
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color="#2e7d32" />
          </View>
        ) : (
          <ScrollView 
            horizontal 
            pagingEnabled 
            ref={horizontalScrollRef}
            onMomentumScrollEnd={handleHorizontalScroll}
            showsHorizontalScrollIndicator={false}
            style={styles.horizontalScroll}
          >
            {[0, 1, 2, 3].map((pageIndex) => (
              <View key={`page-${pageIndex}`} style={styles.pageContainer}>
                {zoomLevel === pageIndex && (
                  <ScrollView
                    ref={scrollViewRef}
                    onScroll={handleScroll}
                    scrollEventThrottle={16}
                    contentContainerStyle={{ height: currentData.totalHeight }}
                    style={styles.verticalScroll}
                  >
                    {currentData.items}
                  </ScrollView>
                )}
              </View>
            ))}
          </ScrollView>
        )}
        
        <View style={styles.pagination}>
          {[0, 1, 2, 3].map(i => (
            <View key={i} style={[styles.dot, zoomLevel === i && styles.dotActive]} />
          ))}
        </View>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    elevation: 2,
  },
  colHeader: {
    width: COLUMN_WIDTH,
    textAlign: 'center',
    paddingVertical: 12,
    fontWeight: 'bold',
    color: '#2e7d32',
    borderRightWidth: 1,
    borderRightColor: '#eee'
  },
  horizontalScroll: {
    flex: 1,
    backgroundColor: '#fafafa',
  },
  pageContainer: {
    width: SCREEN_WIDTH,
    flex: 1,
  },
  verticalScroll: {
    flex: 1,
  },
  itemContainer: {
    position: 'absolute',
    borderBottomWidth: 1,
    borderBottomColor: '#c8e6c9',
    borderColor: '#c8e6c9',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 10,
    overflow: 'hidden'
  },
  itemText: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
    textAlign: 'center'
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderTopColor: '#eee'
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ccc',
    marginHorizontal: 5
  },
  dotActive: {
    backgroundColor: '#2e7d32',
    width: 10,
    height: 10,
  }
});
