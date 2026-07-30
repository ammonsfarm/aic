import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

async function source(path) {
  return readFile(new URL("../" + path, import.meta.url), "utf8");
}

async function runInstallerWithTimerState(initialState) {
  const tempDirectory = await mkdtemp(join(tmpdir(), "aic-contact-installer-"));
  const fakeSudo = join(tempDirectory, "sudo");
  const commandLog = join(tempDirectory, "sudo.log");
  const timerState = join(tempDirectory, "timer.state");
  try {
    await writeFile(
      fakeSudo,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "printf '%s\\n' \"$*\" >> \"$SUDO_LOG\"",
        "if [[ \"$1\" == \"systemctl\" && \"$2\" == \"enable\" ]]; then",
        "  printf 'enabled\\n' > \"$TIMER_STATE\"",
        "elif [[ \"$1\" == \"systemctl\" && \"$2\" == \"disable\" ]]; then",
        "  printf 'disabled\\n' > \"$TIMER_STATE\"",
        "fi",
      ].join("\n") + "\n",
      { mode: 0o755 },
    );
    await writeFile(timerState, initialState + "\n");
    const environment = {
      ...process.env,
      PATH: tempDirectory + ":" + (process.env.PATH ?? ""),
      SUDO_LOG: commandLog,
      TIMER_STATE: timerState,
    };
    delete environment.ENABLE_TIMER;
    delete environment.START_TIMER;
    const result = spawnSync("bash", ["scripts/install-contact-email-worker.sh"], {
      cwd: repoRoot,
      env: environment,
      encoding: "utf8",
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return {
      commands: await readFile(commandLog, "utf8"),
      timerState: (await readFile(timerState, "utf8")).trim(),
    };
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test("contact email outbox migration is forward-only and defines durable terminal states", async () => {
  const migration = await source("postgres/migrations/028_public_contact_email_delivery.sql");
  assert.match(migration.trim(), /^begin;[\s\S]*commit;$/);
  assert.match(migration, /create table if not exists public_contact_notification_outbox/);
  assert.match(migration, /contact_message_id bigint primary key references public_contact_messages\(id\) on delete cascade/);
  assert.match(migration, /status in \('queued', 'running', 'completed', 'failed'\)/);
  assert.match(migration, /attempt_count integer not null default 0/);
  assert.match(migration, /available_at timestamptz not null default now\(\)/);
  assert.match(migration, /where status = 'queued'/);
  assert.match(migration, /where status = 'running'/);
  assert.match(migration, /'notification_sent'/);
  assert.match(migration, /'notification_failed'/);
  assert.match(migration, /'notification_recovered'/);
  assert.match(migration, /'system_worker'/);
});

test("accepted contact capture inserts message event and optional outbox in one SQL statement", async () => {
  const capture = await source("lib/public-contact.ts");
  const statementStart = capture.indexOf("with inserted as (");
  const messageInsert = capture.indexOf("insert into public_contact_messages", statementStart);
  const eventInsert = capture.indexOf("insert into public_contact_message_events", messageInsert);
  const outboxInsert = capture.indexOf("insert into public_contact_notification_outbox", eventInsert);
  const statementEnd = capture.indexOf("left join queued", outboxInsert);
  assert.ok(statementStart >= 0);
  assert.ok(messageInsert > statementStart);
  assert.ok(eventInsert > messageInsert);
  assert.ok(outboxInsert > eventInsert);
  assert.ok(statementEnd > outboxInsert);
  assert.match(capture, /case when \$14::boolean then 'pending' else 'not_configured' end/);
  assert.match(capture, /where \$14::boolean/);
  assert.match(capture, /contactEmailDeliveryReady\(\)/);
});

test("SMTP worker is bounded provider-neutral and records only actual outcomes", async () => {
  const worker = await source("scripts/process_contact_email_outbox.py");
  assert.match(worker, /import smtplib/);
  assert.doesNotMatch(worker, /\brequests\b|\bmailchimp\b/i);
  assert.match(worker, /MAX_ATTEMPTS = 8/);
  assert.match(worker, /STALE_RUNNING_SECONDS = 600/);
  assert.match(worker, /MAX_MESSAGE_BYTES = 32_768/);
  assert.match(worker, /for update of outbox skip locked/i);
  assert.match(worker, /status = 'running'[\s\S]*worker_id = %s/);
  assert.match(worker, /notification_status = 'sent'/);
  assert.match(worker, /SMTP server accepted the notification for delivery/);
  assert.match(worker, /notification_status = %s/);
  assert.match(worker, /'notification_failed'/);
  assert.match(worker, /'outcome', 'unknown'/);
  assert.match(worker, /Message-ID/);
  assert.match(worker, /DEFAULT_ENV_FILE = Path\("\/mnt\/storage\/aic\/\.env"\)/);
  const transportStart = worker.indexOf("send_smtp(config, message)");
  const transportFailure = worker.indexOf("except Exception as exc:", transportStart);
  const finalizeStart = worker.indexOf("finalized = complete_request", transportFailure);
  const finalizeFailure = worker.indexOf("except Exception:", finalizeStart);
  assert.ok(transportStart >= 0);
  assert.ok(transportFailure > transportStart);
  assert.ok(finalizeStart > transportFailure);
  assert.ok(finalizeFailure > finalizeStart);
  assert.match(worker.slice(finalizeFailure), /accepted_unrecorded \+= 1[\s\S]*break/);
  assert.doesNotMatch(
    worker.slice(finalizeStart, worker.indexOf("if finalized:", finalizeStart)),
    /fail_request\(/,
  );
  assert.match(worker, /return 1 if accepted_unrecorded else 0/);
});

test("contact email worker systemd and deploy wiring use canonical authority and fail closed", async () => {
  const [service, timer, installer, deploy, databaseEnv, example] = await Promise.all([
    source("systemd/aic-contact-email-worker.service"),
    source("systemd/aic-contact-email-worker.timer"),
    source("scripts/install-contact-email-worker.sh"),
    source("scripts/deploy-farm-web.sh"),
    source("scripts/aic_database_env.py"),
    source(".env.example"),
  ]);
  assert.match(service, /UnsetEnvironment=DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD DATABASE_URL/);
  assert.match(service, /UnsetEnvironment=PGHOST[\s\S]*PGSSLMODE/);
  assert.match(service, /UnsetEnvironment=CONTACT_EMAIL_DELIVERY_ENABLED[\s\S]*CONTACT_EMAIL_TO/);
  assert.match(service, /UnsetEnvironment=PYTHONPATH PYTHONHOME LD_PRELOAD LD_LIBRARY_PATH BASH_ENV ENV NODE_OPTIONS/);
  assert.match(service, /process_contact_email_outbox\.py --env-file \/mnt\/storage\/aic\/\.env/);
  assert.match(service, /^Environment=PYTHONDONTWRITEBYTECODE=1$/m);
  assert.match(service, /^NoNewPrivileges=true$/m);
  assert.match(service, /^CapabilityBoundingSet=$/m);
  assert.match(service, /^AmbientCapabilities=$/m);
  assert.match(service, /^PrivateTmp=true$/m);
  assert.match(service, /^PrivateDevices=true$/m);
  assert.match(service, /^ProtectSystem=strict$/m);
  assert.match(service, /^ProtectHome=true$/m);
  assert.match(service, /^ReadOnlyPaths=\/mnt\/storage\/aic$/m);
  assert.match(service, /^ProtectKernelTunables=true$/m);
  assert.match(service, /^ProtectKernelModules=true$/m);
  assert.match(service, /^ProtectKernelLogs=true$/m);
  assert.match(service, /^ProtectControlGroups=true$/m);
  assert.match(service, /^ProtectClock=true$/m);
  assert.match(service, /^ProtectHostname=true$/m);
  assert.match(service, /^RestrictSUIDSGID=true$/m);
  assert.match(service, /^RestrictRealtime=true$/m);
  assert.match(service, /^LockPersonality=true$/m);
  assert.match(service, /^SystemCallArchitectures=native$/m);
  assert.match(service, /^RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6$/m);
  assert.match(service, /^UMask=0077$/m);
  assert.doesNotMatch(service, /^PrivateNetwork=true$/m);
  assert.match(timer, /OnUnitActiveSec=1min/);
  assert.match(installer, /ENABLE_TIMER="\$\{ENABLE_TIMER:-0\}"/);
  assert.match(installer, /START_TIMER="\$\{START_TIMER:-0\}"/);
  assert.doesNotMatch(installer, /systemctl disable/);
  assert.match(deploy, /INSTALL_CONTACT_EMAIL_WORKER/);
  assert.match(deploy, /process_contact_email_outbox\.py/);
  assert.match(deploy, /ENABLE_TIMER=0 START_TIMER=0 bash scripts\/install-contact-email-worker\.sh/);
  assert.doesNotMatch(deploy, /timers_to_start\+=\(aic-contact-email-worker\.timer\)/);
  assert.match(deploy, /Contact email delivery is disabled or incomplete; keeping its timer disabled/);
  assert.match(deploy, /\\\$\{contact_email_ready\}/);

  const failureStart = deploy.indexOf("deployment_failed() {");
  const failureEnd = deploy.indexOf("trap 'deployment_failed", failureStart);
  const failureHandler = deploy.slice(failureStart, failureEnd);
  const forwardOnly = failureHandler.indexOf("The forward-only migration phase started");
  const failureDisable = failureHandler.indexOf("disable --now aic-contact-email-worker.timer");
  assert.ok(failureStart >= 0);
  assert.ok(failureEnd > failureStart);
  assert.ok(forwardOnly >= 0);
  assert.ok(failureDisable > forwardOnly);

  const install = deploy.indexOf("ENABLE_TIMER=0 START_TIMER=0 bash scripts/install-contact-email-worker.sh");
  const webHealth = deploy.indexOf('echo "Checking health on ${SERVICE_URL}"');
  const podcastMigration = deploy.indexOf("bash scripts/migrate-legacy-podcast-cron.sh");
  const contactEnable = deploy.indexOf("systemctl enable --now aic-contact-email-worker.timer");
  const clearTraps = deploy.lastIndexOf("trap - EXIT INT TERM");
  assert.ok(install >= 0);
  assert.ok(webHealth > install);
  assert.ok(podcastMigration > webHealth);
  assert.ok(contactEnable > podcastMigration);
  assert.ok(clearTraps > contactEnable);
  assert.match(databaseEnv, /CONTACT_EMAIL_PROVIDER_ENV_KEYS/);
  assert.match(databaseEnv, /WORKER_PROVIDER_ENV_KEYS/);
  assert.match(example, /CONTACT_EMAIL_DELIVERY_ENABLED=false/);
  assert.match(example, /CONTACT_EMAIL_SMTP_STARTTLS=true/);
  assert.match(example, /CONTACT_EMAIL_TO=\s*$/m);
});

test("contact installer defaults preserve both fresh-disabled and prior-enabled timer state", async () => {
  const fresh = await runInstallerWithTimerState("disabled");
  assert.equal(fresh.timerState, "disabled");
  assert.doesNotMatch(fresh.commands, /systemctl (?:enable|disable|start)\b/);

  const priorRelease = await runInstallerWithTimerState("enabled");
  assert.equal(priorRelease.timerState, "enabled");
  assert.doesNotMatch(priorRelease.commands, /systemctl (?:enable|disable|start)\b/);
});

test("contact email systemd units pass systemd-analyze verify when available", (context) => {
  const result = spawnSync(
    "systemd-analyze",
    [
      "verify",
      "systemd/aic-contact-email-worker.service",
      "systemd/aic-contact-email-worker.timer",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (result.error && result.error.code === "ENOENT") {
    context.skip("systemd-analyze is unavailable on this host");
    return;
  }
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
