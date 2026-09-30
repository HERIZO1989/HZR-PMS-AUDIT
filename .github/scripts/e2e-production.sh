#!/bin/bash
# Suite E2E HTTP reelle contre l'application deployee (pas de mock, pas de simulation SQL).
# Cree ses propres donnees isolees (prefixees E2E CI) et les nettoie via e2e-cleanup.sh.
set -uo pipefail

STATE_FILE="/tmp/e2e_state.env"
: > "$STATE_FILE"

fail() { echo "ECHEC: $1"; exit 1; }
ok() { echo "OK: $1"; }

sb_post() { # $1=rpc name, $2=json body
  curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/$1" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" -d "$2"
}
sb_get() { # $1=path+query
  curl -s "$SUPABASE_URL/rest/v1/$1" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
}
sb_patch() { # $1=path+query, $2=json body
  curl -s -X PATCH "$SUPABASE_URL/rest/v1/$1" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" -H "Prefer: return=minimal" -d "$2"
}

echo "=== 1. Creation des hotels de test isoles (A = principal, B = etranger pour IDOR) ==="
HOTEL_A=$(sb_post generate_demo_hotel '{"p_tenant_name":"E2E CI Tenant A","p_hotel_name":"E2E CI Hotel A","p_room_count":5,"p_guest_count":1,"p_reservation_count":0}')
TENANT_A_ID=$(echo "$HOTEL_A" | jq -r '.[0].out_tenant_id')
HOTEL_A_ID=$(echo "$HOTEL_A" | jq -r '.[0].out_hotel_id')
[ "$TENANT_A_ID" != "null" ] && [ -n "$TENANT_A_ID" ] || fail "creation hotel A: $HOTEL_A"

HOTEL_B=$(sb_post generate_demo_hotel '{"p_tenant_name":"E2E CI Tenant B","p_hotel_name":"E2E CI Hotel B","p_room_count":2,"p_guest_count":0,"p_reservation_count":0}')
TENANT_B_ID=$(echo "$HOTEL_B" | jq -r '.[0].out_tenant_id')
HOTEL_B_ID=$(echo "$HOTEL_B" | jq -r '.[0].out_hotel_id')
[ "$TENANT_B_ID" != "null" ] && [ -n "$TENANT_B_ID" ] || fail "creation hotel B: $HOTEL_B"

echo "TENANT_A_ID=$TENANT_A_ID" >> "$STATE_FILE"
echo "HOTEL_A_ID=$HOTEL_A_ID" >> "$STATE_FILE"
echo "TENANT_B_ID=$TENANT_B_ID" >> "$STATE_FILE"
echo "HOTEL_B_ID=$HOTEL_B_ID" >> "$STATE_FILE"
ok "hotels A ($HOTEL_A_ID) et B ($HOTEL_B_ID) crees"

echo "=== 2. Recuperation d'un compte staff de l'hotel A + mot de passe reel ==="
STAFF=$(sb_get "staff_users?tenant_id=eq.$TENANT_A_ID&select=id,email&limit=1")
STAFF_ID=$(echo "$STAFF" | jq -r '.[0].id')
STAFF_EMAIL=$(echo "$STAFF" | jq -r '.[0].email')
[ "$STAFF_ID" != "null" ] && [ -n "$STAFF_ID" ] || fail "recuperation staff: $STAFF"

# verify_staff_login cherche par email seul : les comptes demo (owner@demo.local...) existent dans
# plusieurs tenants, le login tomberait sur un autre tenant. On donne donc au compte de test un
# email unique pour que le login HTTP vise sans ambiguite le compte de l'hotel A.
STAFF_EMAIL="e2e-ci-$(date +%s)-$RANDOM@ci.local"
echo "E2E_EMAIL=$STAFF_EMAIL" >> "$STATE_FILE"

HASH_RAW=$(sb_post generate_demo_staff_password_hash '{}')
HASH_CLEAN=$(echo "$HASH_RAW" | jq -r '.')
sb_patch "staff_users?id=eq.$STAFF_ID" "{\"password_hash\":\"$HASH_CLEAN\",\"email\":\"$STAFF_EMAIL\"}" > /dev/null
ok "staff $STAFF_EMAIL pret avec mot de passe Demo1234!"

echo "=== 3. TASK 2 — rate limiting reel (5 echecs -> verrouillage) ==="
for i in 1 2 3 4 5; do
  curl -s -X POST "$BASE_URL/api/auth/login" -H "Content-Type: application/json" \
    -d "{\"email\":\"$STAFF_EMAIL\",\"password\":\"wrong\"}" > /dev/null
done
LOCK_CODE=$(curl -s -o /tmp/lock_resp.json -w "%{http_code}" -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" -d "{\"email\":\"$STAFF_EMAIL\",\"password\":\"Demo1234!\"}")
[ "$LOCK_CODE" = "429" ] || fail "rate limiting: attendu 429, obtenu $LOCK_CODE ($(cat /tmp/lock_resp.json))"
ok "verrouillage confirme en HTTP reel (429) meme avec le bon mot de passe"

# Debloque pour la suite du test (les tentatives etaient volontaires, propres a ce test)
sb_patch "login_attempts?email=eq.$STAFF_EMAIL" '{}' > /dev/null 2>&1 || true
curl -s -X DELETE "$SUPABASE_URL/rest/v1/login_attempts?email=eq.$STAFF_EMAIL" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" > /dev/null

echo "=== 4. Login reel (HTTP), cookie de session ==="
COOKIE_JAR=$(mktemp)
LOGIN_CODE=$(curl -s -c "$COOKIE_JAR" -o /tmp/login_resp.json -w "%{http_code}" -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" -d "{\"email\":\"$STAFF_EMAIL\",\"password\":\"Demo1234!\"}")
[ "$LOGIN_CODE" = "200" ] || fail "login: attendu 200, obtenu $LOGIN_CODE ($(cat /tmp/login_resp.json))"
ok "login HTTP reel reussi"

echo "=== 5. TASK 3 — IDOR cross-hotel en HTTP reel ==="
IDOR_CODE=$(curl -s -o /tmp/idor_resp.json -w "%{http_code}" -b "$COOKIE_JAR" "$BASE_URL/api/reservations?hotelId=$HOTEL_B_ID")
[ "$IDOR_CODE" = "403" ] || fail "IDOR: attendu 403, obtenu $IDOR_CODE ($(cat /tmp/idor_resp.json))"
ok "acces cross-hotel refuse en HTTP reel (403)"

echo "=== 6. TASK 1 — creation de reservation via l'API HTTP reelle ==="
ROOM_TYPE_ID=$(sb_get "room_types?hotel_id=eq.$HOTEL_A_ID&select=id&limit=1" | jq -r '.[0].id')
CREATE_CODE=$(curl -s -b "$COOKIE_JAR" -o /tmp/create_resp.json -w "%{http_code}" -X POST "$BASE_URL/api/reservations" \
  -H "Content-Type: application/json" \
  -d "{\"roomTypeId\":\"$ROOM_TYPE_ID\",\"arrivalDate\":\"2027-06-01\",\"departureDate\":\"2027-06-03\",\"guestEmail\":\"e2e-ci-test@example.com\",\"guestFirstName\":\"CI\",\"guestLastName\":\"Test\"}")
[ "$CREATE_CODE" = "201" ] || fail "creation reservation: attendu 201, obtenu $CREATE_CODE ($(cat /tmp/create_resp.json))"
ok "reservation creee via HTTP reel (201)"

echo "=== 7. TASK 2 — revocation reelle : logout puis reutilisation de l'ancien cookie ==="
curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/logout" > /dev/null
REUSE_CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIE_JAR" "$BASE_URL/api/reservations?hotelId=$HOTEL_A_ID")
[ "$REUSE_CODE" = "401" ] || fail "revocation: attendu 401 apres logout, obtenu $REUSE_CODE"
ok "session revoquee des le logout, ancien cookie rejete en HTTP reel (401)"

echo ""
echo "TOUS LES TESTS E2E HTTP REELS ONT REUSSI"
