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

    // 1. Fetch all ACCEPTED connections involving the current user
    const { data: connections, error: connError } = await supabase
      .from('connections')
      .select('*')
      .eq('status', 'ACCEPTED')
      .or(`sender_id.eq.${myId},receiver_id.eq.${myId}`);

    if (connError) {
      console.warn('[Social Sync] Error fetching connections:', connError);
      return;
    }

    if (!connections || connections.length === 0) {
      return;
    }

    // 2. Extract unique friend IDs
    const friendIds = connections.map(c => 
      c.sender_id === myId ? c.receiver_id : c.sender_id
    );

    // 3. Fetch profiles of these friends from Supabase
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

    // 4. Fetch all local PERSON entities to compare
    const localPeople = await db.getAllAsync<any>("SELECT * FROM entities WHERE type = 'PERSON'");

    for (const profile of profiles) {
      const friendId = profile.id;
      const remoteName = profile.full_name || `@${profile.username}`;
      const remoteAvatar = profile.avatar_url || `https://api.dicebear.com/7.x/adventurer/png?seed=${profile.username}`;

      // Check if this friend is already linked to a local node
      let existingNode = null;
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

      if (existingNode) {
        // Node exists -> sync details and lock it
        const currentMeta = JSON.parse(existingNode.metadata || '{}');
        const updatedMeta = {
          ...currentMeta,
          user_id: friendId,
          avatar_url: remoteAvatar,
          username: profile.username,
          is_linked: true,
        };

        await db.runAsync(
          "UPDATE entities SET name = ?, metadata = ? WHERE id = ?",
          remoteName,
          JSON.stringify(updatedMeta),
          existingNode.id
        );
      } else {
        // Node does not exist -> Create new local PERSON node
        const newNodeId = uuidv4();
        const newMeta = {
          user_id: friendId,
          avatar_url: remoteAvatar,
          username: profile.username,
          is_linked: true,
        };

        await db.runAsync(
          "INSERT INTO entities (id, type, name, metadata, is_confirmed) VALUES (?, 'PERSON', ?, ?, 1)",
          newNodeId,
          remoteName,
          JSON.stringify(newMeta)
        );

        // Add task in inbox_tasks
        const taskId = uuidv4();
        await db.runAsync(
          "INSERT INTO inbox_tasks (id, entity_id, ambiguity_type, question, status) VALUES (?, ?, 'RELATIONSHIP', ?, 'PENDING')",
          taskId,
          newNodeId,
          `¿Qué relación tienes con ${remoteName}?`
        );
      }
    }
  } catch (err) {
    console.error('[Social Sync] Error performing sync:', err);
  }
}
