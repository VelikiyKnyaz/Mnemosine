import { supabase } from './supabase';
import { getDb } from './database';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

/**
 * Synchronizes accepted connections from Supabase to local SQLite database.
 * If a new connection is accepted, it creates a local PERSON node and an inbox task.
 * If a connection is already present locally, it updates the remote-synced details.
 */
export async function syncConnections(myId: string | undefined): Promise<void> {
  if (!myId) return;

  try {
    const db = await getDb();

    // 1. Fetch all connections (pending or accepted) involving the current user
    const { data: connections, error: connError } = await supabase
      .from('connections')
      .select('*')
      .or(`sender_id.eq.${myId},receiver_id.eq.${myId}`);

    if (connError) {
      console.warn('[Social Sync] Error fetching connections:', connError);
      return;
    }

    // 2. Extract unique friend IDs
    const friendIds = connections ? connections.map((c: any) => 
      c.sender_id === myId ? c.receiver_id : c.sender_id
    ) : [];

    // 3. Fetch all local PERSON entities to compare and prune deleted links
    const localPeople = await db.getAllAsync<any>("SELECT * FROM entities WHERE type = 'PERSON'");

    // 3.5. Unlink any local node that is marked as linked or pending, but is NO LONGER in friendIds
    for (const p of localPeople) {
      if (p.metadata) {
        try {
          const meta = JSON.parse(p.metadata);
          if ((meta.is_linked || meta.connection_status) && meta.user_id && !friendIds.includes(meta.user_id)) {
            // This person was unlinked remotely!
            meta.is_linked = false;
            meta.user_id = null;
            meta.username = '';
            meta.connection_status = null;
            
            await db.runAsync(
              "UPDATE entities SET metadata = ? WHERE id = ?",
              JSON.stringify(meta),
              p.id
            );
          }
        } catch (_) {}
      }
    }

    if (friendIds.length === 0) {
      return;
    }

    // 4. Fetch profiles of these friends from Supabase
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, username, full_name, avatar_url')
      .in('id', friendIds);

    if (profileError) {
      console.warn('[Social Sync] Error fetching friend profiles:', profileError);
      return;
    }

    if (!profiles || profiles.length === 0) {
      return;
    }

    // Construir mapa de perfiles para acceso rápido
    const profilesMap = new Map();
    for (const profile of profiles) {
      profilesMap.set(profile.id, profile);
    }

    // 5. Procesar cada conexión activa y sincronizar el estado
    for (const conn of connections || []) {
      const friendId = conn.sender_id === myId ? conn.receiver_id : conn.sender_id;
      const profile = profilesMap.get(friendId);
      if (!profile) continue;

      const isAccepted = conn.status === 'ACCEPTED';
      const connectionStatus = isAccepted
        ? 'ACCEPTED'
        : (conn.sender_id === myId ? 'PENDING_SENT' : 'PENDING_RECEIVED');
      const isLinked = isAccepted;

      const remoteName = profile.full_name || `@${profile.username}`;
      const rawAvatar = profile.avatar_url || '';
      const remoteAvatar = rawAvatar.startsWith('http') 
        ? rawAvatar 
        : `https://api.dicebear.com/7.x/adventurer/png?seed=${profile.username}`;

      // Check if this friend is already linked to a local node (Priority Matching)
      let existingNode = null;

      // Prioridad 1: Buscar por exact user_id
      for (const p of localPeople) {
        if (p.metadata) {
          try {
            const meta = JSON.parse(p.metadata);
            if (meta.user_id === friendId) {
              existingNode = p;
              break;
            }
          } catch (_) {}
        }
      }

      // Prioridad 2: Buscar por username local (en minúsculas, sólo si no está asociado a otro user_id)
      if (!existingNode) {
        for (const p of localPeople) {
          if (p.metadata) {
            try {
              const meta = JSON.parse(p.metadata);
              if (!meta.user_id && meta.username && meta.username.toLowerCase() === profile.username.toLowerCase()) {
                existingNode = p;
                break;
              }
            } catch (_) {}
          }
        }
      }

      // Prioridad 3: Buscar por coincidencia exacta de nombre local con el nombre o username de Supabase
      if (!existingNode) {
        for (const p of localPeople) {
          const nameLower = p.name ? p.name.trim().toLowerCase() : '';
          const profileNameLower = profile.full_name ? profile.full_name.trim().toLowerCase() : '';
          const profileUsernameLower = profile.username ? profile.username.trim().toLowerCase() : '';
          const formattedUsernameLower = `@${profileUsernameLower}`;

          let hasUserId = false;
          try {
            const meta = p.metadata ? JSON.parse(p.metadata) : {};
            if (meta.user_id) hasUserId = true;
          } catch (_) {}

          if (!hasUserId && (
            nameLower === profileNameLower ||
            nameLower === profileUsernameLower ||
            nameLower === formattedUsernameLower
          )) {
            existingNode = p;
            break;
          }
        }
      }

      if (existingNode) {
        // Node exists -> sync details
        const currentMeta = JSON.parse(existingNode.metadata || '{}');
        const updatedMeta = {
          ...currentMeta,
          user_id: friendId,
          avatar_url: remoteAvatar,
          username: profile.username,
          is_linked: isLinked,
          connection_status: connectionStatus,
        };

        const nameToSave = isAccepted ? remoteName : (existingNode.name || remoteName);

        await db.runAsync(
          "UPDATE entities SET name = ?, metadata = ? WHERE id = ?",
          nameToSave,
          JSON.stringify(updatedMeta),
          existingNode.id
        );

        // Si la conexión es aceptada, verificar si ya se creó la tarea de parentesco. Si no, crearla.
        if (isAccepted) {
          const existingTask = await db.getFirstAsync<any>(
            "SELECT id FROM inbox_tasks WHERE entity_id = ? AND ambiguity_type = 'RELATIONSHIP'",
            existingNode.id
          );
          if (!existingTask) {
            const taskId = uuidv4();
            await db.runAsync(
              "INSERT INTO inbox_tasks (id, entity_id, ambiguity_type, question, status) VALUES (?, ?, 'RELATIONSHIP', ?, 'PENDING')",
              taskId,
              existingNode.id,
              `¿Qué relación tienes con ${nameToSave}?`
            );
          }
        }
      } else {
        // Node does not exist -> Create new local PERSON node
        const newNodeId = uuidv4();
        const newMeta = {
          user_id: friendId,
          avatar_url: remoteAvatar,
          username: profile.username,
          is_linked: isLinked,
          connection_status: connectionStatus,
        };

        await db.runAsync(
          "INSERT INTO entities (id, type, name, metadata, is_confirmed) VALUES (?, 'PERSON', ?, ?, 1)",
          newNodeId,
          remoteName,
          JSON.stringify(newMeta)
        );

        // Add task in inbox_tasks if connection is accepted
        if (isAccepted) {
          const taskId = uuidv4();
          await db.runAsync(
            "INSERT INTO inbox_tasks (id, entity_id, ambiguity_type, question, status) VALUES (?, ?, 'RELATIONSHIP', ?, 'PENDING')",
            taskId,
            newNodeId,
            `¿Qué relación tienes con ${remoteName}?`
          );
        }
      }
    }
  } catch (err) {
    console.error('[Social Sync] Error performing sync:', err);
  }
}

/**
 * Shares a local memory with a connected friend on Supabase.
 */
export async function shareMemoryWithFriend(memoryId: string, friendUserId: string): Promise<boolean> {
  try {
    const db = await getDb();
    
    // Fetch memory details
    const mem = await db.getFirstAsync<any>(
      "SELECT title, raw_text, fuzzy_date, start_date, end_date, time_context, space_context FROM memories WHERE id = ?",
      memoryId
    );
    if (!mem) {
      console.warn('[Social Sync] Memory not found for sharing:', memoryId);
      return false;
    }

    // Fetch associated entities
    const associated = await db.getAllAsync<any>(
      `SELECT e.name, e.type, e.metadata 
       FROM entities e 
       JOIN memory_entities me ON e.id = me.entity_id 
       WHERE me.memory_id = ?`,
      memoryId
    );

    // Get current user ID
    const { data: { session } } = await supabase.auth.getSession();
    const myId = session?.user?.id;
    if (!myId) {
      console.warn('[Social Sync] User session not found for sharing');
      return false;
    }

    // Insert to remote shared_memories
    const { error } = await supabase
      .from('shared_memories')
      .insert({
        sender_id: myId,
        receiver_id: friendUserId,
        memory_id: memoryId,
        title: mem.title || '',
        raw_text: mem.raw_text || '',
        fuzzy_date: mem.fuzzy_date || '',
        start_date: mem.start_date || null,
        end_date: mem.end_date || null,
        time_context: mem.time_context || '',
        space_context: mem.space_context || '',
        entities: associated,
        status: 'PENDING'
      });

    if (error) {
      console.error('[Social Sync] Error sharing memory on Supabase:', error);
      return false;
    }

    // Log the share locally
    await db.runAsync(
      "INSERT OR REPLACE INTO shared_memories_log (memory_id, friend_user_id, status) VALUES (?, ?, 'SHARED')",
      memoryId,
      friendUserId
    );

    return true;
  } catch (err) {
    console.error('[Social Sync] Error in shareMemoryWithFriend:', err);
    return false;
  }
}

/**
 * Fetches pending shared memories for the current user from Supabase.
 */
export async function fetchPendingSharedMemories(myId: string): Promise<any[]> {
  try {
    const { data, error } = await supabase
      .from('shared_memories')
      .select('*')
      .eq('receiver_id', myId)
      .eq('status', 'PENDING')
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('[Social Sync] Error fetching shared memories:', error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error('[Social Sync] Error in fetchPendingSharedMemories:', err);
    return [];
  }
}

/**
 * Accepts a shared memory, importing it and its entities into the local SQLite database.
 */
export async function acceptSharedMemory(sharedMemory: any, senderProfile: any): Promise<boolean> {
  try {
    const db = await getDb();
    const localMemoryId = uuidv4();

    // 1. Insert memory into SQLite
    await db.runAsync(
      `INSERT INTO memories (
        id, raw_text, title, fuzzy_date, start_date, end_date, 
        time_context, space_context, author_id, author_username, 
        author_fullname, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROCESSED_LOCAL')`,
      localMemoryId,
      sharedMemory.raw_text || '',
      sharedMemory.title || 'Recuerdo Compartido',
      sharedMemory.fuzzy_date || '',
      sharedMemory.start_date || null,
      sharedMemory.end_date || null,
      sharedMemory.time_context || '',
      sharedMemory.space_context || '',
      sharedMemory.sender_id,
      senderProfile?.username || 'usuario',
      senderProfile?.full_name || 'Amigo de Mnemósine'
    );

    // 2. Import entities
    const entitiesList = Array.isArray(sharedMemory.entities) ? sharedMemory.entities : [];
    for (const ent of entitiesList) {
      if (!ent.name || !ent.type) continue;
      
      // Check if entity already exists
      const existing = await db.getFirstAsync<any>(
        "SELECT id FROM entities WHERE name = ? AND type = ? COLLATE NOCASE",
        ent.name, ent.type
      );

      let entityId = existing?.id;
      if (!entityId) {
        entityId = uuidv4();
        const isConfirmed = ent.type === 'LOCATION' ? 0 : 1;
        await db.runAsync(
          "INSERT INTO entities (id, type, name, metadata, is_confirmed) VALUES (?, ?, ?, ?, ?)",
          entityId,
          ent.type,
          ent.name,
          ent.metadata ? (typeof ent.metadata === 'string' ? ent.metadata : JSON.stringify(ent.metadata)) : null,
          isConfirmed
        );
      }

      // Link to memory
      await db.runAsync(
        "INSERT INTO memory_entities (id, memory_id, entity_id, relationship_type) VALUES (?, ?, ?, 'MENTIONED')",
        uuidv4(),
        localMemoryId,
        entityId
      );
    }

    // 3. Update Supabase status to ACCEPTED
    const { error } = await supabase
      .from('shared_memories')
      .update({ status: 'ACCEPTED' })
      .eq('id', sharedMemory.id);

    if (error) {
      console.warn('[Social Sync] Error updating shared memory status on Supabase:', error);
    }

    return true;
  } catch (err) {
    console.error('[Social Sync] Error in acceptSharedMemory:', err);
    return false;
  }
}

/**
 * Rejects a shared memory, marking it as REJECTED in Supabase.
 */
export async function rejectSharedMemory(sharedMemoryId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('shared_memories')
      .update({ status: 'REJECTED' })
      .eq('id', sharedMemoryId);

    if (error) {
      console.warn('[Social Sync] Error rejecting shared memory:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Social Sync] Error in rejectSharedMemory:', err);
    return false;
  }
}

