/**
 * MeshCue Connect — Multi-Tenant Data Store (SQLite-backed)
 *
 * Persistent store for clinics, patients, and messages using better-sqlite3.
 * Falls back to in-memory Maps if better-sqlite3 is unavailable.
 *
 * Public API is identical to the previous in-memory implementation —
 * this is a drop-in replacement.
 */

import { randomUUID } from "node:crypto";
import type {
  Clinic,
  ClinicChannelConfig,
  PatientContact,
  ConnectMessage,
} from "./types.js";

// ---------------------------------------------------------------------------
// Try to load better-sqlite3; if it's missing we fall back to in-memory Maps.
// ---------------------------------------------------------------------------

let Database: typeof import("better-sqlite3") | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = (await import("better-sqlite3")).default;
} catch {
  Database = undefined;
}

// ---------------------------------------------------------------------------
// SQLite-backed ConnectStore
// ---------------------------------------------------------------------------

export class ConnectStore {
  private db: import("better-sqlite3").Database | null = null;
  private usingSqlite = false;

  // In-memory fallback structures (same as the original implementation)
  private _clinics: Map<string, Clinic> = new Map();
  private _patients: Map<string, PatientContact> = new Map();
  private _patientsByPhone: Map<string, string> = new Map();
  private _patientsByClinic: Map<string, Set<string>> = new Map();
  private _messages: ConnectMessage[] = [];
  private _messageQueue: ConnectMessage[] = [];

  constructor(dbPath?: string) {
    if (Database) {
      try {
        const resolvedPath = dbPath ?? ":memory:";
        this.db = new (Database as unknown as new (path: string, opts?: Record<string, unknown>) => import("better-sqlite3").Database)(resolvedPath);
        this.db.pragma("journal_mode = WAL");
        this.db.pragma("foreign_keys = ON");
        this._initSchema();
        this.usingSqlite = true;
      } catch (err) {
        console.warn(
          "[MeshCue Connect] SQLite initialization failed — using in-memory store. " +
          "Data will NOT persist across restarts.",
          err instanceof Error ? err.message : err,
        );
        this.db = null;
        this.usingSqlite = false;
      }
    } else {
      console.warn(
        "[MeshCue Connect] better-sqlite3 not available — using in-memory store. " +
        "Install better-sqlite3 for persistent storage.",
      );
    }
  }

  // ─── Schema Initialization ───────────────────────────────────

  private _initSchema(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS clinics (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        location TEXT NOT NULL,
        country TEXT NOT NULL,
        language TEXT NOT NULL,
        timezone TEXT NOT NULL,
        channels TEXT NOT NULL DEFAULT '{}',
        admin_phone TEXT NOT NULL,
        admin_name TEXT NOT NULL,
        operating_hours TEXT,
        emergency_phone TEXT,
        tier TEXT NOT NULL DEFAULT 'free',
        created_at TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS patients (
        id TEXT PRIMARY KEY,
        clinic_id TEXT NOT NULL,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'en',
        preferred_channel TEXT NOT NULL DEFAULT 'sms',
        consent_status TEXT NOT NULL DEFAULT 'pending',
        consent_date TEXT,
        emergency_contacts TEXT NOT NULL DEFAULT '[]',
        chw_id TEXT,
        FOREIGN KEY (clinic_id) REFERENCES clinics(id)
      );

      CREATE INDEX IF NOT EXISTS idx_patients_clinic ON patients(clinic_id);
      CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        clinic_id TEXT NOT NULL,
        patient_id TEXT,
        direction TEXT NOT NULL,
        channel TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'routine',
        "from" TEXT NOT NULL,
        "to" TEXT NOT NULL,
        template TEXT NOT NULL,
        template_data TEXT NOT NULL DEFAULT '{}',
        language TEXT NOT NULL DEFAULT 'en',
        body TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        created_at TEXT NOT NULL,
        sent_at TEXT,
        delivered_at TEXT,
        fail_reason TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3
      );

      CREATE INDEX IF NOT EXISTS idx_messages_clinic ON messages(clinic_id);
      CREATE INDEX IF NOT EXISTS idx_messages_patient ON messages(patient_id);

      CREATE TABLE IF NOT EXISTS consent_log (
        id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL,
        action TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS message_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        clinic_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_retry TEXT,
        message_data TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_queue_clinic ON message_queue(clinic_id);
      CREATE INDEX IF NOT EXISTS idx_queue_status ON message_queue(status);
    `);
  }

  // ─── Clinic CRUD ──────────────────────────────────────────

  registerClinic(input: Omit<Clinic, "id" | "createdAt">): Clinic {
    const clinic: Clinic = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    if (this.usingSqlite && this.db) {
      this.db.prepare(`
        INSERT INTO clinics (id, name, location, country, language, timezone, channels,
          admin_phone, admin_name, operating_hours, emergency_phone, tier, created_at, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        clinic.id,
        clinic.name,
        clinic.location,
        clinic.country,
        clinic.language,
        clinic.timezone,
        JSON.stringify(clinic.channels),
        clinic.adminPhone,
        clinic.adminName,
        clinic.operatingHours ? JSON.stringify(clinic.operatingHours) : null,
        clinic.emergencyPhone ?? null,
        clinic.tier,
        clinic.createdAt,
        clinic.active ? 1 : 0,
      );
      return clinic;
    }

    // In-memory fallback
    this._clinics.set(clinic.id, clinic);
    this._patientsByClinic.set(clinic.id, new Set());
    return clinic;
  }

  getClinic(clinicId: string): Clinic | undefined {
    if (this.usingSqlite && this.db) {
      const row = this.db.prepare("SELECT * FROM clinics WHERE id = ?").get(clinicId) as Record<string, unknown> | undefined;
      return row ? this._rowToClinic(row) : undefined;
    }
    return this._clinics.get(clinicId);
  }

  updateClinic(clinicId: string, updates: Partial<Clinic>): Clinic {
    const clinic = this.getClinic(clinicId);
    if (!clinic) throw new Error(`Clinic not found: ${clinicId}`);

    const updated: Clinic = { ...clinic, ...updates, id: clinic.id, createdAt: clinic.createdAt };

    if (this.usingSqlite && this.db) {
      this.db.prepare(`
        UPDATE clinics SET name = ?, location = ?, country = ?, language = ?, timezone = ?,
          channels = ?, admin_phone = ?, admin_name = ?, operating_hours = ?,
          emergency_phone = ?, tier = ?, active = ?
        WHERE id = ?
      `).run(
        updated.name,
        updated.location,
        updated.country,
        updated.language,
        updated.timezone,
        JSON.stringify(updated.channels),
        updated.adminPhone,
        updated.adminName,
        updated.operatingHours ? JSON.stringify(updated.operatingHours) : null,
        updated.emergencyPhone ?? null,
        updated.tier,
        updated.active ? 1 : 0,
        clinicId,
      );
      return updated;
    }

    this._clinics.set(clinicId, updated);
    return updated;
  }

  updateClinicChannels(clinicId: string, channels: Partial<ClinicChannelConfig>): Clinic {
    const clinic = this.getClinic(clinicId);
    if (!clinic) throw new Error(`Clinic not found: ${clinicId}`);

    const updated: Clinic = {
      ...clinic,
      channels: { ...clinic.channels, ...channels },
    };

    if (this.usingSqlite && this.db) {
      this.db.prepare("UPDATE clinics SET channels = ? WHERE id = ?").run(
        JSON.stringify(updated.channels),
        clinicId,
      );
      return updated;
    }

    this._clinics.set(clinicId, updated);
    return updated;
  }

  listClinics(): Clinic[] {
    if (this.usingSqlite && this.db) {
      const rows = this.db.prepare("SELECT * FROM clinics").all() as Record<string, unknown>[];
      return rows.map((r) => this._rowToClinic(r));
    }
    return Array.from(this._clinics.values());
  }

  // ─── Patient CRUD ─────────────────────────────────────────

  registerPatient(input: Omit<PatientContact, "id">): PatientContact {
    const patient: PatientContact = {
      ...input,
      id: randomUUID(),
    };

    if (this.usingSqlite && this.db) {
      this.db.prepare(`
        INSERT INTO patients (id, clinic_id, name, phone, language, preferred_channel,
          consent_status, consent_date, emergency_contacts, chw_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        patient.id,
        patient.clinicId,
        patient.name,
        patient.phone,
        patient.language,
        patient.preferredChannel,
        patient.consentStatus,
        patient.consentDate ?? null,
        JSON.stringify(patient.emergencyContacts),
        patient.chwId ?? null,
      );
      return patient;
    }

    // In-memory fallback
    this._patients.set(patient.id, patient);
    this._patientsByPhone.set(patient.phone, patient.id);
    const clinicSet = this._patientsByClinic.get(patient.clinicId);
    if (clinicSet) {
      clinicSet.add(patient.id);
    } else {
      this._patientsByClinic.set(patient.clinicId, new Set([patient.id]));
    }
    return patient;
  }

  getPatient(patientId: string): PatientContact | undefined {
    if (this.usingSqlite && this.db) {
      const row = this.db.prepare("SELECT * FROM patients WHERE id = ?").get(patientId) as Record<string, unknown> | undefined;
      return row ? this._rowToPatient(row) : undefined;
    }
    return this._patients.get(patientId);
  }

  getPatientByPhone(phone: string): PatientContact | undefined {
    if (this.usingSqlite && this.db) {
      const row = this.db.prepare("SELECT * FROM patients WHERE phone = ? LIMIT 1").get(phone) as Record<string, unknown> | undefined;
      return row ? this._rowToPatient(row) : undefined;
    }
    const id = this._patientsByPhone.get(phone);
    return id ? this._patients.get(id) : undefined;
  }

  getPatientsByClinic(clinicId: string): PatientContact[] {
    if (this.usingSqlite && this.db) {
      const rows = this.db.prepare("SELECT * FROM patients WHERE clinic_id = ?").all(clinicId) as Record<string, unknown>[];
      return rows.map((r) => this._rowToPatient(r));
    }
    const ids = this._patientsByClinic.get(clinicId);
    if (!ids) return [];
    const results: PatientContact[] = [];
    for (const id of ids) {
      const p = this._patients.get(id);
      if (p) results.push(p);
    }
    return results;
  }

  updatePatient(patientId: string, updates: Partial<PatientContact>): PatientContact {
    const patient = this.getPatient(patientId);
    if (!patient) throw new Error(`Patient not found: ${patientId}`);

    const updated: PatientContact = { ...patient, ...updates, id: patient.id };

    if (this.usingSqlite && this.db) {
      this.db.prepare(`
        UPDATE patients SET clinic_id = ?, name = ?, phone = ?, language = ?,
          preferred_channel = ?, consent_status = ?, consent_date = ?,
          emergency_contacts = ?, chw_id = ?
        WHERE id = ?
      `).run(
        updated.clinicId,
        updated.name,
        updated.phone,
        updated.language,
        updated.preferredChannel,
        updated.consentStatus,
        updated.consentDate ?? null,
        JSON.stringify(updated.emergencyContacts),
        updated.chwId ?? null,
        patientId,
      );
      return updated;
    }

    // In-memory fallback: update phone index
    if (updates.phone && updates.phone !== patient.phone) {
      this._patientsByPhone.delete(patient.phone);
      this._patientsByPhone.set(updates.phone, patientId);
    }
    // Update clinic index
    if (updates.clinicId && updates.clinicId !== patient.clinicId) {
      this._patientsByClinic.get(patient.clinicId)?.delete(patientId);
      const newSet = this._patientsByClinic.get(updates.clinicId);
      if (newSet) {
        newSet.add(patientId);
      } else {
        this._patientsByClinic.set(updates.clinicId, new Set([patientId]));
      }
    }
    this._patients.set(patientId, updated);
    return updated;
  }

  // ─── Messages ─────────────────────────────────────────────

  storeMessage(message: ConnectMessage): void {
    if (this.usingSqlite && this.db) {
      this.db.prepare(`
        INSERT INTO messages (id, clinic_id, patient_id, direction, channel, priority,
          "from", "to", template, template_data, language, body, status, created_at,
          sent_at, delivered_at, fail_reason, retry_count, max_retries)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        message.id,
        message.clinicId,
        message.patientId ?? null,
        message.direction,
        message.channel,
        message.priority,
        message.from,
        message.to,
        message.template,
        JSON.stringify(message.templateData),
        message.language,
        message.body ?? null,
        message.status,
        message.createdAt,
        message.sentAt ?? null,
        message.deliveredAt ?? null,
        message.failReason ?? null,
        message.retryCount,
        message.maxRetries,
      );
      return;
    }
    this._messages.push(message);
  }

  getMessages(clinicId: string, options?: { limit?: number; since?: string }): ConnectMessage[] {
    if (this.usingSqlite && this.db) {
      let sql = "SELECT * FROM messages WHERE clinic_id = ?";
      const params: unknown[] = [clinicId];

      if (options?.since) {
        sql += " AND created_at >= ?";
        params.push(options.since);
      }

      sql += " ORDER BY created_at ASC";

      const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
      const messages = rows.map((r) => this._rowToMessage(r));

      if (options?.limit && options.limit > 0) {
        return messages.slice(-options.limit);
      }
      return messages;
    }

    // In-memory fallback
    let filtered = this._messages.filter((m) => m.clinicId === clinicId);
    if (options?.since) {
      const sinceTime = new Date(options.since).getTime();
      filtered = filtered.filter((m) => new Date(m.createdAt).getTime() >= sinceTime);
    }
    if (options?.limit && options.limit > 0) {
      filtered = filtered.slice(-options.limit);
    }
    return filtered;
  }

  getMessagesByPatient(patientId: string): ConnectMessage[] {
    if (this.usingSqlite && this.db) {
      const rows = this.db.prepare(
        "SELECT * FROM messages WHERE patient_id = ? ORDER BY created_at ASC"
      ).all(patientId) as Record<string, unknown>[];
      return rows.map((r) => this._rowToMessage(r));
    }
    return this._messages.filter((m) => m.patientId === patientId);
  }

  // ─── Queue ────────────────────────────────────────────────

  enqueue(message: ConnectMessage): void {
    message.status = "queued";

    if (this.usingSqlite && this.db) {
      this.db.prepare(`
        INSERT INTO message_queue (message_id, clinic_id, status, attempts, message_data)
        VALUES (?, ?, 'queued', 0, ?)
      `).run(message.id, message.clinicId, JSON.stringify(message));
      return;
    }
    this._messageQueue.push(message);
  }

  dequeueAll(clinicId?: string): ConnectMessage[] {
    if (this.usingSqlite && this.db) {
      let rows: Record<string, unknown>[];
      if (!clinicId) {
        rows = this.db.prepare("SELECT * FROM message_queue WHERE status = 'queued'").all() as Record<string, unknown>[];
        this.db.prepare("DELETE FROM message_queue WHERE status = 'queued'").run();
      } else {
        rows = this.db.prepare(
          "SELECT * FROM message_queue WHERE status = 'queued' AND clinic_id = ?"
        ).all(clinicId) as Record<string, unknown>[];
        this.db.prepare(
          "DELETE FROM message_queue WHERE status = 'queued' AND clinic_id = ?"
        ).run(clinicId);
      }
      return rows.map((r) => JSON.parse(r.message_data as string) as ConnectMessage);
    }

    // In-memory fallback
    if (!clinicId) {
      const all = [...this._messageQueue];
      this._messageQueue = [];
      return all;
    }
    const forClinic: ConnectMessage[] = [];
    const remaining: ConnectMessage[] = [];
    for (const msg of this._messageQueue) {
      if (msg.clinicId === clinicId) {
        forClinic.push(msg);
      } else {
        remaining.push(msg);
      }
    }
    this._messageQueue = remaining;
    return forClinic;
  }

  getQueueSize(clinicId?: string): number {
    if (this.usingSqlite && this.db) {
      if (!clinicId) {
        const row = this.db.prepare(
          "SELECT COUNT(*) as cnt FROM message_queue WHERE status = 'queued'"
        ).get() as { cnt: number };
        return row.cnt;
      }
      const row = this.db.prepare(
        "SELECT COUNT(*) as cnt FROM message_queue WHERE status = 'queued' AND clinic_id = ?"
      ).get(clinicId) as { cnt: number };
      return row.cnt;
    }
    if (!clinicId) return this._messageQueue.length;
    return this._messageQueue.filter((m) => m.clinicId === clinicId).length;
  }

  // ─── Stats ────────────────────────────────────────────────

  getClinicStats(clinicId: string): {
    patientCount: number;
    messagesSent: number;
    messagesDelivered: number;
    messagesFailed: number;
    alertsTriggered: number;
    lastActivity: string | null;
  } {
    if (this.usingSqlite && this.db) {
      const patientRow = this.db.prepare(
        "SELECT COUNT(*) as cnt FROM patients WHERE clinic_id = ?"
      ).get(clinicId) as { cnt: number };

      const sentRow = this.db.prepare(
        "SELECT COUNT(*) as cnt FROM messages WHERE clinic_id = ? AND status = 'sent'"
      ).get(clinicId) as { cnt: number };

      const deliveredRow = this.db.prepare(
        "SELECT COUNT(*) as cnt FROM messages WHERE clinic_id = ? AND status = 'delivered'"
      ).get(clinicId) as { cnt: number };

      const failedRow = this.db.prepare(
        "SELECT COUNT(*) as cnt FROM messages WHERE clinic_id = ? AND status = 'failed'"
      ).get(clinicId) as { cnt: number };

      const alertsRow = this.db.prepare(
        "SELECT COUNT(*) as cnt FROM messages WHERE clinic_id = ? AND direction = 'system_alert'"
      ).get(clinicId) as { cnt: number };

      const lastRow = this.db.prepare(
        "SELECT created_at FROM messages WHERE clinic_id = ? ORDER BY created_at DESC LIMIT 1"
      ).get(clinicId) as { created_at: string } | undefined;

      return {
        patientCount: patientRow.cnt,
        messagesSent: sentRow.cnt,
        messagesDelivered: deliveredRow.cnt,
        messagesFailed: failedRow.cnt,
        alertsTriggered: alertsRow.cnt,
        lastActivity: lastRow?.created_at ?? null,
      };
    }

    // In-memory fallback
    const clinicMessages = this._messages.filter((m) => m.clinicId === clinicId);
    const patientIds = this._patientsByClinic.get(clinicId);

    let lastActivity: string | null = null;
    if (clinicMessages.length > 0) {
      lastActivity = clinicMessages[clinicMessages.length - 1].createdAt;
    }

    return {
      patientCount: patientIds ? patientIds.size : 0,
      messagesSent: clinicMessages.filter((m) => m.status === "sent").length,
      messagesDelivered: clinicMessages.filter((m) => m.status === "delivered").length,
      messagesFailed: clinicMessages.filter((m) => m.status === "failed").length,
      alertsTriggered: clinicMessages.filter((m) => m.direction === "system_alert").length,
      lastActivity,
    };
  }

  // ─── Backup / Restore (for offline clinics) ───────────────

  export(): string {
    if (this.usingSqlite && this.db) {
      const clinics = this.db.prepare("SELECT * FROM clinics").all() as Record<string, unknown>[];
      const patients = this.db.prepare("SELECT * FROM patients").all() as Record<string, unknown>[];
      const messages = this.db.prepare("SELECT * FROM messages").all() as Record<string, unknown>[];
      const consentLog = this.db.prepare("SELECT * FROM consent_log").all() as Record<string, unknown>[];
      const queue = this.db.prepare("SELECT * FROM message_queue").all() as Record<string, unknown>[];

      return JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        clinics: clinics.map((r) => this._rowToClinic(r)),
        patients: patients.map((r) => this._rowToPatient(r)),
        messages: messages.map((r) => this._rowToMessage(r)),
        consentLog,
        messageQueue: queue.map((r) => JSON.parse(r.message_data as string)),
      }, null, 2);
    }

    // In-memory fallback
    return JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      clinics: Array.from(this._clinics.values()),
      patients: Array.from(this._patients.values()),
      messages: this._messages,
      consentLog: [],
      messageQueue: this._messageQueue,
    }, null, 2);
  }

  import(jsonData: string): { clinics: number; patients: number; messages: number } {
    const data = JSON.parse(jsonData) as {
      clinics?: Clinic[];
      patients?: PatientContact[];
      messages?: ConnectMessage[];
      messageQueue?: ConnectMessage[];
    };

    let clinicCount = 0;
    let patientCount = 0;
    let messageCount = 0;

    if (this.usingSqlite && this.db) {
      const insertClinic = this.db.prepare(`
        INSERT OR REPLACE INTO clinics (id, name, location, country, language, timezone, channels,
          admin_phone, admin_name, operating_hours, emergency_phone, tier, created_at, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertPatient = this.db.prepare(`
        INSERT OR REPLACE INTO patients (id, clinic_id, name, phone, language, preferred_channel,
          consent_status, consent_date, emergency_contacts, chw_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertMessage = this.db.prepare(`
        INSERT OR REPLACE INTO messages (id, clinic_id, patient_id, direction, channel, priority,
          "from", "to", template, template_data, language, body, status, created_at,
          sent_at, delivered_at, fail_reason, retry_count, max_retries)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const runImport = this.db.transaction(() => {
        for (const c of data.clinics ?? []) {
          insertClinic.run(
            c.id, c.name, c.location, c.country, c.language, c.timezone,
            JSON.stringify(c.channels), c.adminPhone, c.adminName,
            c.operatingHours ? JSON.stringify(c.operatingHours) : null,
            c.emergencyPhone ?? null, c.tier, c.createdAt, c.active ? 1 : 0,
          );
          clinicCount++;
        }
        for (const p of data.patients ?? []) {
          insertPatient.run(
            p.id, p.clinicId, p.name, p.phone, p.language, p.preferredChannel,
            p.consentStatus, p.consentDate ?? null,
            JSON.stringify(p.emergencyContacts), p.chwId ?? null,
          );
          patientCount++;
        }
        for (const m of data.messages ?? []) {
          insertMessage.run(
            m.id, m.clinicId, m.patientId ?? null, m.direction, m.channel,
            m.priority, m.from, m.to, m.template, JSON.stringify(m.templateData),
            m.language, m.body ?? null, m.status, m.createdAt,
            m.sentAt ?? null, m.deliveredAt ?? null, m.failReason ?? null,
            m.retryCount, m.maxRetries,
          );
          messageCount++;
        }
      });

      runImport();
      return { clinics: clinicCount, patients: patientCount, messages: messageCount };
    }

    // In-memory fallback
    for (const c of data.clinics ?? []) {
      this._clinics.set(c.id, c);
      if (!this._patientsByClinic.has(c.id)) {
        this._patientsByClinic.set(c.id, new Set());
      }
      clinicCount++;
    }
    for (const p of data.patients ?? []) {
      this._patients.set(p.id, p);
      this._patientsByPhone.set(p.phone, p.id);
      const clinicSet = this._patientsByClinic.get(p.clinicId);
      if (clinicSet) clinicSet.add(p.id);
      else this._patientsByClinic.set(p.clinicId, new Set([p.id]));
      patientCount++;
    }
    for (const m of data.messages ?? []) {
      this._messages.push(m);
      messageCount++;
    }

    return { clinics: clinicCount, patients: patientCount, messages: messageCount };
  }

  // ─── Cleanup ──────────────────────────────────────────────

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.usingSqlite = false;
    }
  }

  // ─── Row ↔ Object Mappers ────────────────────────────────

  private _rowToClinic(row: Record<string, unknown>): Clinic {
    return {
      id: row.id as string,
      name: row.name as string,
      location: row.location as string,
      country: row.country as string,
      language: row.language as Clinic["language"],
      timezone: row.timezone as string,
      channels: JSON.parse(row.channels as string) as ClinicChannelConfig,
      adminPhone: row.admin_phone as string,
      adminName: row.admin_name as string,
      operatingHours: row.operating_hours
        ? (JSON.parse(row.operating_hours as string) as { start: string; end: string })
        : undefined,
      emergencyPhone: (row.emergency_phone as string) || undefined,
      tier: row.tier as Clinic["tier"],
      createdAt: row.created_at as string,
      active: row.active === 1,
    };
  }

  private _rowToPatient(row: Record<string, unknown>): PatientContact {
    return {
      id: row.id as string,
      clinicId: row.clinic_id as string,
      name: row.name as string,
      phone: row.phone as string,
      language: row.language as PatientContact["language"],
      preferredChannel: row.preferred_channel as PatientContact["preferredChannel"],
      consentStatus: row.consent_status as PatientContact["consentStatus"],
      consentDate: (row.consent_date as string) || undefined,
      emergencyContacts: JSON.parse(row.emergency_contacts as string),
      chwId: (row.chw_id as string) || undefined,
    };
  }

  private _rowToMessage(row: Record<string, unknown>): ConnectMessage {
    return {
      id: row.id as string,
      clinicId: row.clinic_id as string,
      patientId: (row.patient_id as string) || undefined,
      direction: row.direction as ConnectMessage["direction"],
      channel: row.channel as ConnectMessage["channel"],
      priority: row.priority as ConnectMessage["priority"],
      from: row.from as string,
      to: row.to as string,
      template: row.template as string,
      templateData: JSON.parse(row.template_data as string),
      language: row.language as string,
      body: (row.body as string) || undefined,
      status: row.status as ConnectMessage["status"],
      createdAt: row.created_at as string,
      sentAt: (row.sent_at as string) || undefined,
      deliveredAt: (row.delivered_at as string) || undefined,
      failReason: (row.fail_reason as string) || undefined,
      retryCount: row.retry_count as number,
      maxRetries: row.max_retries as number,
    };
  }
}
