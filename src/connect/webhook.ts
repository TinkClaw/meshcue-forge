/**
 * MeshCue Connect — Webhook Server
 *
 * HTTP server that receives incoming SMS/WhatsApp/USSD callbacks from
 * Africa's Talking, Twilio, and Meta Cloud API. Routes them through
 * the message router for triage and response.
 *
 * Endpoints:
 *   POST /webhook/sms       — Africa's Talking / Twilio SMS callback
 *   POST /webhook/ussd      — Africa's Talking USSD callback
 *   POST /webhook/whatsapp  — Meta Cloud API webhook
 *   POST /webhook/voice     — Voice call status callback
 *   GET  /webhook/whatsapp  — Meta webhook verification (challenge)
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac } from "node:crypto";
import { createRouter } from "./router.js";
import { ConnectStore } from "./store.js";
import { loadConnectConfig } from "./config.js";

// ─── Shared State ────────────────────────────────────────────

let store: ConnectStore | null = null;

function getStore(): ConnectStore {
  if (!store) store = new ConnectStore(process.env.MESHCUE_DB_PATH);
  return store;
}

// ─── Helpers ─────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function parseFormData(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  const result: Record<string, string> = {};
  for (const [k, v] of params) result[k] = v;
  return result;
}

/**
 * Validate Africa's Talking webhook signature (HMAC-SHA256).
 * AT sends the signature in the `X-AfricasTalking-Signature` header.
 */
function validateATSignature(body: string, signature: string | undefined, apiKey: string): boolean {
  if (!signature || !apiKey) return false;
  const expected = createHmac("sha256", apiKey).update(body).digest("base64");
  return expected === signature;
}

// ─── SMS Webhook (Africa's Talking / Twilio) ─────────────────

async function handleSMS(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const data = parseFormData(body);

  // Africa's Talking format: from, to, text, date, id, linkId
  // Twilio format: From, To, Body, MessageSid
  const from = data.from || data.From || "";
  const text = data.text || data.Body || "";
  const messageId = data.id || data.MessageSid || "";

  if (!from || !text) {
    json(res, 400, { error: "Missing 'from' or 'text' field" });
    return;
  }

  const s = getStore();
  const patient = s.getPatientByPhone(from);
  const clinicId = patient?.clinicId;

  if (clinicId) {
    const clinic = s.getClinic(clinicId);
    if (clinic) {
      const config = loadConnectConfig();
      const router = createRouter(config, s);
      const result = await router.handleIncoming("sms", from, text, clinicId);

      // Store the inbound message
      s.storeMessage({
        id: messageId || crypto.randomUUID(),
        clinicId,
        patientId: patient!.id,
        direction: "patient_to_clinic",
        channel: "sms",
        body: text,
        from,
        to: clinic.adminPhone,
        template: "incoming_sms",
        templateData: {},
        language: patient!.language || "en",
        status: "delivered",
        priority: result.priority,
        retryCount: 0,
        maxRetries: 0,
        createdAt: new Date().toISOString(),
      } satisfies import("./types.js").ConnectMessage);

      json(res, 200, { status: "processed", priority: result.priority, template: result.template });
      return;
    }
  }

  // Unknown sender — log and acknowledge
  console.error(`[webhook/sms] Unknown sender: ${from} — "${text.substring(0, 50)}"`);
  json(res, 200, { status: "unregistered", from });
}

// ─── USSD Webhook (Africa's Talking) ─────────────────────────

async function handleUSSD(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const data = parseFormData(body);

  // AT USSD: sessionId, serviceCode, phoneNumber, text
  const phone = data.phoneNumber || "";
  const input = data.text || "";
  const sessionId = data.sessionId || "";

  if (!phone) {
    json(res, 400, { error: "Missing phoneNumber" });
    return;
  }

  const s = getStore();
  const patient = s.getPatientByPhone(phone);
  const clinicId = patient?.clinicId;

  if (clinicId) {
    const clinic = s.getClinic(clinicId);
    if (clinic) {
      const config = loadConnectConfig();
      const router = createRouter(config, s);
      const result = await router.handleIncoming("ussd", phone, input, clinicId);

      // USSD response format: CON (continue) or END (terminate)
      const prefix = result.template === "opt_out_confirm" || result.priority === "routine" ? "END " : "CON ";
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(prefix + (result.template || "Welcome to MeshCue"));
      return;
    }
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("END Your number is not registered. Contact your clinic to register.");
}

// ─── WhatsApp Webhook (Meta Cloud API) ───────────────────────

async function handleWhatsApp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // GET = verification challenge
  if (req.method === "GET") {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    const verifyToken = process.env.MESHCUE_WA_VERIFY_TOKEN || "meshcue-verify";
    if (mode === "subscribe" && token === verifyToken && challenge) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(challenge);
      return;
    }
    json(res, 403, { error: "Verification failed" });
    return;
  }

  // POST = incoming message
  const body = await readBody(req);
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body);
  } catch {
    json(res, 400, { error: "Invalid JSON" });
    return;
  }

  // Meta webhook structure: entry[].changes[].value.messages[]
  const entries = (payload.entry as Array<Record<string, unknown>>) || [];
  for (const entry of entries) {
    const changes = (entry.changes as Array<Record<string, unknown>>) || [];
    for (const change of changes) {
      const value = change.value as Record<string, unknown>;
      const messages = (value?.messages as Array<Record<string, unknown>>) || [];
      for (const msg of messages) {
        const from = String(msg.from || "");
        const text = String((msg.text as Record<string, string>)?.body || "");
        if (from && text) {
          const s = getStore();
          const patient = s.getPatientByPhone(from);
          if (patient?.clinicId) {
            const clinic = s.getClinic(patient.clinicId);
            if (clinic) {
              const config = loadConnectConfig();
              const router = createRouter(config, s);
              await router.handleIncoming("whatsapp", from, text, patient.clinicId);

              s.storeMessage({
                id: String(msg.id || crypto.randomUUID()),
                clinicId: patient.clinicId,
                patientId: patient.id,
                direction: "patient_to_clinic",
                channel: "whatsapp",
                body: text,
                from,
                to: clinic.adminPhone,
                template: "incoming_whatsapp",
                templateData: {},
                language: patient.language || "en",
                status: "delivered",
                priority: "routine",
                retryCount: 0,
                maxRetries: 0,
                createdAt: new Date().toISOString(),
              } satisfies import("./types.js").ConnectMessage);
            }
          }
        }
      }
    }
  }

  json(res, 200, { status: "ok" });
}

// ─── Voice Status Webhook ────────────────────────────────────

async function handleVoice(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const data = parseFormData(body);

  // Log call status for debugging
  const callStatus = data.callSessionState || data.CallStatus || "unknown";
  const from = data.callerNumber || data.From || "";
  console.error(`[webhook/voice] Call from ${from}: ${callStatus}`);

  // For TTS response (Africa's Talking XML format)
  if (data.isActive === "1" || callStatus === "ringing") {
    res.writeHead(200, { "Content-Type": "application/xml" });
    res.end(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="en-US-Standard-C">Welcome to MeshCue health services. For emergencies, press 1. For medication reminders, press 2. To speak with a nurse, press 3.</Say>
  <GetDigits timeout="30" finishOnKey="#" callbackUrl="/webhook/voice">
    <Say>Please enter your selection followed by hash.</Say>
  </GetDigits>
</Response>`);
    return;
  }

  json(res, 200, { status: "logged", callStatus });
}

// ─── Webhook Router ──────────────────────────────────────────

export function startWebhookServer(port: number): void {
  const server = createServer(async (req, res) => {
    // CORS headers for Meta webhook verification
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Hub-Signature-256");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url || "/";

    try {
      if (url === "/webhook/sms" && req.method === "POST") {
        await handleSMS(req, res);
      } else if (url === "/webhook/ussd" && req.method === "POST") {
        await handleUSSD(req, res);
      } else if (url.startsWith("/webhook/whatsapp")) {
        await handleWhatsApp(req, res);
      } else if (url === "/webhook/voice" && req.method === "POST") {
        await handleVoice(req, res);
      } else {
        json(res, 404, { error: "Not found", endpoints: ["/webhook/sms", "/webhook/ussd", "/webhook/whatsapp", "/webhook/voice"] });
      }
    } catch (err) {
      console.error(`[webhook] Error handling ${url}:`, err);
      json(res, 500, { error: "Internal server error" });
    }
  });

  server.listen(port, "0.0.0.0", () => {
    console.error(`Webhook server: http://0.0.0.0:${port}/webhook/{sms,ussd,whatsapp,voice}`);
  });
}
