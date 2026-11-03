import { makeProfileExport } from '../profile-export.ts';
import type { Payment, PlayerState, Profile, ProgramState, Session, SkillState, Subscription } from '../types.ts';
import type { SqlClient } from './migrate.ts';

/** Requires a dedicated connection for the full transaction. Not wired into the application yet. */
export async function exportOwnedProfile(client: SqlClient, parentId: string, profileId: string) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const profileRows = await client.query('SELECT data FROM gib.profiles WHERE id=$1 AND parent_id=$2', [profileId, parentId]);
    if (!profileRows.rows.length) { await client.query('COMMIT'); return null; }
    const read = async (table: string) => (await client.query(`SELECT data FROM gib.${table} WHERE profile_id=$1 ORDER BY ordinal`, [profileId])).rows.map(row => row.data);
    const skills = await read('skills') as (SkillState & { profileId: string })[];
    const sessions = await read('sessions') as Session[];
    const programStates = await read('program_states') as ProgramState[];
    const playerStates = await read('player_states') as PlayerState[];
    const subs = await read('subscriptions') as Subscription[];
    const payments = await read('payments') as Payment[];
    const result = makeProfileExport({ profile: profileRows.rows[0].data as Profile, skills, sessions, programStates, playerStates, subs, payments });
    await client.query('COMMIT');
    return result;
  } catch (error) { try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ } throw error; }
}

/** Conservative prototype policy: payment records block deletion until retention policy is settled. */
export async function deleteOwnedProfile(client: SqlClient, parentId: string, profileId: string): Promise<'deleted' | 'not_found' | 'payment_records'> {
  await client.query('BEGIN');
  try {
    // The row lock also serializes against new foreign-key references from payments.
    const profile = await client.query('SELECT id FROM gib.profiles WHERE id=$1 AND parent_id=$2 FOR UPDATE', [profileId, parentId]);
    if (!profile.rows.length) { await client.query('COMMIT'); return 'not_found'; }
    const payments = await client.query('SELECT 1 FROM gib.payments WHERE profile_id=$1 LIMIT 1', [profileId]);
    if (payments.rows.length) { await client.query('COMMIT'); return 'payment_records'; }
    await client.query('DELETE FROM gib.profiles WHERE id=$1 AND parent_id=$2', [profileId, parentId]);
    await client.query('COMMIT');
    return 'deleted';
  } catch (error) { try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ } throw error; }
}
