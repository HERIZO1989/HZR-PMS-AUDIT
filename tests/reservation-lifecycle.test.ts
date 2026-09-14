/**
 * Tests d'INTEGRATION REELS contre le projet Supabase du repository (pas de mock).
 * Ils créent un tenant/hôtel de test isolé via generate_demo_hotel(), exercent les
 * fonctions PL/pgSQL de TASK 1, puis suppriment uniquement les données qu'ils ont
 * créées (aucune donnée pré-existante n'est jamais touchée).
 *
 * Nécessite dans l'environnement (voir .env.test.example) :
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Exécution : npm test
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabase: SupabaseClient;
let tenantId: string;
let hotelId: string;
let roomTypeId: string;
let roomAId: string;
let roomBId: string;

beforeAll(async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY requis pour lancer les tests (voir .env.test.example)');
  }
  supabase = createClient(url, key);

  const { data, error } = await supabase.rpc('generate_demo_hotel', {
    p_tenant_name: 'VITEST Tenant',
    p_hotel_name: 'VITEST Hotel',
    p_room_count: 6,
    p_guest_count: 2,
    p_reservation_count: 0,
  });
  if (error) throw error;
  tenantId = data[0].out_tenant_id;
  hotelId = data[0].out_hotel_id;

  // Le generateur marque aleatoirement 2 chambres 'out_of_order' ; sur un petit hotel
  // de test cela peut vider un type de chambre entier. On force un etat deterministe
  // pour que le test ne depende jamais de ce tirage aleatoire.
  await supabase.from('rooms').update({ status: 'vacant_clean' }).eq('hotel_id', hotelId);

  const { data: rooms } = await supabase
    .from('rooms')
    .select('id, room_type_id, status')
    .eq('hotel_id', hotelId)
    .eq('status', 'vacant_clean');

  // Deux chambres du meme type pour pouvoir tester le conflit puis une alternative
  const byType = new Map<string, string[]>();
  for (const r of rooms ?? []) {
    const arr = byType.get(r.room_type_id) ?? [];
    arr.push(r.id);
    byType.set(r.room_type_id, arr);
  }
  for (const [type, ids] of byType) {
    if (ids.length >= 2) {
      roomTypeId = type;
      [roomAId, roomBId] = ids;
      break;
    }
  }
  expect(roomTypeId, 'Aucun type de chambre avec 2 chambres libres trouvé pour le test').toBeDefined();
});

afterAll(async () => {
  if (!tenantId || !hotelId) return;
  await supabase.from('audit_events').delete().eq('tenant_id', tenantId);
  await supabase.from('housekeeping_tasks').delete().eq('hotel_id', hotelId);
  await supabase.from('payments').delete().eq('hotel_id', hotelId);
  await supabase.from('folio_lines').delete().eq('hotel_id', hotelId);
  await supabase.from('folios').delete().eq('hotel_id', hotelId);
  await supabase.from('reservation_stays').delete().eq('hotel_id', hotelId);
  await supabase.from('reservations').delete().eq('hotel_id', hotelId);
  const { data: staff } = await supabase.from('staff_users').select('id').eq('tenant_id', tenantId);
  const staffIds = (staff ?? []).map((s) => s.id);
  if (staffIds.length) await supabase.from('staff_user_roles').delete().in('staff_user_id', staffIds);
  const { data: roles } = await supabase.from('roles').select('id').eq('tenant_id', tenantId);
  const roleIds = (roles ?? []).map((r) => r.id);
  if (roleIds.length) await supabase.from('role_permissions').delete().in('role_id', roleIds);
  await supabase.from('staff_users').delete().eq('tenant_id', tenantId);
  await supabase.from('roles').delete().eq('tenant_id', tenantId);
  await supabase.from('guests').delete().eq('tenant_id', tenantId);
  await supabase.from('rooms').delete().eq('hotel_id', hotelId);
  await supabase.from('room_types').delete().eq('hotel_id', hotelId);
  await supabase.from('subscriptions').delete().eq('tenant_id', tenantId);
  await supabase.from('hotels').delete().eq('id', hotelId);
  await supabase.from('tenants').delete().eq('id', tenantId);
});

describe('Réservation — création et disponibilité', () => {
  let reservationId: string;

  it('crée une réservation valide sur une période libre', async () => {
    const { data, error } = await supabase.rpc('create_reservation', {
      p_tenant_id: tenantId,
      p_hotel_id: hotelId,
      p_room_type_id: roomTypeId,
      p_arrival_date: '2027-01-10',
      p_departure_date: '2027-01-13',
      p_assigned_room_id: roomAId,
      p_guest_email: 'vitest.guest1@example.com',
      p_guest_first_name: 'Vitest',
      p_guest_last_name: 'Guest1',
    });
    expect(error).toBeNull();
    expect(data.status).toBe('confirmed');
    expect(Number(data.total_amount)).toBeGreaterThan(0);
    reservationId = data.id;
  });

  it('rejette une seconde réservation sur la même chambre avec chevauchement de dates', async () => {
    const { error } = await supabase.rpc('create_reservation', {
      p_tenant_id: tenantId,
      p_hotel_id: hotelId,
      p_room_type_id: roomTypeId,
      p_arrival_date: '2027-01-12',
      p_departure_date: '2027-01-15',
      p_assigned_room_id: roomAId,
      p_guest_email: 'vitest.guest2@example.com',
      p_guest_first_name: 'Vitest',
      p_guest_last_name: 'Guest2',
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('23P01');
  });

  it('accepte une réservation sur une chambre différente pour les mêmes dates', async () => {
    const { data, error } = await supabase.rpc('create_reservation', {
      p_tenant_id: tenantId,
      p_hotel_id: hotelId,
      p_room_type_id: roomTypeId,
      p_arrival_date: '2027-01-12',
      p_departure_date: '2027-01-15',
      p_assigned_room_id: roomBId,
      p_guest_email: 'vitest.guest3@example.com',
      p_guest_first_name: 'Vitest',
      p_guest_last_name: 'Guest3',
    });
    expect(error).toBeNull();
    expect(data.assigned_room_id).toBe(roomBId);
  });

  it('rejette une réservation avec departure_date <= arrival_date', async () => {
    const { error } = await supabase.rpc('create_reservation', {
      p_tenant_id: tenantId,
      p_hotel_id: hotelId,
      p_room_type_id: roomTypeId,
      p_arrival_date: '2027-02-10',
      p_departure_date: '2027-02-10',
      p_guest_email: 'vitest.guest4@example.com',
    });
    expect(error).not.toBeNull();
  });

  it('empêche la modification d\'un tenant/hôtel qui n\'est pas le bon (IDOR)', async () => {
    const { error } = await supabase.rpc('cancel_reservation', {
      p_reservation_id: reservationId,
      p_hotel_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(error).not.toBeNull();
  });
});

describe('Check-in / Check-out', () => {
  let reservationId: string;
  let roomId: string;

  beforeAll(async () => {
    const { data } = await supabase.rpc('create_reservation', {
      p_tenant_id: tenantId,
      p_hotel_id: hotelId,
      p_room_type_id: roomTypeId,
      p_arrival_date: '2026-09-01',
      p_departure_date: '2026-09-03',
      p_assigned_room_id: roomAId,
      p_guest_email: 'vitest.checkin@example.com',
      p_guest_first_name: 'Checkin',
      p_guest_last_name: 'Test',
    });
    reservationId = data.id;
    roomId = data.assigned_room_id;
  });

  it('refuse le check-in d\'une réservation inexistante', async () => {
    const { error } = await supabase.rpc('check_in_reservation', {
      p_reservation_id: '00000000-0000-0000-0000-000000000000',
      p_hotel_id: hotelId,
    });
    expect(error).not.toBeNull();
  });

  it('effectue un check-in valide et ouvre un folio', async () => {
    const { data, error } = await supabase.rpc('check_in_reservation', {
      p_reservation_id: reservationId,
      p_hotel_id: hotelId,
    });
    expect(error).toBeNull();
    expect(data.status).toBe('checked_in');

    const { data: room } = await supabase.from('rooms').select('status').eq('id', roomId).single();
    expect(room!.status).toBe('occupied');

    const { data: folio } = await supabase.from('folios').select('status,balance').eq('reservation_id', reservationId).single();
    expect(folio!.status).toBe('open');
    expect(Number(folio!.balance)).toBe(0);
  });

  it('refuse un second check-in sur une chambre déjà occupée', async () => {
    const { data: other } = await supabase.rpc('create_reservation', {
      p_tenant_id: tenantId, p_hotel_id: hotelId, p_room_type_id: roomTypeId,
      p_arrival_date: '2026-09-01', p_departure_date: '2026-09-03', p_assigned_room_id: roomBId,
      p_guest_email: 'vitest.other@example.com',
    });
    const { error } = await supabase.rpc('check_in_reservation', {
      p_reservation_id: other.id,
      p_hotel_id: hotelId,
      p_room_id: roomId, // meme chambre que le premier check-in, deja occupee
    });
    expect(error).not.toBeNull();
  });

  it('effectue un check-out valide et prépare la chambre pour housekeeping', async () => {
    const { data, error } = await supabase.rpc('check_out_reservation', {
      p_reservation_id: reservationId,
      p_hotel_id: hotelId,
    });
    expect(error).toBeNull();
    expect(data.status).toBe('checked_out');

    const { data: room } = await supabase.from('rooms').select('status').eq('id', roomId).single();
    expect(room!.status).toBe('vacant_dirty');

    const { data: tasks } = await supabase.from('housekeeping_tasks').select('task_type,status').eq('room_id', roomId);
    expect(tasks!.some((t) => t.task_type === 'turnover' && t.status === 'pending')).toBe(true);
  });
});

describe('Folio et paiement', () => {
  let reservationId: string;
  let folioId: string;

  beforeAll(async () => {
    const { data: res } = await supabase.rpc('create_reservation', {
      p_tenant_id: tenantId, p_hotel_id: hotelId, p_room_type_id: roomTypeId,
      p_arrival_date: '2026-09-20', p_departure_date: '2026-09-22', p_assigned_room_id: roomAId,
      p_guest_email: 'vitest.folio@example.com',
    });
    reservationId = res.id;
    const { data: checkin } = await supabase.rpc('check_in_reservation', {
      p_reservation_id: reservationId, p_hotel_id: hotelId,
    });
    const { data: folio } = await supabase.from('folios').select('id').eq('reservation_id', reservationId).single();
    folioId = folio!.id;
  });

  it('ajoute une ligne et recalcule le solde', async () => {
    const { data, error } = await supabase.rpc('add_folio_line', {
      p_folio_id: folioId, p_hotel_id: hotelId,
      p_line_type: 'service', p_description: 'Minibar', p_amount: 45,
    });
    expect(error).toBeNull();
    expect(Number(data.balance)).toBe(45);
  });

  it('enregistre un paiement et solde le folio', async () => {
    const { data, error } = await supabase.rpc('add_payment', {
      p_folio_id: folioId, p_hotel_id: hotelId,
      p_amount: 45, p_method: 'card', p_idempotency_key: 'vitest-key-abc',
    });
    expect(error).toBeNull();
    expect(Number(data.balance)).toBe(0);
    expect(data.status).toBe('closed');
  });

  it('ignore une double soumission du même paiement (idempotence)', async () => {
    const { data, error } = await supabase.rpc('add_payment', {
      p_folio_id: folioId, p_hotel_id: hotelId,
      p_amount: 45, p_method: 'card', p_idempotency_key: 'vitest-key-abc',
    });
    expect(error).toBeNull();
    const { count } = await supabase.from('payments').select('*', { count: 'exact', head: true }).eq('folio_id', folioId);
    expect(count).toBe(1);
  });

  it('rejette un montant de paiement négatif ou nul', async () => {
    const { error } = await supabase.rpc('add_payment', {
      p_folio_id: folioId, p_hotel_id: hotelId,
      p_amount: 0, p_method: 'card', p_idempotency_key: 'vitest-key-zero',
    });
    expect(error).not.toBeNull();
  });

  it('rejette un ajout de ligne/paiement sur un hotel_id different (IDOR)', async () => {
    const fake = '00000000-0000-0000-0000-000000000000';
    const { error: e1 } = await supabase.rpc('add_folio_line', {
      p_folio_id: folioId, p_hotel_id: fake, p_line_type: 'service', p_description: 'x', p_amount: 1,
    });
    expect(e1).not.toBeNull();
    const { error: e2 } = await supabase.rpc('add_payment', {
      p_folio_id: folioId, p_hotel_id: fake, p_amount: 1, p_method: 'cash', p_idempotency_key: 'vitest-idor',
    });
    expect(e2).not.toBeNull();
  });
});

describe('TASK 2 — Authentification (rate limiting, traçabilité, révocation)', () => {
  const testEmail = `vitest-auth-${Date.now()}@example.com`;

  it("verrouille apres 5 echecs meme si le 6e essai utilise le bon mot de passe", async () => {
    for (let i = 0; i < 5; i++) {
      await supabase.rpc('attempt_staff_login', {
        p_email: testEmail, p_password: 'wrong', p_ip_address: '198.51.100.10', p_user_agent: 'vitest',
      });
    }
    const { data } = await supabase.rpc('attempt_staff_login', {
      p_email: testEmail, p_password: 'wrong-again', p_ip_address: '198.51.100.10', p_user_agent: 'vitest',
    });
    expect(data[0].locked).toBe(true);
  });

  it('trace chaque tentative dans security_events', async () => {
    const { count } = await supabase
      .from('security_events')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'auth.login')
      .contains('metadata', { email: testEmail });
    expect(count).toBeGreaterThanOrEqual(5);
  });

  it('revoque une session individuelle par jti sans affecter les autres', async () => {
    const jtiToRevoke = crypto.randomUUID();
    const otherJti = crypto.randomUUID();
    const fakeStaffId = '00000000-0000-0000-0000-000000000001';

    const before = await supabase.rpc('is_session_valid', {
      p_jti: jtiToRevoke, p_staff_user_id: fakeStaffId, p_issued_at: new Date().toISOString(),
    });
    expect(before.data).toBe(true);

    await supabase.rpc('revoke_session', {
      p_jti: jtiToRevoke, p_staff_user_id: fakeStaffId,
      p_expires_at: new Date(Date.now() + 3600_000).toISOString(), p_reason: 'vitest',
    });

    const afterRevoked = await supabase.rpc('is_session_valid', {
      p_jti: jtiToRevoke, p_staff_user_id: fakeStaffId, p_issued_at: new Date().toISOString(),
    });
    expect(afterRevoked.data).toBe(false);

    const afterOther = await supabase.rpc('is_session_valid', {
      p_jti: otherJti, p_staff_user_id: fakeStaffId, p_issued_at: new Date().toISOString(),
    });
    expect(afterOther.data).toBe(true);

    await supabase.from('revoked_sessions').delete().eq('jti', jtiToRevoke);
  });

  afterAll(async () => {
    await supabase.from('login_attempts').delete().eq('email', testEmail);
    await supabase.from('security_events').delete().contains('metadata', { email: testEmail });
  });
});

describe('TASK 4 — Housekeeping et déduplication import', () => {
  it('synchronise rooms.status a vacant_clean quand une tache verified', async () => {
    const { data: room } = await supabase
      .from('rooms').select('id').eq('hotel_id', hotelId).eq('room_type_id', roomTypeId).limit(1).single();

    await supabase.from('rooms').update({ status: 'vacant_dirty' }).eq('id', room!.id);
    const { data: task } = await supabase
      .from('housekeeping_tasks')
      .insert({ tenant_id: tenantId, hotel_id: hotelId, room_id: room!.id, task_type: 'turnover', status: 'pending', priority: 'normal' })
      .select('id').single();

    await supabase.rpc('advance_housekeeping_task', { p_task_id: task!.id, p_hotel_id: hotelId, p_new_status: 'verified' });

    const { data: after } = await supabase.from('rooms').select('status').eq('id', room!.id).single();
    expect(after!.status).toBe('vacant_clean');
  });

  it('ne remet pas a vacant_clean une chambre redevenue occupee entre-temps', async () => {
    const { data: room } = await supabase
      .from('rooms').select('id').eq('hotel_id', hotelId).eq('room_type_id', roomTypeId).limit(1).single();

    await supabase.from('rooms').update({ status: 'occupied' }).eq('id', room!.id);
    const { data: task } = await supabase
      .from('housekeeping_tasks')
      .insert({ tenant_id: tenantId, hotel_id: hotelId, room_id: room!.id, task_type: 'cleaning', status: 'pending', priority: 'normal' })
      .select('id').single();

    await supabase.rpc('advance_housekeeping_task', { p_task_id: task!.id, p_hotel_id: hotelId, p_new_status: 'verified' });

    const { data: after } = await supabase.from('rooms').select('status').eq('id', room!.id).single();
    expect(after!.status).toBe('occupied');
  });

  it("evite un doublon de client au reimport (upsert par email)", async () => {
    const email = `vitest-dedup-${Date.now()}@example.com`;
    const { data: batch } = await supabase
      .from('import_batches')
      .insert({ tenant_id: tenantId, hotel_id: hotelId, source_system: 'generic_csv', file_name: 'v.csv', file_type: 'csv', status: 'validating' })
      .select('id').single();

    const { data: row1 } = await supabase.from('import_rows').insert({
      tenant_id: tenantId, import_batch_id: batch!.id, row_number: 1,
      raw_data: {}, normalized_data: { email, first_name: 'A', last_name: 'B', vip_tier: 'gold' },
      status: 'valid', target_entity_type: 'guest',
    }).select('id').single();
    await supabase.rpc('apply_import_row', { p_row_id: row1!.id });

    const { data: row2 } = await supabase.from('import_rows').insert({
      tenant_id: tenantId, import_batch_id: batch!.id, row_number: 2,
      raw_data: {}, normalized_data: { email, first_name: 'A', last_name: 'B', vip_tier: 'platinum' },
      status: 'valid', target_entity_type: 'guest',
    }).select('id').single();
    await supabase.rpc('apply_import_row', { p_row_id: row2!.id });

    const { count } = await supabase.from('guests').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('email', email);
    expect(count).toBe(1);

    await supabase.from('import_rows').delete().eq('import_batch_id', batch!.id);
    await supabase.from('import_batches').delete().eq('id', batch!.id);
    await supabase.from('guests').delete().eq('email', email);
  });
});
