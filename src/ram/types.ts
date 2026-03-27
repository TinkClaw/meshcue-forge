/**
 * MeshCue RAM — Resource and Asset Management Types
 *
 * Track medical devices, consumables, medications, equipment, and supply
 * chains for clinics in underserved communities. Inspired by the Asante
 * Nodes framework's categorized knowledge + SQLite pattern.
 */

// ─── Asset Categories ────────────────────────────────────────

export type AssetCategory =
  | "device"
  | "consumable"
  | "medication"
  | "equipment"
  | "vehicle"
  | "infrastructure";

export type AssetStatus =
  | "ordered"
  | "in_transit"
  | "received"
  | "deployed"
  | "maintenance"
  | "retired"
  | "lost";

export type MaintenanceType =
  | "preventive"
  | "corrective"
  | "calibration"
  | "inspection";

// ─── Core Entities ───────────────────────────────────────────

export interface Asset {
  id: string;
  clinicId: string;
  category: AssetCategory;
  name: string;
  description?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  status: AssetStatus;
  location?: string;
  assignedTo?: string; // staff member or department
  purchaseDate?: string;
  warrantyExpiry?: string;
  lastMaintenance?: string;
  nextMaintenance?: string;
  tags: string[];
  metadata: Record<string, unknown>; // flexible fields
  forgeDeviceId?: string; // links to Forge-built device
  connectDeviceId?: string; // links to Connect IoT device
  createdAt: string;
  updatedAt: string;
}

export interface InventoryItem {
  id: string;
  clinicId: string;
  name: string;
  category: "medication" | "consumable" | "ppe" | "test_kit" | "blood_product";
  quantity: number;
  unit: string;
  reorderLevel: number; // alert when below this
  reorderQuantity: number;
  expiryDate?: string;
  batchNumber?: string;
  supplier?: string;
  unitCost?: number;
  currency?: string;
  storageRequirements?: string; // "refrigerated", "room_temp", "frozen"
  location?: string;
  lastRestocked?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Supply Orders ───────────────────────────────────────────

export type OrderStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "shipped"
  | "delivered"
  | "cancelled";

export interface OrderItem {
  inventoryItemId: string;
  name: string;
  quantity: number;
  unitCost?: number;
}

export interface SupplyOrder {
  id: string;
  clinicId: string;
  items: OrderItem[];
  status: OrderStatus;
  supplier: string;
  totalCost?: number;
  currency?: string;
  orderedAt?: string;
  expectedDelivery?: string;
  deliveredAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Maintenance ─────────────────────────────────────────────

export interface MaintenanceRecord {
  id: string;
  assetId: string;
  clinicId: string;
  type: MaintenanceType;
  description: string;
  performedBy: string;
  performedAt: string;
  nextDue?: string;
  cost?: number;
  parts?: string[];
  notes?: string;
}

// ─── Alerts ──────────────────────────────────────────────────

export type AlertType =
  | "low_stock"
  | "expiring"
  | "maintenance_due"
  | "warranty_expiry"
  | "device_offline";

export type AlertSeverity = "info" | "warning" | "critical";

export interface RAMAlert {
  id: string;
  clinicId: string;
  type: AlertType;
  severity: AlertSeverity;
  subject: string; // item/asset name
  message: string;
  acknowledged: boolean;
  createdAt: string;
}

// ─── Dashboard ───────────────────────────────────────────────

export interface ClinicDashboard {
  clinicId: string;
  totalAssets: number;
  assetsByStatus: Record<string, number>;
  assetsByCategory: Record<string, number>;
  totalInventoryItems: number;
  lowStockCount: number;
  expiringCount: number;
  maintenanceDueCount: number;
  pendingOrders: number;
  unacknowledgedAlerts: number;
  generatedAt: string;
}

// ─── Filters ─────────────────────────────────────────────────

export interface AssetFilter {
  category?: AssetCategory;
  status?: AssetStatus;
  search?: string; // name/description search
  assignedTo?: string;
  location?: string;
}

export interface InventoryFilter {
  category?: string;
  search?: string;
  lowStockOnly?: boolean;
  location?: string;
}
