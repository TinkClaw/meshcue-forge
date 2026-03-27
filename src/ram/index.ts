/**
 * MeshCue RAM — Resource and Asset Management
 *
 * Track medical devices, consumables, medications, equipment,
 * and supply chains for clinics in underserved communities.
 */

export { RAMStore } from "./store.js";
export { registerRAMTools } from "./mcp.js";
export type {
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
