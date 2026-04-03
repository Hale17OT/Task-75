#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  docker compose down --volumes --remove-orphans >/dev/null 2>&1 || true
}

trap cleanup EXIT

rand_hex() {
  local bytes="$1"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
  else
    head -c "$bytes" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

rand_b64() {
  local bytes="$1"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "$bytes" | tr -d '\n'
  else
    head -c "$bytes" /dev/urandom | base64 | tr -d '\n'
  fi
}

echo "[tests] resetting Docker state for deterministic credentials"
docker compose down --volumes --remove-orphans >/dev/null 2>&1 || true

export BACKEND_DEMO_SEED_USERS="${BACKEND_DEMO_SEED_USERS:-true}"
if [ -z "${MYSQL_USER:-}" ] || [ "${MYSQL_USER}" = "REPLACE_WITH_DB_USER" ]; then
  export MYSQL_USER="sentinelfit_app"
  echo "[tests] set MYSQL_USER for test runtime"
fi
if [ -z "${MYSQL_PASSWORD:-}" ] || [ "${MYSQL_PASSWORD}" = "REPLACE_WITH_DB_PASSWORD" ] || [ "${MYSQL_PASSWORD}" = "sentinelfit" ]; then
  export MYSQL_PASSWORD="SentinelFitLocal_DB_9f3c1a2b"
  echo "[tests] set MYSQL_PASSWORD to compose-compatible default for test runtime"
fi
if [ -z "${MYSQL_ROOT_PASSWORD:-}" ] || [ "${MYSQL_ROOT_PASSWORD}" = "REPLACE_WITH_DB_ROOT_PASSWORD" ] || [ "${MYSQL_ROOT_PASSWORD}" = "rootpassword" ]; then
  export MYSQL_ROOT_PASSWORD="SentinelFitLocal_Root_6a8d2c4e"
  echo "[tests] set MYSQL_ROOT_PASSWORD to compose-compatible default for test runtime"
fi
if [ -z "${BACKEND_KEY_VAULT_MASTER_KEY:-}" ] || [ "${BACKEND_KEY_VAULT_MASTER_KEY}" = "REPLACE_WITH_32_BYTE_BASE64_KEY" ]; then
  export BACKEND_KEY_VAULT_MASTER_KEY="$(rand_b64 32)"
  echo "[tests] generated ephemeral BACKEND_KEY_VAULT_MASTER_KEY for test runtime"
fi

compose_project="${COMPOSE_PROJECT_NAME:-$(basename "$PWD")}"
playwright_image="${PLAYWRIGHT_DOCKER_IMAGE:-node:20-bookworm}"
playwright_base_url="${PLAYWRIGHT_BASE_URL:-http://127.0.0.1:5173}"
playwright_backend_url="${PLAYWRIGHT_BACKEND_URL:-http://127.0.0.1:3000}"
playwright_cache_volume="${PLAYWRIGHT_CACHE_VOLUME:-sentinelfit-playwright-cache}"
npm_cache_volume="${NPM_CACHE_VOLUME:-sentinelfit-npm-cache}"

run_playwright() {
  local bootstrap_only="$1"
  local test_command="$2"
  local -a bootstrap_env=()
  if [ "$bootstrap_only" = "true" ]; then
    bootstrap_env+=(-e PLAYWRIGHT_BOOTSTRAP_ONLY=true)
  fi

  docker run --rm \
    --network host \
    -v "$PWD:/workspace" \
    -w /workspace \
    -v "${playwright_cache_volume}:/ms-playwright" \
    -v "${npm_cache_volume}:/root/.npm" \
    -e CI=1 \
    -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    -e PLAYWRIGHT_BASE_URL="$playwright_base_url" \
    -e PLAYWRIGHT_BACKEND_URL="$playwright_backend_url" \
    -e PLAYWRIGHT_SKIP_WARM_LOCK=true \
    "${bootstrap_env[@]}" \
    "$playwright_image" \
    bash -lc "npm ci && npx playwright install --with-deps chromium && $test_command"
}

echo "[tests] building backend/frontend images"
docker compose build backend frontend

echo "[tests] running backend tests in container"
docker compose run --rm --no-deps backend npm test

echo "[tests] running frontend tests in container"
docker compose run --rm --no-deps frontend npm test

echo "[tests] running backend typecheck in container"
docker compose run --rm --no-deps backend npm run typecheck

echo "[tests] running frontend typecheck in container"
docker compose run --rm --no-deps frontend npm run typecheck

echo "[tests] starting Docker runtime"
docker compose up --build -d

echo "[tests] waiting for services"
for i in $(seq 1 60); do
  if docker compose ps backend 2>/dev/null | grep -qi "exited"; then
    echo "[tests] backend container exited during startup, retrying backend service"
    docker compose up -d backend >/dev/null 2>&1 || true
  fi
  if curl -fsS http://localhost:3000/health/ready >/dev/null 2>&1 && curl -fsS http://localhost:5173 >/dev/null 2>&1; then
    break
  fi

  if [ "$i" -eq 60 ]; then
    echo "[tests] services did not become ready in time"
    docker compose logs
    exit 1
  fi

  sleep 2
done

echo "[tests] running Playwright end-to-end tests in container"
run_playwright "false" "npm run test:e2e"

echo "[tests] security regression: coach cannot access admin console"
security_status="$(docker compose exec -T backend node <<'NODE'
const crypto = require('node:crypto');

const sign = (secret, method, path, body) => {
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomUUID();
  const bodyString = body ? JSON.stringify(body) : "";
  const bodyHash = crypto.createHash("sha256").update(bodyString).digest("hex");
  const payload = [method.toUpperCase(), path, timestamp, nonce, bodyHash].join("\n");
  const signature = crypto
    .createHmac("sha256", Buffer.from(secret, "base64"))
    .update(payload)
    .digest("hex");
  return { timestamp, nonce, signature };
};

const parseCookies = (response) => {
  const values = response.headers.getSetCookie?.() ?? [];
  const map = new Map();
  for (const value of values) {
    const [pair] = value.split(";");
    const [key, cookieValue] = pair.split("=");
    map.set(key.trim(), cookieValue);
  }
  return map;
};

(async () => {
  const login = await fetch("http://127.0.0.1:3000/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-station-token": "Regression-Desk-01"
    },
    body: JSON.stringify({ username: "coach", password: "Coach12345!X" })
  });
  const loginPayload = await login.json();
  if (!login.ok) {
    console.log("login_failed");
    process.exit(0);
  }

  const sessionSecret = loginPayload?.data?.sessionSecret;
  const cookies = parseCookies(login);
  const sessionCookie = cookies.get("sf_session");
  const workstationCookie = cookies.get("sf_workstation");
  if (!sessionCookie || !workstationCookie || !sessionSecret) {
    console.log("missing_auth_material");
    process.exit(0);
  }

  const path = "/api/admin/console";
  let status = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const sig = sign(sessionSecret, "GET", path);
    const response = await fetch(`http://127.0.0.1:3000${path}`, {
      method: "GET",
      headers: {
        cookie: `sf_session=${sessionCookie}; sf_workstation=${workstationCookie}`,
        "x-station-token": "Regression-Desk-01",
        "x-sf-timestamp": sig.timestamp,
        "x-sf-nonce": sig.nonce,
        "x-sf-signature": sig.signature
      }
    });
    status = response.status;
    if (status !== 429) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 65000));
  }
  console.log(String(status));
})();
NODE
)"
if [ "$security_status" != "403" ]; then
  echo "[tests] expected 403 for coach access to admin console, got: $security_status"
  exit 1
fi

echo "[tests] integrity regression: biometric audit table is immutable"
docker compose exec -T mysql mysql -u"${MYSQL_USER}" -p"${MYSQL_PASSWORD}" "${MYSQL_DATABASE:-sentinelfit}" -e \
  "INSERT INTO biometric_audit_log (member_user_id, face_record_id, event_type, details_json, actor_user_id) VALUES (1, NULL, 'immutability_probe', JSON_OBJECT('source', 'run_tests'), 1);" >/dev/null
if docker compose exec -T mysql mysql -u"${MYSQL_USER}" -p"${MYSQL_PASSWORD}" "${MYSQL_DATABASE:-sentinelfit}" -e \
  "DELETE FROM biometric_audit_log WHERE event_type = 'immutability_probe';" >/dev/null 2>&1; then
  echo "[tests] expected immutable audit delete to fail, but it succeeded"
  exit 1
fi

echo "[tests] integrity regression: biometric audit rows survive referenced-user delete attempts"
if docker compose exec -T mysql mysql -u"${MYSQL_USER}" -p"${MYSQL_PASSWORD}" "${MYSQL_DATABASE:-sentinelfit}" -e \
  "DELETE FROM users WHERE id = 1;" >/dev/null 2>&1; then
  echo "[tests] expected deleting users referenced by biometric_audit_log to fail, but it succeeded"
  exit 1
fi

echo "[tests] schema consistency check: encrypted fields mapped to UI-safe helpers"
docker run --rm \
  -v "$PWD:/workspace" \
  -w /workspace \
  node:20-alpine node <<'NODE'
const fs = require("node:fs");
const schema = fs.readFileSync("backend/src/schema.ts", "utf8");
const memberService = fs.readFileSync("backend/src/services/member-service.ts", "utf8");
const faceService = fs.readFileSync("backend/src/services/face-service.ts", "utf8");
const authService = fs.readFileSync("backend/src/services/auth-service.ts", "utf8");
const memberView = fs.readFileSync("frontend/src/components/MembersView.vue", "utf8");
const types = fs.readFileSync("frontend/src/types.ts", "utf8");

const checks = [
  {
    label: "phone_encrypted -> decrypted+masked member output",
    pass:
      schema.includes("phone_encrypted") &&
      memberService.includes("cryptoService.decrypt") &&
      memberService.includes("maskPhone") &&
      memberView.includes("phoneMasked")
  },
  {
    label: "session_secret -> encrypted at rest and restored via decrypt",
    pass:
      schema.includes("session_secret") &&
      authService.includes("cryptoService.encrypt(sessionSecret)") &&
      authService.includes("cryptoService.decrypt")
  },
  {
    label: "face artifact key IDs -> encrypted/decrypted handling present",
    pass:
      schema.includes("center_image_key_id") &&
      schema.includes("turn_image_key_id") &&
      schema.includes("average_hash_key_id") &&
      faceService.includes("cryptoService.encryptBytes") &&
      faceService.includes("cryptoService.decrypt")
  },
  {
    label: "UI contracts expose masked/safe fields",
    pass:
      types.includes("phoneMasked: string | null") &&
      !types.includes("phoneEncrypted")
  }
];

const failed = checks.filter((entry) => !entry.pass);
if (failed.length > 0) {
  for (const entry of failed) {
    console.error(`schema-check-failed: ${entry.label}`);
  }
  process.exit(1);
}
NODE

echo "[tests] restarting Docker runtime for clean-install bootstrap verification"
docker compose down --volumes --remove-orphans >/dev/null 2>&1 || true
BACKEND_DEMO_SEED_USERS=false docker compose up --build -d

echo "[tests] waiting for clean-install services"
for i in $(seq 1 60); do
  if docker compose ps backend 2>/dev/null | grep -qi "exited"; then
    echo "[tests] backend container exited during clean-install startup, retrying backend service"
    docker compose up -d backend >/dev/null 2>&1 || true
  fi
  if curl -fsS http://localhost:3000/health/ready >/dev/null 2>&1 && curl -fsS http://localhost:5173 >/dev/null 2>&1; then
    break
  fi

  if [ "$i" -eq 60 ]; then
    echo "[tests] clean-install services did not become ready in time"
    docker compose logs
    exit 1
  fi

  sleep 2
done

echo "[tests] running clean-install bootstrap Playwright test in container"
run_playwright "true" "npx playwright test tests/e2e/bootstrap.spec.ts"

echo "[tests] completed successfully"
