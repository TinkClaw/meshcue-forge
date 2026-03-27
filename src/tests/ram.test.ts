/**
 * MeshCue RAM — Unit Tests
 *
 * Tests for the Resource and Asset Management module.
 * All tests use :memory: SQLite (default RAMStore constructor).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { RAMStore } from "../ram/store.js";

// ─── Asset CRUD ──────────────────────────────────────────────

describe("RAM: Asset CRUD", () => {
  let store: RAMStore;

  before(() => {
    store = new RAMStore();
  });
  after(() => store.close());

  it("registers a new asset", () => {
    const asset = store.registerAsset({
      clinicId: "clinic_a",
      category: "device",
      name: "Pulse Oximeter",
      manufacturer: "MeshForge",
      model: "MF-OX-100",
      serialNumber: "SN-001",
      status: "deployed",
      location: "Ward A",
      assignedTo: "Dr. Amina",
      tags: ["pediatric", "portable"],
      metadata: { firmwareVersion: "1.2.3" },
    });

    assert.ok(asset.id.startsWith("asset_"));
    assert.equal(asset.clinicId, "clinic_a");
    assert.equal(asset.category, "device");
    assert.equal(asset.name, "Pulse Oximeter");
    assert.equal(asset.status, "deployed");
    assert.deepEqual(asset.tags, ["pediatric", "portable"]);
    assert.deepEqual(asset.metadata, { firmwareVersion: "1.2.3" });
    assert.ok(asset.createdAt);
  });

  it("gets an asset by ID", () => {
    const created = store.registerAsset({
      clinicId: "clinic_a",
      category: "equipment",
      name: "Centrifuge",
    });
    const found = store.getAsset(created.id);
    assert.ok(found);
    assert.equal(found.name, "Centrifuge");
  });

  it("returns undefined for missing asset", () => {
    const found = store.getAsset("nonexistent");
    assert.equal(found, undefined);
  });

  it("updates asset status and location", () => {
    const asset = store.registerAsset({
      clinicId: "clinic_a",
      category: "device",
      name: "Thermometer",
      status: "received",
    });

    const updated = store.updateAsset(asset.id, {
      status: "deployed",
      location: "Triage Room",
      assignedTo: "Nurse Fatou",
    });

    assert.ok(updated);
    assert.equal(updated.status, "deployed");
    assert.equal(updated.location, "Triage Room");
    assert.equal(updated.assignedTo, "Nurse Fatou");
    assert.ok(updated.updatedAt); // updated_at is always set
  });

  it("returns undefined when updating nonexistent asset", () => {
    const result = store.updateAsset("nonexistent", { status: "retired" });
    assert.equal(result, undefined);
  });

  it("searches assets by clinic with filters", () => {
    const s = new RAMStore();

    s.registerAsset({ clinicId: "c1", category: "device", name: "ECG Monitor", status: "deployed" });
    s.registerAsset({ clinicId: "c1", category: "equipment", name: "Autoclave", status: "deployed" });
    s.registerAsset({ clinicId: "c1", category: "device", name: "BP Monitor", status: "maintenance" });
    s.registerAsset({ clinicId: "c2", category: "device", name: "Other Clinic Device" });

    const allC1 = s.getAssetsByClinic("c1");
    assert.equal(allC1.length, 3);

    const devicesOnly = s.getAssetsByClinic("c1", { category: "device" });
    assert.equal(devicesOnly.length, 2);

    const deployed = s.getAssetsByClinic("c1", { status: "deployed" });
    assert.equal(deployed.length, 2);

    const searched = s.getAssetsByClinic("c1", { search: "ECG" });
    assert.equal(searched.length, 1);
    assert.equal(searched[0].name, "ECG Monitor");

    s.close();
  });

  it("defaults status to received", () => {
    const asset = store.registerAsset({
      clinicId: "clinic_a",
      category: "device",
      name: "Default Status Device",
    });
    assert.equal(asset.status, "received");
  });
});

// ─── Inventory Management ────────────────────────────────────

describe("RAM: Inventory Management", () => {
  let store: RAMStore;

  before(() => {
    store = new RAMStore();
  });
  after(() => store.close());

  it("adds a new inventory item", () => {
    const item = store.addInventoryItem({
      clinicId: "clinic_a",
      name: "Paracetamol 500mg",
      category: "medication",
      quantity: 200,
      unit: "tablets",
      reorderLevel: 50,
      reorderQuantity: 200,
      expiryDate: "2027-06-15T00:00:00.000Z",
      batchNumber: "BATCH-001",
      supplier: "PharmaSupply",
      unitCost: 0.05,
      currency: "USD",
      storageRequirements: "room_temp",
      location: "Pharmacy Cabinet A",
    });

    assert.ok(item.id.startsWith("inv_"));
    assert.equal(item.quantity, 200);
    assert.equal(item.unit, "tablets");
    assert.equal(item.reorderLevel, 50);
  });

  it("restocks an existing item", () => {
    const item = store.addInventoryItem({
      clinicId: "clinic_a",
      name: "Surgical Gloves",
      category: "ppe",
      quantity: 100,
      unit: "pairs",
      reorderLevel: 30,
      reorderQuantity: 100,
    });

    const restocked = store.restockItem(item.id, 50);
    assert.ok(restocked);
    assert.equal(restocked.quantity, 150);
  });

  it("returns undefined when restocking nonexistent item", () => {
    const result = store.restockItem("nonexistent", 10);
    assert.equal(result, undefined);
  });

  it("detects low stock items", () => {
    const s = new RAMStore();

    s.addInventoryItem({
      clinicId: "c1",
      name: "Gauze Pads",
      category: "consumable",
      quantity: 5,
      unit: "packs",
      reorderLevel: 20,
      reorderQuantity: 50,
    });

    s.addInventoryItem({
      clinicId: "c1",
      name: "Bandages",
      category: "consumable",
      quantity: 100,
      unit: "rolls",
      reorderLevel: 10,
      reorderQuantity: 30,
    });

    s.addInventoryItem({
      clinicId: "c1",
      name: "Syringes",
      category: "consumable",
      quantity: 0,
      unit: "units",
      reorderLevel: 50,
      reorderQuantity: 200,
    });

    const lowStock = s.getLowStockItems("c1");
    assert.equal(lowStock.length, 2);
    // Ordered by quantity ASC, so syringes (0) first
    assert.equal(lowStock[0].name, "Syringes");
    assert.equal(lowStock[1].name, "Gauze Pads");

    s.close();
  });

  it("detects expiring items", () => {
    const s = new RAMStore();

    const soon = new Date();
    soon.setDate(soon.getDate() + 10);

    const later = new Date();
    later.setDate(later.getDate() + 90);

    s.addInventoryItem({
      clinicId: "c1",
      name: "Expiring Soon",
      category: "medication",
      quantity: 50,
      unit: "tablets",
      reorderLevel: 10,
      reorderQuantity: 50,
      expiryDate: soon.toISOString(),
    });

    s.addInventoryItem({
      clinicId: "c1",
      name: "Not Expiring Soon",
      category: "medication",
      quantity: 50,
      unit: "tablets",
      reorderLevel: 10,
      reorderQuantity: 50,
      expiryDate: later.toISOString(),
    });

    const expiring30 = s.getExpiringItems("c1", 30);
    assert.equal(expiring30.length, 1);
    assert.equal(expiring30[0].name, "Expiring Soon");

    const expiring120 = s.getExpiringItems("c1", 120);
    assert.equal(expiring120.length, 2);

    s.close();
  });

  it("filters inventory by category and search", () => {
    const s = new RAMStore();

    s.addInventoryItem({
      clinicId: "c1",
      name: "Amoxicillin",
      category: "medication",
      quantity: 100,
      unit: "capsules",
      reorderLevel: 20,
      reorderQuantity: 100,
    });

    s.addInventoryItem({
      clinicId: "c1",
      name: "N95 Masks",
      category: "ppe",
      quantity: 50,
      unit: "units",
      reorderLevel: 10,
      reorderQuantity: 50,
    });

    const meds = s.getInventoryByClinic("c1", { category: "medication" });
    assert.equal(meds.length, 1);
    assert.equal(meds[0].name, "Amoxicillin");

    const masks = s.getInventoryByClinic("c1", { search: "Mask" });
    assert.equal(masks.length, 1);
    assert.equal(masks[0].name, "N95 Masks");

    s.close();
  });
});

// ─── Supply Orders ───────────────────────────────────────────

describe("RAM: Supply Orders", () => {
  let store: RAMStore;

  before(() => {
    store = new RAMStore();
  });
  after(() => store.close());

  it("creates a supply order", () => {
    const order = store.createOrder({
      clinicId: "clinic_a",
      supplier: "MedSupply Kenya",
      items: [
        { inventoryItemId: "inv_001", name: "Paracetamol", quantity: 500, unitCost: 0.05 },
        { inventoryItemId: "inv_002", name: "Gauze Pads", quantity: 100, unitCost: 1.50 },
      ],
      currency: "KES",
      notes: "Urgent resupply",
    });

    assert.ok(order.id.startsWith("order_"));
    assert.equal(order.status, "draft");
    assert.equal(order.items.length, 2);
    assert.equal(order.supplier, "MedSupply Kenya");
    assert.equal(order.totalCost, 500 * 0.05 + 100 * 1.50);
  });

  it("updates order status through lifecycle", () => {
    const order = store.createOrder({
      clinicId: "clinic_a",
      supplier: "PharmaKenya",
      items: [{ inventoryItemId: "inv_001", name: "Test", quantity: 10 }],
    });

    const submitted = store.updateOrderStatus(order.id, "submitted");
    assert.ok(submitted);
    assert.equal(submitted.status, "submitted");
    assert.ok(submitted.orderedAt);

    const delivered = store.updateOrderStatus(order.id, "delivered");
    assert.ok(delivered);
    assert.equal(delivered.status, "delivered");
    assert.ok(delivered.deliveredAt);
  });

  it("returns undefined for nonexistent order", () => {
    const result = store.updateOrderStatus("nonexistent", "submitted");
    assert.equal(result, undefined);
  });

  it("lists orders by clinic and status", () => {
    const s = new RAMStore();

    s.createOrder({
      clinicId: "c1",
      supplier: "Sup A",
      items: [{ inventoryItemId: "i1", name: "Item 1", quantity: 10 }],
    });

    const o2 = s.createOrder({
      clinicId: "c1",
      supplier: "Sup B",
      items: [{ inventoryItemId: "i2", name: "Item 2", quantity: 20 }],
    });
    s.updateOrderStatus(o2.id, "submitted");

    s.createOrder({
      clinicId: "c2",
      supplier: "Sup C",
      items: [{ inventoryItemId: "i3", name: "Item 3", quantity: 5 }],
    });

    const allC1 = s.getOrdersByClinic("c1");
    assert.equal(allC1.length, 2);

    const draftOnly = s.getOrdersByClinic("c1", "draft");
    assert.equal(draftOnly.length, 1);

    s.close();
  });
});

// ─── Maintenance Records ─────────────────────────────────────

describe("RAM: Maintenance Records", () => {
  let store: RAMStore;

  before(() => {
    store = new RAMStore();
  });
  after(() => store.close());

  it("logs maintenance and updates asset", () => {
    const asset = store.registerAsset({
      clinicId: "clinic_a",
      category: "device",
      name: "Blood Pressure Monitor",
    });

    const record = store.logMaintenance({
      assetId: asset.id,
      clinicId: "clinic_a",
      type: "calibration",
      description: "Annual calibration check",
      performedBy: "Technician John",
      nextDue: "2027-03-26T00:00:00.000Z",
      cost: 50,
      parts: ["calibration_kit"],
      notes: "All readings within spec",
    });

    assert.ok(record.id.startsWith("maint_"));
    assert.equal(record.type, "calibration");
    assert.equal(record.performedBy, "Technician John");
    assert.deepEqual(record.parts, ["calibration_kit"]);

    // Verify asset was updated
    const updated = store.getAsset(asset.id);
    assert.ok(updated);
    assert.ok(updated.lastMaintenance);
    assert.equal(updated.nextMaintenance, "2027-03-26T00:00:00.000Z");
  });

  it("retrieves maintenance history for an asset", () => {
    const asset = store.registerAsset({
      clinicId: "clinic_a",
      category: "equipment",
      name: "Autoclave",
    });

    store.logMaintenance({
      assetId: asset.id,
      clinicId: "clinic_a",
      type: "preventive",
      description: "Monthly check",
      performedBy: "Tech A",
    });

    store.logMaintenance({
      assetId: asset.id,
      clinicId: "clinic_a",
      type: "corrective",
      description: "Replaced gasket",
      performedBy: "Tech B",
      parts: ["gasket_ring"],
    });

    const history = store.getMaintenanceForAsset(asset.id);
    assert.equal(history.length, 2);
  });

  it("detects assets with overdue maintenance", () => {
    const s = new RAMStore();

    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5);

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);

    s.registerAsset({
      clinicId: "c1",
      category: "device",
      name: "Overdue Device",
      status: "deployed",
      nextMaintenance: pastDate.toISOString(),
    });

    s.registerAsset({
      clinicId: "c1",
      category: "device",
      name: "Future Device",
      status: "deployed",
      nextMaintenance: futureDate.toISOString(),
    });

    s.registerAsset({
      clinicId: "c1",
      category: "device",
      name: "Retired Device",
      status: "retired",
      nextMaintenance: pastDate.toISOString(),
    });

    const due = s.getMaintenanceDue("c1");
    assert.equal(due.length, 1);
    assert.equal(due[0].name, "Overdue Device");

    s.close();
  });
});

// ─── Alert Generation ────────────────────────────────────────

describe("RAM: Alert Generation", () => {
  it("generates low stock alerts", () => {
    const store = new RAMStore();

    store.addInventoryItem({
      clinicId: "c1",
      name: "Critical Supply",
      category: "consumable",
      quantity: 0,
      unit: "units",
      reorderLevel: 10,
      reorderQuantity: 50,
    });

    store.addInventoryItem({
      clinicId: "c1",
      name: "Low Supply",
      category: "consumable",
      quantity: 5,
      unit: "units",
      reorderLevel: 10,
      reorderQuantity: 50,
    });

    const alerts = store.checkAlerts("c1");
    const lowStock = alerts.filter((a) => a.type === "low_stock");
    assert.equal(lowStock.length, 2);

    const critical = lowStock.find((a) => a.subject === "Critical Supply");
    assert.ok(critical);
    assert.equal(critical.severity, "critical");

    const warning = lowStock.find((a) => a.subject === "Low Supply");
    assert.ok(warning);
    assert.equal(warning.severity, "warning");

    store.close();
  });

  it("generates expiring item alerts", () => {
    const store = new RAMStore();

    const soon = new Date();
    soon.setDate(soon.getDate() + 5);

    store.addInventoryItem({
      clinicId: "c1",
      name: "Expiring Medication",
      category: "medication",
      quantity: 100,
      unit: "tablets",
      reorderLevel: 10,
      reorderQuantity: 50,
      expiryDate: soon.toISOString(),
    });

    const alerts = store.checkAlerts("c1");
    const expiring = alerts.filter((a) => a.type === "expiring");
    assert.equal(expiring.length, 1);
    assert.equal(expiring[0].severity, "critical"); // <= 7 days
    assert.equal(expiring[0].subject, "Expiring Medication");

    store.close();
  });

  it("generates maintenance due alerts", () => {
    const store = new RAMStore();

    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 3);

    store.registerAsset({
      clinicId: "c1",
      category: "device",
      name: "Overdue ECG",
      status: "deployed",
      nextMaintenance: pastDate.toISOString(),
    });

    const alerts = store.checkAlerts("c1");
    const maint = alerts.filter((a) => a.type === "maintenance_due");
    assert.equal(maint.length, 1);
    assert.equal(maint[0].subject, "Overdue ECG");

    store.close();
  });

  it("does not duplicate unacknowledged alerts", () => {
    const store = new RAMStore();

    store.addInventoryItem({
      clinicId: "c1",
      name: "Low Item",
      category: "consumable",
      quantity: 2,
      unit: "units",
      reorderLevel: 10,
      reorderQuantity: 50,
    });

    const first = store.checkAlerts("c1");
    assert.equal(first.length, 1);

    // Second check should not create duplicates
    const second = store.checkAlerts("c1");
    assert.equal(second.length, 0);

    // All alerts total should still be 1
    const all = store.getAlerts("c1");
    assert.equal(all.length, 1);

    store.close();
  });

  it("acknowledges alerts", () => {
    const store = new RAMStore();

    store.addInventoryItem({
      clinicId: "c1",
      name: "Acknowledged Item",
      category: "consumable",
      quantity: 0,
      unit: "units",
      reorderLevel: 10,
      reorderQuantity: 50,
    });

    store.checkAlerts("c1");
    const alerts = store.getAlerts("c1");
    assert.equal(alerts.length, 1);

    store.acknowledgeAlert(alerts[0].id);

    const remaining = store.getAlerts("c1", true);
    assert.equal(remaining.length, 0);

    // Including acknowledged
    const all = store.getAlerts("c1", false);
    assert.equal(all.length, 1);

    store.close();
  });
});

// ─── Clinic Isolation ────────────────────────────────────────

describe("RAM: Clinic Isolation", () => {
  it("clinic A cannot see clinic B assets", () => {
    const store = new RAMStore();

    store.registerAsset({
      clinicId: "clinic_a",
      category: "device",
      name: "Clinic A Device",
    });

    store.registerAsset({
      clinicId: "clinic_b",
      category: "device",
      name: "Clinic B Device",
    });

    const aAssets = store.getAssetsByClinic("clinic_a");
    assert.equal(aAssets.length, 1);
    assert.equal(aAssets[0].name, "Clinic A Device");

    const bAssets = store.getAssetsByClinic("clinic_b");
    assert.equal(bAssets.length, 1);
    assert.equal(bAssets[0].name, "Clinic B Device");

    store.close();
  });

  it("clinic A cannot see clinic B inventory", () => {
    const store = new RAMStore();

    store.addInventoryItem({
      clinicId: "clinic_a",
      name: "Clinic A Meds",
      category: "medication",
      quantity: 100,
      unit: "tablets",
      reorderLevel: 10,
      reorderQuantity: 50,
    });

    store.addInventoryItem({
      clinicId: "clinic_b",
      name: "Clinic B Meds",
      category: "medication",
      quantity: 200,
      unit: "tablets",
      reorderLevel: 20,
      reorderQuantity: 100,
    });

    const aItems = store.getInventoryByClinic("clinic_a");
    assert.equal(aItems.length, 1);
    assert.equal(aItems[0].name, "Clinic A Meds");

    const bItems = store.getInventoryByClinic("clinic_b");
    assert.equal(bItems.length, 1);
    assert.equal(bItems[0].name, "Clinic B Meds");

    store.close();
  });

  it("clinic A cannot see clinic B orders", () => {
    const store = new RAMStore();

    store.createOrder({
      clinicId: "clinic_a",
      supplier: "Sup A",
      items: [{ inventoryItemId: "i1", name: "Item", quantity: 10 }],
    });

    store.createOrder({
      clinicId: "clinic_b",
      supplier: "Sup B",
      items: [{ inventoryItemId: "i2", name: "Item", quantity: 20 }],
    });

    assert.equal(store.getOrdersByClinic("clinic_a").length, 1);
    assert.equal(store.getOrdersByClinic("clinic_b").length, 1);

    store.close();
  });

  it("clinic A alerts are isolated from clinic B", () => {
    const store = new RAMStore();

    store.addInventoryItem({
      clinicId: "clinic_a",
      name: "A Low",
      category: "consumable",
      quantity: 0,
      unit: "units",
      reorderLevel: 10,
      reorderQuantity: 50,
    });

    store.addInventoryItem({
      clinicId: "clinic_b",
      name: "B Low",
      category: "consumable",
      quantity: 0,
      unit: "units",
      reorderLevel: 10,
      reorderQuantity: 50,
    });

    store.checkAlerts("clinic_a");
    store.checkAlerts("clinic_b");

    const aAlerts = store.getAlerts("clinic_a");
    assert.equal(aAlerts.length, 1);
    assert.equal(aAlerts[0].subject, "A Low");

    const bAlerts = store.getAlerts("clinic_b");
    assert.equal(bAlerts.length, 1);
    assert.equal(bAlerts[0].subject, "B Low");

    store.close();
  });
});

// ─── Dashboard Stats ─────────────────────────────────────────

describe("RAM: Dashboard", () => {
  it("returns correct summary stats", () => {
    const store = new RAMStore();

    // Assets
    store.registerAsset({ clinicId: "c1", category: "device", name: "D1", status: "deployed" });
    store.registerAsset({ clinicId: "c1", category: "device", name: "D2", status: "deployed" });
    store.registerAsset({ clinicId: "c1", category: "equipment", name: "E1", status: "maintenance" });

    // Inventory with one low stock
    store.addInventoryItem({
      clinicId: "c1",
      name: "Gloves",
      category: "ppe",
      quantity: 5,
      unit: "boxes",
      reorderLevel: 10,
      reorderQuantity: 20,
    });

    store.addInventoryItem({
      clinicId: "c1",
      name: "Masks",
      category: "ppe",
      quantity: 100,
      unit: "units",
      reorderLevel: 20,
      reorderQuantity: 50,
    });

    // An order
    store.createOrder({
      clinicId: "c1",
      supplier: "Sup",
      items: [{ inventoryItemId: "i1", name: "Item", quantity: 10 }],
    });

    const dashboard = store.getClinicDashboard("c1");

    assert.equal(dashboard.clinicId, "c1");
    assert.equal(dashboard.totalAssets, 3);
    assert.equal(dashboard.assetsByStatus["deployed"], 2);
    assert.equal(dashboard.assetsByStatus["maintenance"], 1);
    assert.equal(dashboard.assetsByCategory["device"], 2);
    assert.equal(dashboard.assetsByCategory["equipment"], 1);
    assert.equal(dashboard.totalInventoryItems, 2);
    assert.equal(dashboard.lowStockCount, 1);
    assert.equal(dashboard.pendingOrders, 1);
    assert.ok(dashboard.generatedAt);

    store.close();
  });

  it("returns zeroes for empty clinic", () => {
    const store = new RAMStore();

    const dashboard = store.getClinicDashboard("empty_clinic");

    assert.equal(dashboard.totalAssets, 0);
    assert.equal(dashboard.totalInventoryItems, 0);
    assert.equal(dashboard.lowStockCount, 0);
    assert.equal(dashboard.maintenanceDueCount, 0);
    assert.equal(dashboard.pendingOrders, 0);
    assert.equal(dashboard.unacknowledgedAlerts, 0);

    store.close();
  });
});
