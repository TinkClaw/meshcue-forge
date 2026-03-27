/**
 * MeshCue Connect — Multi-Tenant Data Store
 *
 * In-memory store for clinics, patients, and messages.
 * Production deployments should replace this with a persistent database.
 */

import { randomUUID } from "node:crypto";
import type {
  Clinic,
  ClinicChannelConfig,
  PatientContact,
  ConnectMessage,
} from "./types.js";

export class ConnectStore {
  private clinics: Map<string, Clinic> = new Map();
  private patients: Map<string, PatientContact> = new Map();
  private patientsByPhone: Map<string, string> = new Map(); // phone -> patientId
  private patientsByClinic: Map<string, Set<string>> = new Map(); // clinicId -> patientIds
  private messages: ConnectMessage[] = [];
  private messageQueue: ConnectMessage[] = [];

  // ─── Clinic CRUD ──────────────────────────────────────────

  registerClinic(input: Omit<Clinic, "id" | "createdAt">): Clinic {
    const clinic: Clinic = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.clinics.set(clinic.id, clinic);
    this.patientsByClinic.set(clinic.id, new Set());
    return clinic;
  }

  getClinic(clinicId: string): Clinic | undefined {
    return this.clinics.get(clinicId);
  }

  updateClinic(clinicId: string, updates: Partial<Clinic>): Clinic {
    const clinic = this.clinics.get(clinicId);
    if (!clinic) throw new Error(`Clinic not found: ${clinicId}`);

    const updated: Clinic = { ...clinic, ...updates, id: clinic.id, createdAt: clinic.createdAt };
    this.clinics.set(clinicId, updated);
    return updated;
  }

  updateClinicChannels(clinicId: string, channels: Partial<ClinicChannelConfig>): Clinic {
    const clinic = this.clinics.get(clinicId);
    if (!clinic) throw new Error(`Clinic not found: ${clinicId}`);

    const updated: Clinic = {
      ...clinic,
      channels: { ...clinic.channels, ...channels },
    };
    this.clinics.set(clinicId, updated);
    return updated;
  }

  listClinics(): Clinic[] {
    return Array.from(this.clinics.values());
  }

  // ─── Patient CRUD ─────────────────────────────────────────

  registerPatient(input: Omit<PatientContact, "id">): PatientContact {
    const patient: PatientContact = {
      ...input,
      id: randomUUID(),
    };
    this.patients.set(patient.id, patient);
    this.patientsByPhone.set(patient.phone, patient.id);

    const clinicSet = this.patientsByClinic.get(patient.clinicId);
    if (clinicSet) {
      clinicSet.add(patient.id);
    } else {
      this.patientsByClinic.set(patient.clinicId, new Set([patient.id]));
    }

    return patient;
  }

  getPatient(patientId: string): PatientContact | undefined {
    return this.patients.get(patientId);
  }

  getPatientByPhone(phone: string): PatientContact | undefined {
    const id = this.patientsByPhone.get(phone);
    return id ? this.patients.get(id) : undefined;
  }

  getPatientsByClinic(clinicId: string): PatientContact[] {
    const ids = this.patientsByClinic.get(clinicId);
    if (!ids) return [];
    const results: PatientContact[] = [];
    for (const id of ids) {
      const p = this.patients.get(id);
      if (p) results.push(p);
    }
    return results;
  }

  updatePatient(patientId: string, updates: Partial<PatientContact>): PatientContact {
    const patient = this.patients.get(patientId);
    if (!patient) throw new Error(`Patient not found: ${patientId}`);

    // If phone changed, update phone index
    if (updates.phone && updates.phone !== patient.phone) {
      this.patientsByPhone.delete(patient.phone);
      this.patientsByPhone.set(updates.phone, patientId);
    }

    // If clinicId changed, update clinic index
    if (updates.clinicId && updates.clinicId !== patient.clinicId) {
      this.patientsByClinic.get(patient.clinicId)?.delete(patientId);
      const newSet = this.patientsByClinic.get(updates.clinicId);
      if (newSet) {
        newSet.add(patientId);
      } else {
        this.patientsByClinic.set(updates.clinicId, new Set([patientId]));
      }
    }

    const updated: PatientContact = { ...patient, ...updates, id: patient.id };
    this.patients.set(patientId, updated);
    return updated;
  }

  // ─── Messages ─────────────────────────────────────────────

  storeMessage(message: ConnectMessage): void {
    this.messages.push(message);
  }

  getMessages(clinicId: string, options?: { limit?: number; since?: string }): ConnectMessage[] {
    let filtered = this.messages.filter((m) => m.clinicId === clinicId);

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
    return this.messages.filter((m) => m.patientId === patientId);
  }

  // ─── Queue ────────────────────────────────────────────────

  enqueue(message: ConnectMessage): void {
    message.status = "queued";
    this.messageQueue.push(message);
  }

  dequeueAll(clinicId?: string): ConnectMessage[] {
    if (!clinicId) {
      const all = [...this.messageQueue];
      this.messageQueue = [];
      return all;
    }

    const forClinic: ConnectMessage[] = [];
    const remaining: ConnectMessage[] = [];
    for (const msg of this.messageQueue) {
      if (msg.clinicId === clinicId) {
        forClinic.push(msg);
      } else {
        remaining.push(msg);
      }
    }
    this.messageQueue = remaining;
    return forClinic;
  }

  getQueueSize(clinicId?: string): number {
    if (!clinicId) return this.messageQueue.length;
    return this.messageQueue.filter((m) => m.clinicId === clinicId).length;
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
    const clinicMessages = this.messages.filter((m) => m.clinicId === clinicId);
    const patientIds = this.patientsByClinic.get(clinicId);

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
}
