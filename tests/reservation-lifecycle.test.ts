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
  // Tables qui referencent staff_users (FK run_by / resolved_by / assigned_to / uploaded_by) :
  // a vider avant les comptes, sinon le tenant de test reste en base (constate : night_audit_runs).
  await supabase.from('import_rows').delete().eq('tenant_id', tenantId);
  await supabase.from('import_batches').delete().eq('hotel_id', hotelId);
  await supabase.from('concierge_requests').delete().eq('hotel_id', hotelId);
  await supabase.from('audit_findings').delete().eq('hotel_id', hotelId);
  await supabase.from('kpi_daily_snapshots').delete().eq('hotel_id', hotelId);
  await supabase.from('night_audit_checks').delete().eq('tenant_id', tenantId);
  await supabase.from('night_audit_runs').delete().eq('hotel_id', hotelId);
  const { data: staff } = await supabase.from('staff_users').select('id').eq('tenant_id', tenantId);
  const staffIds = (staff ?? []).map((s) => s.id);
  if (staffIds.length) {
    // Les logins reussis des tests creent des lignes qui referencent staff_users (FK) : sans ces
    // suppressions, la suppression des comptes echoue en silence et le tenant reste en base.
    await supabase.from('revoked_sessions').delete().in('staff_user_id', staffIds);
    await supabase.from('security_events').delete().in('actor_user_id', staffIds);
    await supabase.from('staff_user_roles').delete().in('staff_user_id', staffIds);
  }
  await supabase.from('security_events').delete().eq('tenant_id', tenantId);
  const { data: roles } = await supabase.from('roles').select('id').eq('tenant_id', tenantId);
  const roleIds = (roles ?? []).map((r) => r.id);
  if (roleIds.length) await supabase.from('role_permissions').delete().in('role_id', roleIds);
  await supabase.from('staff_users').delete().eq('tenant_id', tenantId);
  await supabase.from('roles').delete().eq('tenant_id', tenantId);
  await supabase.from('guests').delete().eq('tenant_id', tenantId);
  await supabase.from('rooms').delete().eq('hotel_id', hotelId);
  await supabase.from('rate_calendar').delete().eq('tenant_id', tenantId);
  await supabase.from('rate_plans').delete().eq('tenant_id', tenantId);
  await supabase.from('room_types').delete().eq('hotel_id', hotelId);
  await supabase.from('subscriptions').delete().eq('tenant_id', tenantId);
  await supabase.from('hotels').delete().eq('id', hotelId);
  const { error: tenantDeleteError } = await supabase.from('tenants').delete().eq('id', tenantId);
  // Ne plus echouer en silence : un tenant de test residuel pollue la base de production.
  if (tenantDeleteError) {
    console.warn(`[cleanup] tenant de test ${tenantId} non supprime : ${tenantDeleteError.message}`);
  }
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

describe('TASK 14 — Tarification par calendrier et devise', () => {
  let planId: string;
  let inactivePlanId: string;
  let baseRate: number;
  let hotelCurrency: string;

  beforeAll(async () => {
    const { data: rt } = await supabase.from('room_types').select('base_rate').eq('id', roomTypeId).single();
    baseRate = Number(rt!.base_rate);
    const { data: hotel } = await supabase.from('hotels').select('currency_code').eq('id', hotelId).single();
    hotelCurrency = hotel!.currency_code;

    const mkPlan = async (code: string, status: string) => {
      const { data, error } = await supabase
        .from('rate_plans')
        .insert({
          tenant_id: tenantId, hotel_id: hotelId, room_type_id: null, code, name: `Plan test ${code}`,
          meal_plan: 'room_only', is_refundable: true, status,
        })
        .select('id')
        .single();
      expect(error).toBeNull();
      return data!.id as string;
    };
    planId = await mkPlan('T14', 'active');
    inactivePlanId = await mkPlan('T14X', 'inactive');

    const rows = [['2028-02-01', 100000], ['2028-02-02', 200000], ['2028-02-03', 300000]].map(([date, rate]) => ({
      tenant_id: tenantId, hotel_id: hotelId, rate_plan_id: planId, room_type_id: roomTypeId, date, rate,
    }));
    const { error } = await supabase.from('rate_calendar').insert(rows);
    expect(error).toBeNull();
  });

  const book = (arrival: string, departure: string, email: string, ratePlanId: string | null) =>
    supabase.rpc('create_reservation', {
      p_tenant_id: tenantId, p_hotel_id: hotelId, p_room_type_id: roomTypeId,
      p_arrival_date: arrival, p_departure_date: departure, p_guest_email: email,
      p_guest_first_name: 'Tarif', p_guest_last_name: 'Test', p_rate_plan_id: ratePlanId,
    });

  it('calcule le montant nuit par nuit a partir du calendrier du plan choisi', async () => {
    const { data, error } = await book('2028-02-01', '2028-02-04', 'vitest.t14.a@example.com', planId);
    expect(error).toBeNull();
    expect(Number(data.total_amount)).toBe(600000);
    expect(data.rate_plan_id).toBe(planId);
  });

  it("utilise la devise de l'hotel et non une devise en dur", async () => {
    const { data, error } = await book('2028-02-01', '2028-02-02', 'vitest.t14.b@example.com', planId);
    expect(error).toBeNull();
    expect(data.currency_code).toBe(hotelCurrency);
  });

  it('retombe sur le tarif de base pour les nuits sans ligne de calendrier', async () => {
    const { data, error } = await book('2028-05-01', '2028-05-04', 'vitest.t14.c@example.com', planId);
    expect(error).toBeNull();
    expect(Number(data.total_amount)).toBe(baseRate * 3);
  });

  it('refuse un plan tarifaire inactif ou inexistant', async () => {
    const inactive = await book('2028-02-01', '2028-02-02', 'vitest.t14.d@example.com', inactivePlanId);
    expect(inactive.error).not.toBeNull();
    const unknown = await book('2028-02-01', '2028-02-02', 'vitest.t14.e@example.com', '00000000-0000-0000-0000-000000000000');
    expect(unknown.error).not.toBeNull();
  });
});

describe('TASK 15 — Restrictions de vente du calendrier', () => {
  let planId: string;

  beforeAll(async () => {
    const { data, error } = await supabase
      .from('rate_plans')
      .insert({
        tenant_id: tenantId, hotel_id: hotelId, room_type_id: null, code: 'T15', name: 'Plan test restrictions',
        meal_plan: 'room_only', is_refundable: true, status: 'active',
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    planId = data!.id;

    // Toutes les colonnes explicites : un insert groupe PostgREST met a NULL les cles absentes d'une ligne
    // (violation NOT NULL sur stop_sell, closed_to_*, min_stay) des que les lignes n'ont pas les memes cles.
    const base = {
      tenant_id: tenantId, hotel_id: hotelId, rate_plan_id: planId, room_type_id: roomTypeId, rate: 100000,
      stop_sell: false, closed_to_arrival: false, closed_to_departure: false, min_stay: 1, max_stay: null as number | null,
    };
    const rows = [
      { ...base, date: '2029-03-01' },
      { ...base, date: '2029-03-02', stop_sell: true },
      { ...base, date: '2029-03-03' },
      { ...base, date: '2029-03-10', closed_to_arrival: true },
      { ...base, date: '2029-03-11' },
      { ...base, date: '2029-03-12', closed_to_departure: true },
      { ...base, date: '2029-03-20', min_stay: 3 },
      { ...base, date: '2029-03-21' },
      { ...base, date: '2029-03-22' },
      { ...base, date: '2029-03-23' },
      { ...base, date: '2029-03-25', max_stay: 2 },
    ];
    const ins = await supabase.from('rate_calendar').insert(rows);
    expect(ins.error).toBeNull();
  });

  const book = (arrival: string, departure: string, email: string) =>
    supabase.rpc('create_reservation', {
      p_tenant_id: tenantId, p_hotel_id: hotelId, p_room_type_id: roomTypeId,
      p_arrival_date: arrival, p_departure_date: departure, p_guest_email: email,
      p_guest_first_name: 'Restr', p_guest_last_name: 'Test', p_rate_plan_id: planId,
    });

  it('refuse un sejour qui couvre une nuit en stop-sell, accepte celui qui se termine la veille', async () => {
    const blocked = await book('2029-03-01', '2029-03-03', 'vitest.t15.a@example.com');
    expect(blocked.error?.message).toMatch(/stop-sell/);
    const ok = await book('2029-03-01', '2029-03-02', 'vitest.t15.a2@example.com');
    expect(ok.error).toBeNull();
  });

  it("refuse une arrivee un jour ferme a l'arrivee", async () => {
    const blocked = await book('2029-03-10', '2029-03-11', 'vitest.t15.b@example.com');
    expect(blocked.error?.message).toMatch(/ferme a l'arrivee/);
  });

  it('refuse un depart un jour ferme au depart', async () => {
    const blocked = await book('2029-03-11', '2029-03-12', 'vitest.t15.c@example.com');
    expect(blocked.error?.message).toMatch(/ferme au depart/);
  });

  it('applique le sejour minimum et maximum evalues sur la date darrivee', async () => {
    const tooShort = await book('2029-03-20', '2029-03-22', 'vitest.t15.d@example.com');
    expect(tooShort.error?.message).toMatch(/minimum de 3 nuits/);
    const okMin = await book('2029-03-20', '2029-03-23', 'vitest.t15.d2@example.com');
    expect(okMin.error).toBeNull();
    const tooLong = await book('2029-03-25', '2029-03-28', 'vitest.t15.e@example.com');
    expect(tooLong.error?.message).toMatch(/maximum de 2 nuits/);
  });
});

describe('TASK 17 — Capacite et supplements par occupation', () => {
  let flexTypeId: string;

  beforeAll(async () => {
    // Type de chambre dedie : base 2, max 4, supplement adulte 30 000, enfant 10 000, tarif de base 100 000
    const { data, error } = await supabase
      .from('room_types')
      .insert({
        tenant_id: tenantId, hotel_id: hotelId, code: 'T17', name: 'Type test occupation',
        base_occupancy: 2, max_occupancy: 4, base_rate: 100000, extra_adult_fee: 30000, extra_child_fee: 10000,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    flexTypeId = data!.id;
  });

  const book = (adults: number, children: number, email: string) =>
    supabase.rpc('create_reservation', {
      p_tenant_id: tenantId, p_hotel_id: hotelId, p_room_type_id: flexTypeId,
      p_arrival_date: '2030-05-01', p_departure_date: '2030-05-04', p_guest_email: email,
      p_guest_first_name: 'Occ', p_guest_last_name: 'Test', p_adults: adults, p_children: children,
    });

  it("ne facture aucun supplement dans la capacite de base", async () => {
    const { data, error } = await book(2, 0, 'vitest.t17.a@example.com');
    expect(error).toBeNull();
    expect(Number(data.total_amount)).toBe(300000);
  });

  it('facture les adultes supplementaires par nuit', async () => {
    const { data, error } = await book(3, 0, 'vitest.t17.b@example.com');
    expect(error).toBeNull();
    expect(Number(data.total_amount)).toBe(300000 + 3 * 30000);
  });

  it('facture les enfants au-dela des places restantes de la base', async () => {
    // 1 adulte + 2 enfants : 1 enfant occupe la 2e place de base, l autre est en supplement
    const { data, error } = await book(1, 2, 'vitest.t17.c@example.com');
    expect(error).toBeNull();
    expect(Number(data.total_amount)).toBe(300000 + 3 * 10000);
  });

  it('refuse le depassement de capacite et l absence d adulte', async () => {
    const over = await book(3, 2, 'vitest.t17.d@example.com');
    expect(over.error?.message).toMatch(/Capacite maximale de 4 personnes/);
    const noAdult = await book(0, 1, 'vitest.t17.e@example.com');
    expect(noAdult.error?.message).toMatch(/Au moins 1 adulte/);
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

describe('TASK 18 — Night audit : posting des nuitees', () => {
  let reservationId: string;
  let folioId: string;
  let nightly: number;
  let totalAmount: number;

  beforeAll(async () => {
    // Chambre dediee, distincte de celles utilisees par les autres blocs de tests
    const { data: spare } = await supabase
      .from('rooms')
      .select('id, room_type_id')
      .eq('hotel_id', hotelId)
      .neq('id', roomAId)
      .neq('id', roomBId)
      .limit(1)
      .single();
    expect(spare).not.toBeNull();

    const { data: res, error } = await supabase.rpc('create_reservation', {
      p_tenant_id: tenantId, p_hotel_id: hotelId, p_room_type_id: spare!.room_type_id,
      p_arrival_date: '2031-07-01', p_departure_date: '2031-07-03', p_assigned_room_id: spare!.id,
      p_guest_email: 'vitest.t18@example.com', p_guest_first_name: 'Night', p_guest_last_name: 'Audit',
    });
    expect(error).toBeNull();
    reservationId = res.id;
    totalAmount = Number(res.total_amount);
    nightly = totalAmount / 2;

    const ci = await supabase.rpc('check_in_reservation', { p_reservation_id: reservationId, p_hotel_id: hotelId });
    expect(ci.error).toBeNull();
    const { data: folio } = await supabase.from('folios').select('id').eq('reservation_id', reservationId).single();
    folioId = folio!.id;
  });

  const post = (date: string) => supabase.rpc('post_room_charges', { p_hotel_id: hotelId, p_business_date: date });

  it('poste la nuitee du client en sejour et met a jour le solde du folio', async () => {
    const { data, error } = await post('2031-07-01');
    expect(error).toBeNull();
    expect(data[0].posted).toBe(1);
    expect(Number(data[0].total_posted)).toBe(nightly);
    const { data: folio } = await supabase.from('folios').select('balance').eq('id', folioId).single();
    expect(Number(folio!.balance)).toBe(nightly);
  });

  it('est idempotent : relancer la meme date ne cree aucun doublon', async () => {
    const { data, error } = await post('2031-07-01');
    expect(error).toBeNull();
    expect(data[0].posted).toBe(0);
    expect(data[0].skipped).toBe(1);
    const { count } = await supabase
      .from('folio_lines')
      .select('id', { count: 'exact', head: true })
      .eq('folio_id', folioId)
      .eq('line_type', 'room_charge');
    expect(count).toBe(1);
  });

  it("alimente l'ADR et le CA chambres du jour", async () => {
    const { data: kpi } = await supabase
      .from('kpi_daily_snapshots')
      .select('adr, total_room_revenue')
      .eq('hotel_id', hotelId)
      .eq('business_date', '2031-07-01')
      .single();
    expect(Number(kpi!.total_room_revenue)).toBe(nightly);
    expect(Number(kpi!.adr)).toBe(nightly);
  });

  it('poste la 2e nuit, rien le jour du depart', async () => {
    const second = await post('2031-07-02');
    expect(second.data[0].posted).toBe(1);
    const departure = await post('2031-07-03');
    expect(departure.data[0].posted).toBe(0);
    const { data: folio } = await supabase.from('folios').select('balance').eq('id', folioId).single();
    expect(Number(folio!.balance)).toBe(totalAmount);
  });
});

describe('TASK 19 — TVA sur les nuitees postees', () => {
  let reservationId: string;
  let folioId: string;
  let gross: number;

  beforeAll(async () => {
    // Chambre libre : ni les chambres A/B, ni celle du bloc TASK 18 (deja en sejour)
    const { data: busy } = await supabase.from('reservations').select('assigned_room_id').eq('hotel_id', hotelId).eq('status', 'checked_in');
    const excluded = [roomAId, roomBId, ...(busy ?? []).map((b) => b.assigned_room_id).filter(Boolean)];
    const { data: rooms } = await supabase.from('rooms').select('id, room_type_id').eq('hotel_id', hotelId);
    const spare = (rooms ?? []).find((r) => !excluded.includes(r.id));
    expect(spare).toBeDefined();

    const { data: res, error } = await supabase.rpc('create_reservation', {
      p_tenant_id: tenantId, p_hotel_id: hotelId, p_room_type_id: spare!.room_type_id,
      p_arrival_date: '2032-03-01', p_departure_date: '2032-03-04', p_assigned_room_id: spare!.id,
      p_guest_email: 'vitest.t19@example.com', p_guest_first_name: 'Vat', p_guest_last_name: 'Test',
    });
    expect(error).toBeNull();
    reservationId = res.id;
    gross = Number(res.total_amount) / 3;
    const ci = await supabase.rpc('check_in_reservation', { p_reservation_id: reservationId, p_hotel_id: hotelId });
    expect(ci.error).toBeNull();
    const { data: folio } = await supabase.from('folios').select('id').eq('reservation_id', reservationId).single();
    folioId = folio!.id;
  });

  const post = (date: string) => supabase.rpc('post_room_charges', { p_hotel_id: hotelId, p_business_date: date });
  const setVat = (vat_rate: number, prices_include_vat: boolean) =>
    supabase.from('hotels').update({ vat_rate, prices_include_vat }).eq('id', hotelId);

  it('prix TTC : ligne chambre HT + ligne TVA, solde = TTC, ADR hors TVA', async () => {
    await setVat(0.2, true);
    try {
      const { data, error } = await post('2032-03-01');
      expect(error).toBeNull();
      expect(data[0].posted).toBe(1);
      expect(Number(data[0].total_posted)).toBeCloseTo(gross, 2);

      const { data: lines } = await supabase.from('folio_lines').select('line_type, amount').eq('folio_id', folioId);
      const room = lines!.find((l) => l.line_type === 'room_charge')!;
      const tax = lines!.find((l) => l.line_type === 'tax')!;
      expect(Number(room.amount)).toBeCloseTo(gross / 1.2, 2);
      expect(Number(room.amount) + Number(tax.amount)).toBeCloseTo(gross, 2);

      const { data: folio } = await supabase.from('folios').select('balance').eq('id', folioId).single();
      expect(Number(folio!.balance)).toBeCloseTo(gross, 2);

      const { data: kpi } = await supabase.from('kpi_daily_snapshots').select('adr').eq('hotel_id', hotelId).eq('business_date', '2032-03-01').single();
      expect(Number(kpi!.adr)).toBeCloseTo(gross / 1.2, 2);
    } finally {
      await setVat(0, true);
    }
  });

  it('idempotent : relancer ne duplique ni la nuitee ni la TVA', async () => {
    await setVat(0.2, true);
    try {
      const { data } = await post('2032-03-01');
      expect(data[0].posted).toBe(0);
      expect(data[0].skipped).toBe(1);
      const { data: lines } = await supabase.from('folio_lines').select('line_type').eq('folio_id', folioId);
      expect(lines!.filter((l) => l.line_type === 'room_charge')).toHaveLength(1);
      expect(lines!.filter((l) => l.line_type === 'tax')).toHaveLength(1);
    } finally {
      await setVat(0, true);
    }
  });

  it('prix HT : la TVA s ajoute au tarif', async () => {
    await setVat(0.2, false);
    try {
      const { data, error } = await post('2032-03-02');
      expect(error).toBeNull();
      expect(Number(data[0].total_posted)).toBeCloseTo(gross * 1.2, 2);
      const { data: line } = await supabase
        .from('folio_lines').select('amount').eq('folio_id', folioId).eq('line_type', 'room_charge').eq('reference', 'NIGHT:2032-03-02').single();
      expect(Number(line!.amount)).toBeCloseTo(gross, 2);
    } finally {
      await setVat(0, true);
    }
  });

  it('TVA a 0 : aucune ligne de taxe', async () => {
    await setVat(0, true);
    const { data } = await post('2032-03-03');
    expect(data[0].posted).toBe(1);
    const { count } = await supabase
      .from('folio_lines').select('id', { count: 'exact', head: true }).eq('folio_id', folioId).eq('line_type', 'tax').eq('reference', 'NIGHT:2032-03-03');
    expect(count).toBe(0);
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

  it('TASK 12 - login cible par code de tenant : refuse un mauvais code, accepte le bon', async () => {
    const { data: staff } = await supabase.from('staff_users').select('id').eq('tenant_id', tenantId).limit(1).single();
    const { data: tenant } = await supabase.from('tenants').select('code').eq('id', tenantId).single();
    const uniqueEmail = `vitest-scope-${Date.now()}@example.com`;
    const { data: hashRaw } = await supabase.rpc('generate_demo_staff_password_hash');
    const { error } = await supabase
      .from('staff_users')
      .update({ email: uniqueEmail, password_hash: hashRaw as string })
      .eq('id', staff!.id);
    expect(error).toBeNull();

    try {
      const wrong = await supabase.rpc('attempt_staff_login', {
        p_email: uniqueEmail, p_password: 'Demo1234!', p_user_agent: 'vitest', p_tenant_code: 'CODE_INEXISTANT',
      });
      expect(wrong.data[0].staff_user_id).toBeNull();

      const right = await supabase.rpc('attempt_staff_login', {
        p_email: uniqueEmail, p_password: 'Demo1234!', p_user_agent: 'vitest', p_tenant_code: tenant!.code,
      });
      expect(right.data[0].staff_user_id).toBe(staff!.id);
      expect(right.data[0].tenant_id).toBe(tenantId);

      // Sans code : email unique -> non ambigu, la connexion reussit aussi (retrocompatibilite)
      const noCode = await supabase.rpc('attempt_staff_login', {
        p_email: uniqueEmail, p_password: 'Demo1234!', p_user_agent: 'vitest',
      });
      expect(noCode.data[0].staff_user_id).toBe(staff!.id);
    } finally {
      // security_events (actor) reference staff_users : supprimer avant le nettoyage du tenant
      await supabase.from('security_events').delete().eq('actor_user_id', staff!.id);
      await supabase.from('login_attempts').delete().eq('email', uniqueEmail);
    }
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
    const { data: staff } = await supabase.from('staff_users').select('id').eq('tenant_id', tenantId).limit(1).single();
    const realStaffId = staff!.id;
    const jtiToRevoke = crypto.randomUUID();
    const otherJti = crypto.randomUUID();

    const before = await supabase.rpc('is_session_valid', {
      p_jti: jtiToRevoke, p_staff_user_id: realStaffId, p_issued_at: new Date().toISOString(),
    });
    expect(before.data).toBe(true);

    const { error: revokeError } = await supabase.rpc('revoke_session', {
      p_jti: jtiToRevoke, p_staff_user_id: realStaffId,
      p_expires_at: new Date(Date.now() + 3600_000).toISOString(), p_reason: 'vitest',
    });
    expect(revokeError).toBeNull();

    const afterRevoked = await supabase.rpc('is_session_valid', {
      p_jti: jtiToRevoke, p_staff_user_id: realStaffId, p_issued_at: new Date().toISOString(),
    });
    expect(afterRevoked.data).toBe(false);

    const afterOther = await supabase.rpc('is_session_valid', {
      p_jti: otherJti, p_staff_user_id: realStaffId, p_issued_at: new Date().toISOString(),
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
