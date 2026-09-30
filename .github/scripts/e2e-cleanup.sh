#!/bin/bash
# Nettoie integralement les donnees creees par e2e-production.sh, meme en cas d'echec partiel.
set -uo pipefail

STATE_FILE="/tmp/e2e_state.env"
if [ ! -f "$STATE_FILE" ]; then
  echo "Aucun etat E2E trouve, rien a nettoyer."
  exit 0
fi
source "$STATE_FILE"

sb_del() { # $1=path+query
  curl -s -X DELETE "$SUPABASE_URL/rest/v1/$1" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" > /dev/null
}

# Tentatives de login du compte de test (email unique E2E)
[ -n "${E2E_EMAIL:-}" ] && sb_del "login_attempts?email=eq.$E2E_EMAIL"

for HOTEL_ID in "${HOTEL_A_ID:-}" "${HOTEL_B_ID:-}"; do
  [ -z "$HOTEL_ID" ] && continue
  sb_del "audit_events?hotel_id=eq.$HOTEL_ID"
  sb_del "housekeeping_tasks?hotel_id=eq.$HOTEL_ID"
  sb_del "payments?hotel_id=eq.$HOTEL_ID"
  sb_del "folio_lines?hotel_id=eq.$HOTEL_ID"
  sb_del "folios?hotel_id=eq.$HOTEL_ID"
  sb_del "reservation_stays?hotel_id=eq.$HOTEL_ID"
  sb_del "reservations?hotel_id=eq.$HOTEL_ID"
  sb_del "concierge_requests?hotel_id=eq.$HOTEL_ID"
  sb_del "night_audit_checks?hotel_id=eq.$HOTEL_ID"
  sb_del "night_audit_runs?hotel_id=eq.$HOTEL_ID"
  sb_del "rate_calendar?hotel_id=eq.$HOTEL_ID"
  sb_del "rate_plans?hotel_id=eq.$HOTEL_ID"
  sb_del "rooms?hotel_id=eq.$HOTEL_ID"
  sb_del "room_types?hotel_id=eq.$HOTEL_ID"
done

for TENANT_ID in "${TENANT_A_ID:-}" "${TENANT_B_ID:-}"; do
  [ -z "$TENANT_ID" ] && continue
  sb_del "security_events?tenant_id=eq.$TENANT_ID"
  STAFF_IDS=$(curl -s "$SUPABASE_URL/rest/v1/staff_users?tenant_id=eq.$TENANT_ID&select=id" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq -r '.[].id')
  for SID in $STAFF_IDS; do
    sb_del "staff_user_roles?staff_user_id=eq.$SID"
  done
  ROLE_IDS=$(curl -s "$SUPABASE_URL/rest/v1/roles?tenant_id=eq.$TENANT_ID&select=id" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq -r '.[].id')
  for RID in $ROLE_IDS; do
    sb_del "role_permissions?role_id=eq.$RID"
  done
  sb_del "staff_users?tenant_id=eq.$TENANT_ID"
  sb_del "roles?tenant_id=eq.$TENANT_ID"
  sb_del "guests?tenant_id=eq.$TENANT_ID"
  sb_del "subscriptions?tenant_id=eq.$TENANT_ID"
done

for HOTEL_ID in "${HOTEL_A_ID:-}" "${HOTEL_B_ID:-}"; do
  [ -n "$HOTEL_ID" ] && sb_del "hotels?id=eq.$HOTEL_ID"
done
for TENANT_ID in "${TENANT_A_ID:-}" "${TENANT_B_ID:-}"; do
  [ -n "$TENANT_ID" ] && sb_del "tenants?id=eq.$TENANT_ID"
done

echo "Nettoyage E2E termine (tenants A/B et toutes leurs donnees supprimes)."
