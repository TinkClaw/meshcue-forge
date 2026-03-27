/**
 * Tests for MeshCue Connect — Template Rendering
 *
 * Verifies multi-language template rendering, variable interpolation,
 * missing-data fallbacks, and unknown-template error handling.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  renderTemplate,
  getTemplateNames,
  getSupportedLanguages,
} from "../connect/templates.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const spo2CriticalData: Record<string, string | number> = {
  name: "Amara",
  value: 82,
  unit: "%",
  clinic: "Nairobi Central Clinic",
  phone: "+254700999999",
};

const appointmentData: Record<string, string | number> = {
  name: "Amara",
  date: "2026-04-15",
  time: "10:00",
  clinic: "Nairobi Central Clinic",
  address: "Kenyatta Avenue, Block C",
  doctor: "Dr. Wanjiku",
};

const medicationData: Record<string, string | number> = {
  name: "Amara",
  medication: "Metformin 500mg",
  dose: "1 tablet",
  frequency: "twice daily",
  nextRefillDate: "2026-05-01",
};

const familyEmergencyData: Record<string, string | number> = {
  name: "Amara",
  familyMemberName: "Fatou",
  clinic: "Nairobi Central Clinic",
  phone: "+254700999999",
  reading: "SpO2",
  value: 82,
  unit: "%",
};

// ---------------------------------------------------------------------------
// spo2_critical — multi-language
// ---------------------------------------------------------------------------

describe("connect templates — spo2_critical", () => {
  it("renders spo2_critical template in English", () => {
    const body = renderTemplate("spo2_critical", spo2CriticalData, "en");
    assert.ok(body.length > 0, "Should produce non-empty output");
    assert.ok(body.includes("82"), "Should include the SpO2 value");
    assert.ok(
      body.includes("Amara"),
      "Should include the patient name",
    );
    assert.ok(
      body.includes("Nairobi Central Clinic"),
      "Should reference the clinic",
    );
  });

  it("renders spo2_critical template in Swahili", () => {
    const body = renderTemplate("spo2_critical", spo2CriticalData, "sw");
    assert.ok(body.length > 0, "Should produce non-empty Swahili output");
    assert.ok(body.includes("82"), "Should include the SpO2 value");
    assert.ok(body.includes("Amara"), "Should include the patient name");
  });

  it("renders spo2_critical template in French", () => {
    const body = renderTemplate("spo2_critical", spo2CriticalData, "fr");
    assert.ok(body.length > 0, "Should produce non-empty French output");
    assert.ok(body.includes("82"), "Should include the SpO2 value");
    assert.ok(body.includes("Amara"), "Should include the patient name");
  });
});

// ---------------------------------------------------------------------------
// Other templates
// ---------------------------------------------------------------------------

describe("connect templates — appointment and medication", () => {
  it("renders appointment_reminder with all variables filled", () => {
    const body = renderTemplate("appointment_reminder", appointmentData, "en");
    assert.ok(body.length > 0, "Should produce non-empty output");
    assert.ok(body.includes("Amara"), "Should include patient name");
    assert.ok(body.includes("2026-04-15"), "Should include date");
    assert.ok(body.includes("10:00"), "Should include time");
    assert.ok(
      body.includes("Nairobi Central Clinic"),
      "Should include clinic name",
    );
  });

  it("renders medication_reminder correctly", () => {
    const body = renderTemplate("medication_reminder", medicationData, "en");
    assert.ok(body.length > 0, "Should produce non-empty output");
    assert.ok(body.includes("Metformin"), "Should include medication name");
    assert.ok(body.includes("1 tablet"), "Should include dose");
  });

  it("renders family_emergency with clinic and phone", () => {
    const body = renderTemplate("family_emergency", familyEmergencyData, "en");
    assert.ok(body.length > 0, "Should produce non-empty output");
    assert.ok(body.includes("Amara"), "Should include patient name");
    assert.ok(
      body.includes("+254700999999"),
      "Should include clinic phone",
    );
    assert.ok(
      body.includes("Nairobi Central Clinic"),
      "Should include clinic name",
    );
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("connect templates — edge cases", () => {
  it("missing template data uses placeholder (keeps {key} syntax)", () => {
    // Provide incomplete data — name is missing
    const body = renderTemplate("spo2_critical", { value: 88 }, "en");
    assert.ok(body.length > 0, "Should still produce output");
    // Missing values should remain as {key} placeholders
    assert.ok(
      body.includes("{name}") || body.includes("{clinic}"),
      "Missing variables should remain as placeholders",
    );
    assert.ok(body.includes("88"), "Provided value should be interpolated");
  });

  it("unknown template name throws error", () => {
    assert.throws(
      () => renderTemplate("nonexistent_template_xyz", {}, "en"),
      (err: Error) => {
        assert.ok(
          err.message.includes("nonexistent_template_xyz") ||
            err.message.toLowerCase().includes("unknown"),
          `Error message should reference the bad template name, got: ${err.message}`,
        );
        return true;
      },
    );
  });

  it("all supported languages produce non-empty output for all templates", () => {
    const templateNames = getTemplateNames();
    const languages = getSupportedLanguages();

    assert.ok(
      languages.length >= 9,
      `Expected at least 9 languages, got ${languages.length}`,
    );
    assert.ok(templateNames.length >= 1, "Should have at least 1 template");

    // Generic data that should satisfy most template placeholders
    const genericData: Record<string, string | number> = {
      name: "Test",
      value: 90,
      clinic: "Test Clinic",
      phone: "+000000000",
      date: "2026-01-01",
      time: "08:00",
      medication: "TestMed",
      dose: "1",
      status: "stable",
      visits: 5,
      screenings: 3,
      referrals: 1,
      alerts: 2,
    };

    for (const template of templateNames) {
      for (const lang of languages) {
        const body = renderTemplate(template, genericData, lang);
        assert.ok(
          body.length > 0,
          `Template "${template}" in language "${lang}" should produce non-empty output`,
        );
      }
    }
  });
});
