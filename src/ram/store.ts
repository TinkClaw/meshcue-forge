/**
 * MeshCue RAM — SQLite-Backed Asset Store
 *
 * Persistent storage for clinic assets, inventory, supply orders,
 * maintenance records, and alerts. Uses WAL mode for concurrent reads
 * (same pattern as Asante Nodes' memory.py).
 */

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  Asset,
  AssetCategory,
  AssetFilter,
  AssetStatus,
  AlertSeverity,
  AlertType,
  ClinicDashboard,
  InventoryFilter,
  InventoryItem,
  MaintenanceRecord,
  MaintenanceType,
  OrderItem,
  OrderStatus,
  RAMAlert,
  SupplyOrder,
} from "./types.js";

// ─── Helpers ─────────────────────────────────────────────────

function nowISO(): string {
  return new Date().toISOString();
}

// ─── RAMStore ────────────────────────────────────────────────

export class RAMStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    this.db = new Database(dbPath || ":memory:");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.init();
  }

  // ── Schema ───────────────────────────────────────────────────

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        clinic_id TEXT NOT NULL,
        category TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        manufacturer TEXT,
        model TEXT,
        serial_number TEXT,
        status TEXT NOT NULL DEFAULT 'received',
        location TEXT,
        assigned_to TEXT,
        purchase_date TEXT,
        warranty_expiry TEXT,
        last_maintenance TEXT,
        next_maintenance TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}',
        forge_device_id TEXT,
        connect_device_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_assets_clinic ON assets(clinic_id);
      CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(clinic_id, status);
      CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(clinic_id, category);

      CREATE TABLE IF NOT EXISTS inventory (
        id TEXT PRIMARY KEY,
        clinic_id TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0,
        unit TEXT NOT NULL,
        reorder_level INTEGER NOT NULL DEFAULT 0,
        reorder_quantity INTEGER NOT NULL DEFAULT 0,
        expiry_date TEXT,
        batch_number TEXT,
        supplier TEXT,
        unit_cost REAL,
        currency TEXT,
        storage_requirements TEXT,
        location TEXT,
        last_restocked TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_inventory_clinic ON inventory(clinic_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_category ON inventory(clinic_id, category);

      CREATE TABLE IF NOT EXISTS supply_orders (
        id TEXT PRIMARY KEY,
        clinic_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        supplier TEXT NOT NULL,
        total_cost REAL,
        currency TEXT,
        ordered_at TEXT,
        expected_delivery TEXT,
        delivered_at TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_orders_clinic ON supply_orders(clinic_id);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON supply_orders(clinic_id, status);

      CREATE TABLE IF NOT EXISTS order_items (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        inventory_item_id TEXT NOT NULL,
        name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_cost REAL,
        FOREIGN KEY (order_id) REFERENCES supply_orders(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS maintenance_records (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        clinic_id TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        performed_by TEXT NOT NULL,
        performed_at TEXT NOT NULL,
        next_due TEXT,
        cost REAL,
        parts TEXT,
        notes TEXT,
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_maintenance_asset ON maintenance_records(asset_id);
      CREATE INDEX IF NOT EXISTS idx_maintenance_clinic ON maintenance_records(clinic_id);

      CREATE TABLE IF NOT EXISTS ram_alerts (
        id TEXT PRIMARY KEY,
        clinic_id TEXT NOT NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        subject TEXT NOT NULL,
        message TEXT NOT NULL,
        acknowledged INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_alerts_clinic ON ram_alerts(clinic_id);
      CREATE INDEX IF NOT EXISTS idx_alerts_unacked ON ram_alerts(clinic_id, acknowledged);
    `);
  }

  // ── Asset CRUD ─────────────────────────────────────────────

  registerAsset(params: {
    clinicId: string;
    category: AssetCategory;
    name: string;
    description?: string;
    manufacturer?: string;
    model?: string;
    serialNumber?: string;
    status?: AssetStatus;
    location?: string;
    assignedTo?: string;
    purchaseDate?: string;
    warrantyExpiry?: string;
    nextMaintenance?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    forgeDeviceId?: string;
    connectDeviceId?: string;
  }): Asset {
    const now = nowISO();
    const id = `asset_${randomUUID().slice(0, 12)}`;
    const asset: Asset = {
      id,
      clinicId: params.clinicId,
      category: params.category,
      name: params.name,
      description: params.description,
      manufacturer: params.manufacturer,
      model: params.model,
      serialNumber: params.serialNumber,
      status: params.status || "received",
      location: params.location,
      assignedTo: params.assignedTo,
      purchaseDate: params.purchaseDate,
      warrantyExpiry: params.warrantyExpiry,
      lastMaintenance: undefined,
      nextMaintenance: params.nextMaintenance,
      tags: params.tags || [],
      metadata: params.metadata || {},
      forgeDeviceId: params.forgeDeviceId,
      connectDeviceId: params.connectDeviceId,
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO assets (id, clinic_id, category, name, description, manufacturer, model,
         serial_number, status, location, assigned_to, purchase_date, warranty_expiry,
         last_maintenance, next_maintenance, tags, metadata, forge_device_id,
         connect_device_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        asset.id,
        asset.clinicId,
        asset.category,
        asset.name,
        asset.description ?? null,
        asset.manufacturer ?? null,
        asset.model ?? null,
        asset.serialNumber ?? null,
        asset.status,
        asset.location ?? null,
        asset.assignedTo ?? null,
        asset.purchaseDate ?? null,
        asset.warrantyExpiry ?? null,
        asset.lastMaintenance ?? null,
        asset.nextMaintenance ?? null,
        JSON.stringify(asset.tags),
        JSON.stringify(asset.metadata),
        asset.forgeDeviceId ?? null,
        asset.connectDeviceId ?? null,
        asset.createdAt,
        asset.updatedAt
      );

    return asset;
  }

  getAsset(id: string): Asset | undefined {
    const row = this.db
      .prepare("SELECT * FROM assets WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToAsset(row) : undefined;
  }

  updateAsset(
    id: string,
    updates: Partial<
      Pick<
        Asset,
        | "status"
        | "location"
        | "assignedTo"
        | "nextMaintenance"
        | "lastMaintenance"
        | "tags"
        | "metadata"
      >
    >
  ): Asset | undefined {
    const existing = this.getAsset(id);
    if (!existing) return undefined;

    const now = nowISO();
    const sets: string[] = ["updated_at = ?"];
    const values: unknown[] = [now];

    if (updates.status !== undefined) {
      sets.push("status = ?");
      values.push(updates.status);
    }
    if (updates.location !== undefined) {
      sets.push("location = ?");
      values.push(updates.location);
    }
    if (updates.assignedTo !== undefined) {
      sets.push("assigned_to = ?");
      values.push(updates.assignedTo);
    }
    if (updates.nextMaintenance !== undefined) {
      sets.push("next_maintenance = ?");
      values.push(updates.nextMaintenance);
    }
    if (updates.lastMaintenance !== undefined) {
      sets.push("last_maintenance = ?");
      values.push(updates.lastMaintenance);
    }
    if (updates.tags !== undefined) {
      sets.push("tags = ?");
      values.push(JSON.stringify(updates.tags));
    }
    if (updates.metadata !== undefined) {
      sets.push("metadata = ?");
      values.push(JSON.stringify(updates.metadata));
    }

    values.push(id);
    this.db
      .prepare(`UPDATE assets SET ${sets.join(", ")} WHERE id = ?`)
      .run(...values);

    return this.getAsset(id);
  }

  getAssetsByClinic(clinicId: string, filters?: AssetFilter): Asset[] {
    let sql = "SELECT * FROM assets WHERE clinic_id = ?";
    const params: unknown[] = [clinicId];

    if (filters?.category) {
      sql += " AND category = ?";
      params.push(filters.category);
    }
    if (filters?.status) {
      sql += " AND status = ?";
      params.push(filters.status);
    }
    if (filters?.assignedTo) {
      sql += " AND assigned_to = ?";
      params.push(filters.assignedTo);
    }
    if (filters?.location) {
      sql += " AND location = ?";
      params.push(filters.location);
    }
    if (filters?.search) {
      sql += " AND (name LIKE ? OR description LIKE ?)";
      const term = `%${filters.search}%`;
      params.push(term, term);
    }

    sql += " ORDER BY updated_at DESC";

    const rows = this.db.prepare(sql).all(...params) as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToAsset(r));
  }

  // ── Inventory CRUD ─────────────────────────────────────────

  addInventoryItem(params: {
    clinicId: string;
    name: string;
    category: "medication" | "consumable" | "ppe" | "test_kit" | "blood_product";
    quantity: number;
    unit: string;
    reorderLevel: number;
    reorderQuantity: number;
    expiryDate?: string;
    batchNumber?: string;
    supplier?: string;
    unitCost?: number;
    currency?: string;
    storageRequirements?: string;
    location?: string;
  }): InventoryItem {
    const now = nowISO();
    const id = `inv_${randomUUID().slice(0, 12)}`;
    const item: InventoryItem = {
      id,
      clinicId: params.clinicId,
      name: params.name,
      category: params.category,
      quantity: params.quantity,
      unit: params.unit,
      reorderLevel: params.reorderLevel,
      reorderQuantity: params.reorderQuantity,
      expiryDate: params.expiryDate,
      batchNumber: params.batchNumber,
      supplier: params.supplier,
      unitCost: params.unitCost,
      currency: params.currency,
      storageRequirements: params.storageRequirements,
      location: params.location,
      lastRestocked: now,
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO inventory (id, clinic_id, name, category, quantity, unit,
         reorder_level, reorder_quantity, expiry_date, batch_number, supplier,
         unit_cost, currency, storage_requirements, location, last_restocked,
         created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.id,
        item.clinicId,
        item.name,
        item.category,
        item.quantity,
        item.unit,
        item.reorderLevel,
        item.reorderQuantity,
        item.expiryDate ?? null,
        item.batchNumber ?? null,
        item.supplier ?? null,
        item.unitCost ?? null,
        item.currency ?? null,
        item.storageRequirements ?? null,
        item.location ?? null,
        item.lastRestocked,
        item.createdAt,
        item.updatedAt
      );

    return item;
  }

  getInventoryItem(id: string): InventoryItem | undefined {
    const row = this.db
      .prepare("SELECT * FROM inventory WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToInventory(row) : undefined;
  }

  restockItem(id: string, quantity: number): InventoryItem | undefined {
    const now = nowISO();
    this.db
      .prepare(
        "UPDATE inventory SET quantity = quantity + ?, last_restocked = ?, updated_at = ? WHERE id = ?"
      )
      .run(quantity, now, now, id);
    return this.getInventoryItem(id);
  }

  getInventoryByClinic(
    clinicId: string,
    filters?: InventoryFilter
  ): InventoryItem[] {
    let sql = "SELECT * FROM inventory WHERE clinic_id = ?";
    const params: unknown[] = [clinicId];

    if (filters?.category) {
      sql += " AND category = ?";
      params.push(filters.category);
    }
    if (filters?.search) {
      sql += " AND name LIKE ?";
      params.push(`%${filters.search}%`);
    }
    if (filters?.lowStockOnly) {
      sql += " AND quantity <= reorder_level";
    }
    if (filters?.location) {
      sql += " AND location = ?";
      params.push(filters.location);
    }

    sql += " ORDER BY name ASC";

    const rows = this.db.prepare(sql).all(...params) as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToInventory(r));
  }

  getLowStockItems(clinicId: string): InventoryItem[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM inventory WHERE clinic_id = ? AND quantity <= reorder_level ORDER BY quantity ASC"
      )
      .all(clinicId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToInventory(r));
  }

  getExpiringItems(clinicId: string, withinDays: number): InventoryItem[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + withinDays);
    const cutoffISO = cutoff.toISOString();

    const rows = this.db
      .prepare(
        `SELECT * FROM inventory
         WHERE clinic_id = ? AND expiry_date IS NOT NULL AND expiry_date <= ?
         ORDER BY expiry_date ASC`
      )
      .all(clinicId, cutoffISO) as Record<string, unknown>[];
    return rows.map((r) => this.rowToInventory(r));
  }

  // ── Supply Orders ──────────────────────────────────────────

  createOrder(params: {
    clinicId: string;
    supplier: string;
    items: OrderItem[];
    notes?: string;
    currency?: string;
  }): SupplyOrder {
    const now = nowISO();
    const id = `order_${randomUUID().slice(0, 12)}`;
    const totalCost = params.items.reduce((sum, item) => {
      return sum + (item.unitCost ?? 0) * item.quantity;
    }, 0);

    const order: SupplyOrder = {
      id,
      clinicId: params.clinicId,
      items: params.items,
      status: "draft",
      supplier: params.supplier,
      totalCost: totalCost || undefined,
      currency: params.currency,
      notes: params.notes,
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO supply_orders (id, clinic_id, status, supplier, total_cost,
         currency, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        order.id,
        order.clinicId,
        order.status,
        order.supplier,
        order.totalCost ?? null,
        order.currency ?? null,
        order.notes ?? null,
        order.createdAt,
        order.updatedAt
      );

    for (const item of params.items) {
      this.db
        .prepare(
          `INSERT INTO order_items (id, order_id, inventory_item_id, name, quantity, unit_cost)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          `oi_${randomUUID().slice(0, 12)}`,
          order.id,
          item.inventoryItemId,
          item.name,
          item.quantity,
          item.unitCost ?? null
        );
    }

    return order;
  }

  getOrder(id: string): SupplyOrder | undefined {
    const row = this.db
      .prepare("SELECT * FROM supply_orders WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;

    const items = this.db
      .prepare("SELECT * FROM order_items WHERE order_id = ?")
      .all(id) as Record<string, unknown>[];

    return this.rowToOrder(row, items);
  }

  updateOrderStatus(
    id: string,
    status: OrderStatus
  ): SupplyOrder | undefined {
    const now = nowISO();
    const extra: Record<string, unknown> = { updated_at: now, status };

    if (status === "submitted") extra.ordered_at = now;
    if (status === "delivered") extra.delivered_at = now;

    const sets = Object.keys(extra)
      .map((k) => `${k} = ?`)
      .join(", ");
    this.db
      .prepare(`UPDATE supply_orders SET ${sets} WHERE id = ?`)
      .run(...Object.values(extra), id);

    return this.getOrder(id);
  }

  getOrdersByClinic(clinicId: string, status?: OrderStatus): SupplyOrder[] {
    let sql = "SELECT * FROM supply_orders WHERE clinic_id = ?";
    const params: unknown[] = [clinicId];
    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }
    sql += " ORDER BY created_at DESC";

    const rows = this.db.prepare(sql).all(...params) as Record<
      string,
      unknown
    >[];
    return rows.map((row) => {
      const items = this.db
        .prepare("SELECT * FROM order_items WHERE order_id = ?")
        .all(row.id as string) as Record<string, unknown>[];
      return this.rowToOrder(row, items);
    });
  }

  // ── Maintenance Records ────────────────────────────────────

  logMaintenance(params: {
    assetId: string;
    clinicId: string;
    type: MaintenanceType;
    description: string;
    performedBy: string;
    performedAt?: string;
    nextDue?: string;
    cost?: number;
    parts?: string[];
    notes?: string;
  }): MaintenanceRecord {
    const id = `maint_${randomUUID().slice(0, 12)}`;
    const performedAt = params.performedAt || nowISO();

    const record: MaintenanceRecord = {
      id,
      assetId: params.assetId,
      clinicId: params.clinicId,
      type: params.type,
      description: params.description,
      performedBy: params.performedBy,
      performedAt,
      nextDue: params.nextDue,
      cost: params.cost,
      parts: params.parts,
      notes: params.notes,
    };

    this.db
      .prepare(
        `INSERT INTO maintenance_records (id, asset_id, clinic_id, type, description,
         performed_by, performed_at, next_due, cost, parts, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.assetId,
        record.clinicId,
        record.type,
        record.description,
        record.performedBy,
        record.performedAt,
        record.nextDue ?? null,
        record.cost ?? null,
        record.parts ? JSON.stringify(record.parts) : null,
        record.notes ?? null
      );

    // Update asset maintenance dates
    this.updateAsset(params.assetId, {
      lastMaintenance: performedAt,
      nextMaintenance: params.nextDue,
    });

    return record;
  }

  getMaintenanceForAsset(assetId: string): MaintenanceRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM maintenance_records WHERE asset_id = ? ORDER BY performed_at DESC"
      )
      .all(assetId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToMaintenance(r));
  }

  getMaintenanceDue(clinicId: string): Asset[] {
    const now = nowISO();
    const rows = this.db
      .prepare(
        `SELECT * FROM assets
         WHERE clinic_id = ? AND next_maintenance IS NOT NULL AND next_maintenance <= ?
         AND status NOT IN ('retired', 'lost')
         ORDER BY next_maintenance ASC`
      )
      .all(clinicId, now) as Record<string, unknown>[];
    return rows.map((r) => this.rowToAsset(r));
  }

  // ── Alerts ─────────────────────────────────────────────────

  createAlert(params: {
    clinicId: string;
    type: AlertType;
    severity: AlertSeverity;
    subject: string;
    message: string;
  }): RAMAlert {
    const id = `alert_${randomUUID().slice(0, 12)}`;
    const alert: RAMAlert = {
      id,
      clinicId: params.clinicId,
      type: params.type,
      severity: params.severity,
      subject: params.subject,
      message: params.message,
      acknowledged: false,
      createdAt: nowISO(),
    };

    this.db
      .prepare(
        `INSERT INTO ram_alerts (id, clinic_id, type, severity, subject, message, acknowledged, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
      )
      .run(
        alert.id,
        alert.clinicId,
        alert.type,
        alert.severity,
        alert.subject,
        alert.message,
        alert.createdAt
      );

    return alert;
  }

  getAlerts(clinicId: string, unacknowledgedOnly = true): RAMAlert[] {
    let sql = "SELECT * FROM ram_alerts WHERE clinic_id = ?";
    if (unacknowledgedOnly) sql += " AND acknowledged = 0";
    sql += " ORDER BY created_at DESC";

    const rows = this.db.prepare(sql).all(clinicId) as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToAlert(r));
  }

  acknowledgeAlert(id: string): void {
    this.db
      .prepare("UPDATE ram_alerts SET acknowledged = 1 WHERE id = ?")
      .run(id);
  }

  /**
   * Scan clinic state and auto-generate alerts for:
   * - Low stock items
   * - Expiring items (within 30 days)
   * - Maintenance due
   * - Warranty expiry (within 30 days)
   */
  checkAlerts(clinicId: string): RAMAlert[] {
    const generated: RAMAlert[] = [];

    // Low stock
    const lowStock = this.getLowStockItems(clinicId);
    for (const item of lowStock) {
      const existing = this.db
        .prepare(
          "SELECT id FROM ram_alerts WHERE clinic_id = ? AND type = 'low_stock' AND subject = ? AND acknowledged = 0"
        )
        .get(clinicId, item.name) as Record<string, unknown> | undefined;
      if (!existing) {
        const alert = this.createAlert({
          clinicId,
          type: "low_stock",
          severity: item.quantity === 0 ? "critical" : "warning",
          subject: item.name,
          message: `${item.name}: ${item.quantity} ${item.unit} remaining (reorder level: ${item.reorderLevel})`,
        });
        generated.push(alert);
      }
    }

    // Expiring items (within 30 days)
    const expiring = this.getExpiringItems(clinicId, 30);
    for (const item of expiring) {
      const existing = this.db
        .prepare(
          "SELECT id FROM ram_alerts WHERE clinic_id = ? AND type = 'expiring' AND subject = ? AND acknowledged = 0"
        )
        .get(clinicId, item.name) as Record<string, unknown> | undefined;
      if (!existing) {
        const daysLeft = Math.ceil(
          (new Date(item.expiryDate!).getTime() - Date.now()) /
            (1000 * 60 * 60 * 24)
        );
        const alert = this.createAlert({
          clinicId,
          type: "expiring",
          severity: daysLeft <= 7 ? "critical" : "warning",
          subject: item.name,
          message: `${item.name} (batch ${item.batchNumber || "N/A"}) expires in ${daysLeft} days (${item.expiryDate})`,
        });
        generated.push(alert);
      }
    }

    // Maintenance due
    const maintenanceDue = this.getMaintenanceDue(clinicId);
    for (const asset of maintenanceDue) {
      const existing = this.db
        .prepare(
          "SELECT id FROM ram_alerts WHERE clinic_id = ? AND type = 'maintenance_due' AND subject = ? AND acknowledged = 0"
        )
        .get(clinicId, asset.name) as Record<string, unknown> | undefined;
      if (!existing) {
        const alert = this.createAlert({
          clinicId,
          type: "maintenance_due",
          severity: "warning",
          subject: asset.name,
          message: `${asset.name} maintenance was due on ${asset.nextMaintenance}`,
        });
        generated.push(alert);
      }
    }

    // Warranty expiry (within 30 days)
    const now = new Date();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 30);
    const warrantyRows = this.db
      .prepare(
        `SELECT * FROM assets
         WHERE clinic_id = ? AND warranty_expiry IS NOT NULL
         AND warranty_expiry <= ? AND warranty_expiry >= ?
         AND status NOT IN ('retired', 'lost')`
      )
      .all(clinicId, cutoff.toISOString(), now.toISOString()) as Record<
      string,
      unknown
    >[];

    for (const row of warrantyRows) {
      const asset = this.rowToAsset(row);
      const existing = this.db
        .prepare(
          "SELECT id FROM ram_alerts WHERE clinic_id = ? AND type = 'warranty_expiry' AND subject = ? AND acknowledged = 0"
        )
        .get(clinicId, asset.name) as Record<string, unknown> | undefined;
      if (!existing) {
        const alert = this.createAlert({
          clinicId,
          type: "warranty_expiry",
          severity: "info",
          subject: asset.name,
          message: `${asset.name} warranty expires on ${asset.warrantyExpiry}`,
        });
        generated.push(alert);
      }
    }

    return generated;
  }

  // ── Dashboard ──────────────────────────────────────────────

  getClinicDashboard(clinicId: string): ClinicDashboard {
    const assetsByStatus = this.db
      .prepare(
        "SELECT status, COUNT(*) as count FROM assets WHERE clinic_id = ? GROUP BY status"
      )
      .all(clinicId) as { status: string; count: number }[];

    const assetsByCategory = this.db
      .prepare(
        "SELECT category, COUNT(*) as count FROM assets WHERE clinic_id = ? GROUP BY category"
      )
      .all(clinicId) as { category: string; count: number }[];

    const totalAssets = (
      this.db
        .prepare("SELECT COUNT(*) as count FROM assets WHERE clinic_id = ?")
        .get(clinicId) as { count: number }
    ).count;

    const totalInventoryItems = (
      this.db
        .prepare("SELECT COUNT(*) as count FROM inventory WHERE clinic_id = ?")
        .get(clinicId) as { count: number }
    ).count;

    const lowStockCount = (
      this.db
        .prepare(
          "SELECT COUNT(*) as count FROM inventory WHERE clinic_id = ? AND quantity <= reorder_level"
        )
        .get(clinicId) as { count: number }
    ).count;

    const now = nowISO();
    const maintenanceDueCount = (
      this.db
        .prepare(
          `SELECT COUNT(*) as count FROM assets
           WHERE clinic_id = ? AND next_maintenance IS NOT NULL AND next_maintenance <= ?
           AND status NOT IN ('retired', 'lost')`
        )
        .get(clinicId, now) as { count: number }
    ).count;

    const cutoff30 = new Date();
    cutoff30.setDate(cutoff30.getDate() + 30);
    const expiringCount = (
      this.db
        .prepare(
          `SELECT COUNT(*) as count FROM inventory
           WHERE clinic_id = ? AND expiry_date IS NOT NULL AND expiry_date <= ?`
        )
        .get(clinicId, cutoff30.toISOString()) as { count: number }
    ).count;

    const pendingOrders = (
      this.db
        .prepare(
          "SELECT COUNT(*) as count FROM supply_orders WHERE clinic_id = ? AND status IN ('draft', 'submitted', 'approved', 'shipped')"
        )
        .get(clinicId) as { count: number }
    ).count;

    const unacknowledgedAlerts = (
      this.db
        .prepare(
          "SELECT COUNT(*) as count FROM ram_alerts WHERE clinic_id = ? AND acknowledged = 0"
        )
        .get(clinicId) as { count: number }
    ).count;

    return {
      clinicId,
      totalAssets,
      assetsByStatus: Object.fromEntries(
        assetsByStatus.map((r) => [r.status, r.count])
      ),
      assetsByCategory: Object.fromEntries(
        assetsByCategory.map((r) => [r.category, r.count])
      ),
      totalInventoryItems,
      lowStockCount,
      expiringCount,
      maintenanceDueCount,
      pendingOrders,
      unacknowledgedAlerts,
      generatedAt: nowISO(),
    };
  }

  // ── Row Mappers ────────────────────────────────────────────

  private rowToAsset(row: Record<string, unknown>): Asset {
    return {
      id: row.id as string,
      clinicId: row.clinic_id as string,
      category: row.category as AssetCategory,
      name: row.name as string,
      description: row.description as string | undefined,
      manufacturer: row.manufacturer as string | undefined,
      model: row.model as string | undefined,
      serialNumber: row.serial_number as string | undefined,
      status: row.status as AssetStatus,
      location: row.location as string | undefined,
      assignedTo: row.assigned_to as string | undefined,
      purchaseDate: row.purchase_date as string | undefined,
      warrantyExpiry: row.warranty_expiry as string | undefined,
      lastMaintenance: row.last_maintenance as string | undefined,
      nextMaintenance: row.next_maintenance as string | undefined,
      tags: JSON.parse((row.tags as string) || "[]"),
      metadata: JSON.parse((row.metadata as string) || "{}"),
      forgeDeviceId: row.forge_device_id as string | undefined,
      connectDeviceId: row.connect_device_id as string | undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  private rowToInventory(row: Record<string, unknown>): InventoryItem {
    return {
      id: row.id as string,
      clinicId: row.clinic_id as string,
      name: row.name as string,
      category: row.category as InventoryItem["category"],
      quantity: row.quantity as number,
      unit: row.unit as string,
      reorderLevel: row.reorder_level as number,
      reorderQuantity: row.reorder_quantity as number,
      expiryDate: row.expiry_date as string | undefined,
      batchNumber: row.batch_number as string | undefined,
      supplier: row.supplier as string | undefined,
      unitCost: row.unit_cost as number | undefined,
      currency: row.currency as string | undefined,
      storageRequirements: row.storage_requirements as string | undefined,
      location: row.location as string | undefined,
      lastRestocked: row.last_restocked as string | undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  private rowToOrder(
    row: Record<string, unknown>,
    itemRows: Record<string, unknown>[]
  ): SupplyOrder {
    return {
      id: row.id as string,
      clinicId: row.clinic_id as string,
      items: itemRows.map((ir) => ({
        inventoryItemId: ir.inventory_item_id as string,
        name: ir.name as string,
        quantity: ir.quantity as number,
        unitCost: ir.unit_cost as number | undefined,
      })),
      status: row.status as OrderStatus,
      supplier: row.supplier as string,
      totalCost: row.total_cost as number | undefined,
      currency: row.currency as string | undefined,
      orderedAt: row.ordered_at as string | undefined,
      expectedDelivery: row.expected_delivery as string | undefined,
      deliveredAt: row.delivered_at as string | undefined,
      notes: row.notes as string | undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  private rowToMaintenance(row: Record<string, unknown>): MaintenanceRecord {
    return {
      id: row.id as string,
      assetId: row.asset_id as string,
      clinicId: row.clinic_id as string,
      type: row.type as MaintenanceType,
      description: row.description as string,
      performedBy: row.performed_by as string,
      performedAt: row.performed_at as string,
      nextDue: row.next_due as string | undefined,
      cost: row.cost as number | undefined,
      parts: row.parts ? JSON.parse(row.parts as string) : undefined,
      notes: row.notes as string | undefined,
    };
  }

  private rowToAlert(row: Record<string, unknown>): RAMAlert {
    return {
      id: row.id as string,
      clinicId: row.clinic_id as string,
      type: row.type as AlertType,
      severity: row.severity as AlertSeverity,
      subject: row.subject as string,
      message: row.message as string,
      acknowledged: (row.acknowledged as number) === 1,
      createdAt: row.created_at as string,
    };
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }
}
