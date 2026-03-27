/**
 * MeshCue RAM — MCP Tool Definitions
 *
 * Registers RAM tools on an McpServer so AI agents can
 * manage clinic assets, inventory, supply orders, and maintenance.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RAMStore } from "./store.js";
import type { AssetCategory, AssetStatus, MaintenanceType } from "./types.js";

// ─── Helpers ─────────────────────────────────────────────────

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function err(msg: string) {
  return {
    content: [{ type: "text" as const, text: msg }],
    isError: true,
  };
}

// ─── Tool Registration ────────────────────────────────────────

export function registerRAMTools(server: McpServer): void {
  const store = new RAMStore(process.env.MESHCUE_DB_PATH);

  // ── meshcue-ram-register-asset ──────────────────────────────

  server.tool(
    "meshcue-ram-register-asset",
    "Register a new device, equipment, or asset at a clinic. Tracks physical " +
      "assets including medical devices, vehicles, and infrastructure. " +
      "Optionally links to a Forge-built device or Connect IoT device.",
    {
      clinicId: z.string().describe("Clinic ID that owns this asset"),
      category: z
        .enum([
          "device",
          "consumable",
          "medication",
          "equipment",
          "vehicle",
          "infrastructure",
        ])
        .describe("Asset category"),
      name: z
        .string()
        .describe("Asset name, e.g. 'Pulse Oximeter' or 'Solar Panel Array'"),
      description: z.string().optional().describe("Detailed description"),
      manufacturer: z.string().optional().describe("Manufacturer name"),
      model: z.string().optional().describe("Model number or name"),
      serialNumber: z.string().optional().describe("Serial number"),
      status: z
        .enum([
          "ordered",
          "in_transit",
          "received",
          "deployed",
          "maintenance",
          "retired",
          "lost",
        ])
        .optional()
        .describe("Initial status. Default: 'received'"),
      location: z
        .string()
        .optional()
        .describe("Physical location within the clinic, e.g. 'Ward A'"),
      assignedTo: z
        .string()
        .optional()
        .describe("Staff member or department the asset is assigned to"),
      purchaseDate: z
        .string()
        .optional()
        .describe("Purchase date in ISO 8601 format"),
      warrantyExpiry: z
        .string()
        .optional()
        .describe("Warranty expiry date in ISO 8601 format"),
      nextMaintenance: z
        .string()
        .optional()
        .describe("Next maintenance due date in ISO 8601 format"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Searchable tags, e.g. ['pediatric', 'portable']"),
      metadata: z
        .string()
        .optional()
        .describe("Additional metadata as a JSON string"),
      forgeDeviceId: z
        .string()
        .optional()
        .describe("Link to a Forge-built device MHDL ID"),
      connectDeviceId: z
        .string()
        .optional()
        .describe("Link to a Connect IoT device ID"),
    },
    async ({
      clinicId,
      category,
      name,
      description,
      manufacturer,
      model,
      serialNumber,
      status,
      location,
      assignedTo,
      purchaseDate,
      warrantyExpiry,
      nextMaintenance,
      tags,
      metadata,
      forgeDeviceId,
      connectDeviceId,
    }) => {
      try {
        const asset = store.registerAsset({
          clinicId,
          category: category as AssetCategory,
          name,
          description,
          manufacturer,
          model,
          serialNumber,
          status: status as AssetStatus | undefined,
          location,
          assignedTo,
          purchaseDate,
          warrantyExpiry,
          nextMaintenance,
          tags,
          metadata: metadata ? JSON.parse(metadata) : undefined,
          forgeDeviceId,
          connectDeviceId,
        });

        return ok({
          assetId: asset.id,
          name: asset.name,
          category: asset.category,
          status: asset.status,
          message: `Asset '${asset.name}' registered successfully at clinic ${clinicId}.`,
        });
      } catch (e) {
        return err(
          `Asset registration error: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  );

  // ── meshcue-ram-update-asset ────────────────────────────────

  server.tool(
    "meshcue-ram-update-asset",
    "Update an existing asset's status, location, assignment, or maintenance schedule. " +
      "Use this to track deployments, reassignments, and status changes.",
    {
      assetId: z.string().describe("Asset ID to update"),
      status: z
        .enum([
          "ordered",
          "in_transit",
          "received",
          "deployed",
          "maintenance",
          "retired",
          "lost",
        ])
        .optional()
        .describe("New status"),
      location: z.string().optional().describe("New location"),
      assignedTo: z.string().optional().describe("New assignee"),
      nextMaintenance: z
        .string()
        .optional()
        .describe("Next maintenance due date in ISO 8601 format"),
      tags: z.array(z.string()).optional().describe("Replace tags"),
      metadata: z
        .string()
        .optional()
        .describe("Replace metadata (JSON string)"),
    },
    async ({
      assetId,
      status,
      location,
      assignedTo,
      nextMaintenance,
      tags,
      metadata,
    }) => {
      try {
        const updated = store.updateAsset(assetId, {
          status: status as AssetStatus | undefined,
          location,
          assignedTo,
          nextMaintenance,
          tags,
          metadata: metadata ? JSON.parse(metadata) : undefined,
        });

        if (!updated) {
          return err(`Asset not found: ${assetId}`);
        }

        return ok({
          asset: updated,
          message: `Asset '${updated.name}' updated successfully.`,
        });
      } catch (e) {
        return err(
          `Asset update error: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  );

  // ── meshcue-ram-inventory ───────────────────────────────────

  server.tool(
    "meshcue-ram-inventory",
    "List and search assets and inventory stock for a clinic. " +
      "Filter by category, status, location, or free-text search. " +
      "Returns both tracked assets and consumable stock levels.",
    {
      clinicId: z.string().describe("Clinic ID to query"),
      type: z
        .enum(["assets", "stock", "both"])
        .optional()
        .describe("What to list: 'assets' (devices/equipment), 'stock' (consumables/medications), or 'both'. Default: 'both'"),
      category: z.string().optional().describe("Filter by category"),
      status: z
        .string()
        .optional()
        .describe("Filter assets by status (e.g. 'deployed', 'maintenance')"),
      search: z
        .string()
        .optional()
        .describe("Free-text search in names and descriptions"),
      location: z.string().optional().describe("Filter by location"),
      lowStockOnly: z
        .boolean()
        .optional()
        .describe("If true, only show items below reorder level"),
    },
    async ({
      clinicId,
      type,
      category,
      status,
      search,
      location,
      lowStockOnly,
    }) => {
      try {
        const listType = type || "both";
        const result: Record<string, unknown> = { clinicId };

        if (listType === "assets" || listType === "both") {
          result.assets = store.getAssetsByClinic(clinicId, {
            category: category as AssetCategory | undefined,
            status: status as AssetStatus | undefined,
            search,
            location,
          });
        }

        if (listType === "stock" || listType === "both") {
          result.stock = store.getInventoryByClinic(clinicId, {
            category,
            search,
            lowStockOnly,
            location,
          });
        }

        return ok(result);
      } catch (e) {
        return err(
          `Inventory query error: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  );

  // ── meshcue-ram-restock ─────────────────────────────────────

  server.tool(
    "meshcue-ram-restock",
    "Add stock for consumables, medications, PPE, test kits, or blood products. " +
      "Creates a new inventory item or restocks an existing one by ID.",
    {
      clinicId: z.string().describe("Clinic ID"),
      itemId: z
        .string()
        .optional()
        .describe("Existing inventory item ID to restock. If omitted, creates a new item."),
      name: z
        .string()
        .optional()
        .describe("Item name (required for new items)"),
      category: z
        .enum(["medication", "consumable", "ppe", "test_kit", "blood_product"])
        .optional()
        .describe("Item category (required for new items)"),
      quantity: z.number().describe("Quantity to add (or initial quantity for new items)"),
      unit: z
        .string()
        .optional()
        .describe("Unit of measure, e.g. 'tablets', 'boxes', 'units' (required for new items)"),
      reorderLevel: z
        .number()
        .optional()
        .describe("Alert when stock falls below this level (required for new items)"),
      reorderQuantity: z
        .number()
        .optional()
        .describe("Suggested reorder quantity (required for new items)"),
      expiryDate: z.string().optional().describe("Expiry date in ISO 8601 format"),
      batchNumber: z.string().optional().describe("Batch/lot number"),
      supplier: z.string().optional().describe("Supplier name"),
      unitCost: z.number().optional().describe("Cost per unit"),
      currency: z.string().optional().describe("Currency code, e.g. 'USD', 'KES'"),
      storageRequirements: z
        .string()
        .optional()
        .describe("Storage requirements: 'refrigerated', 'room_temp', 'frozen'"),
      location: z
        .string()
        .optional()
        .describe("Storage location within the clinic"),
    },
    async ({
      clinicId,
      itemId,
      name,
      category,
      quantity,
      unit,
      reorderLevel,
      reorderQuantity,
      expiryDate,
      batchNumber,
      supplier,
      unitCost,
      currency,
      storageRequirements,
      location,
    }) => {
      try {
        if (itemId) {
          // Restock existing item
          const updated = store.restockItem(itemId, quantity);
          if (!updated) {
            return err(`Inventory item not found: ${itemId}`);
          }
          return ok({
            item: updated,
            added: quantity,
            message: `Restocked ${quantity} ${updated.unit} of '${updated.name}'. New total: ${updated.quantity} ${updated.unit}.`,
          });
        }

        // Create new inventory item
        if (!name || !category || !unit) {
          return err(
            "New inventory items require 'name', 'category', and 'unit' parameters."
          );
        }

        const item = store.addInventoryItem({
          clinicId,
          name,
          category,
          quantity,
          unit,
          reorderLevel: reorderLevel ?? 0,
          reorderQuantity: reorderQuantity ?? 0,
          expiryDate,
          batchNumber,
          supplier,
          unitCost,
          currency,
          storageRequirements,
          location,
        });

        return ok({
          item,
          message: `Inventory item '${item.name}' created with ${quantity} ${unit}.`,
        });
      } catch (e) {
        return err(
          `Restock error: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  );

  // ── meshcue-ram-order ───────────────────────────────────────

  server.tool(
    "meshcue-ram-order",
    "Create or update a supply order for a clinic. " +
      "New orders start in 'draft' status. Update to move through the " +
      "lifecycle: draft -> submitted -> approved -> shipped -> delivered.",
    {
      clinicId: z.string().describe("Clinic ID"),
      orderId: z
        .string()
        .optional()
        .describe("Existing order ID to update status. If omitted, creates a new order."),
      status: z
        .enum(["draft", "submitted", "approved", "shipped", "delivered", "cancelled"])
        .optional()
        .describe("New status for existing order"),
      supplier: z
        .string()
        .optional()
        .describe("Supplier name (required for new orders)"),
      items: z
        .string()
        .optional()
        .describe(
          "JSON array of order items: [{inventoryItemId, name, quantity, unitCost?}] (required for new orders)"
        ),
      notes: z.string().optional().describe("Order notes"),
      currency: z.string().optional().describe("Currency code"),
    },
    async ({ clinicId, orderId, status, supplier, items, notes, currency }) => {
      try {
        if (orderId) {
          // Update existing order
          if (!status) {
            return err("Updating an order requires a 'status' parameter.");
          }
          const updated = store.updateOrderStatus(orderId, status);
          if (!updated) {
            return err(`Order not found: ${orderId}`);
          }
          return ok({
            order: updated,
            message: `Order ${orderId} updated to '${status}'.`,
          });
        }

        // Create new order
        if (!supplier) {
          return err("New orders require a 'supplier' parameter.");
        }

        const parsedItems = items ? JSON.parse(items) : [];
        if (parsedItems.length === 0) {
          return err(
            "New orders require at least one item. Pass 'items' as a JSON array."
          );
        }

        const order = store.createOrder({
          clinicId,
          supplier,
          items: parsedItems,
          notes,
          currency,
        });

        return ok({
          order,
          message: `Supply order ${order.id} created with ${parsedItems.length} item(s) from '${supplier}'.`,
        });
      } catch (e) {
        return err(
          `Order error: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  );

  // ── meshcue-ram-maintenance ─────────────────────────────────

  server.tool(
    "meshcue-ram-maintenance",
    "Log a maintenance record for an asset. Supports preventive, " +
      "corrective, calibration, and inspection maintenance types. " +
      "Automatically updates the asset's maintenance schedule.",
    {
      assetId: z.string().describe("Asset ID that was maintained"),
      clinicId: z.string().describe("Clinic ID"),
      type: z
        .enum(["preventive", "corrective", "calibration", "inspection"])
        .describe("Type of maintenance performed"),
      description: z
        .string()
        .describe("Description of work performed"),
      performedBy: z
        .string()
        .describe("Name of person or team who performed the maintenance"),
      performedAt: z
        .string()
        .optional()
        .describe("When maintenance was performed (ISO 8601). Default: now"),
      nextDue: z
        .string()
        .optional()
        .describe("Next maintenance due date (ISO 8601)"),
      cost: z.number().optional().describe("Cost of maintenance"),
      parts: z
        .array(z.string())
        .optional()
        .describe("List of replacement parts used"),
      notes: z.string().optional().describe("Additional notes"),
    },
    async ({
      assetId,
      clinicId,
      type,
      description,
      performedBy,
      performedAt,
      nextDue,
      cost,
      parts,
      notes,
    }) => {
      try {
        // Verify asset exists
        const asset = store.getAsset(assetId);
        if (!asset) {
          return err(`Asset not found: ${assetId}`);
        }

        const record = store.logMaintenance({
          assetId,
          clinicId,
          type: type as MaintenanceType,
          description,
          performedBy,
          performedAt,
          nextDue,
          cost,
          parts,
          notes,
        });

        return ok({
          record,
          asset: store.getAsset(assetId),
          message: `${type} maintenance logged for '${asset.name}'. ${nextDue ? `Next due: ${nextDue}` : ""}`,
        });
      } catch (e) {
        return err(
          `Maintenance error: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  );

  // ── meshcue-ram-alerts ──────────────────────────────────────

  server.tool(
    "meshcue-ram-alerts",
    "Get pending alerts for a clinic: low stock, expiring items, " +
      "maintenance due, and warranty expiry. Automatically scans clinic " +
      "state and generates new alerts. Optionally acknowledge alerts.",
    {
      clinicId: z.string().describe("Clinic ID to check"),
      acknowledgeId: z
        .string()
        .optional()
        .describe("Alert ID to acknowledge (mark as handled)"),
      includeAcknowledged: z
        .boolean()
        .optional()
        .describe("Include previously acknowledged alerts. Default: false"),
    },
    async ({ clinicId, acknowledgeId, includeAcknowledged }) => {
      try {
        if (acknowledgeId) {
          store.acknowledgeAlert(acknowledgeId);
          return ok({
            acknowledged: acknowledgeId,
            message: `Alert ${acknowledgeId} acknowledged.`,
          });
        }

        // Scan and generate new alerts
        const generated = store.checkAlerts(clinicId);
        const allAlerts = store.getAlerts(clinicId, !includeAcknowledged);

        return ok({
          clinicId,
          newAlerts: generated.length,
          alerts: allAlerts,
          summary: {
            total: allAlerts.length,
            critical: allAlerts.filter((a) => a.severity === "critical").length,
            warning: allAlerts.filter((a) => a.severity === "warning").length,
            info: allAlerts.filter((a) => a.severity === "info").length,
          },
        });
      } catch (e) {
        return err(
          `Alerts error: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  );

  // ── meshcue-ram-dashboard ───────────────────────────────────

  server.tool(
    "meshcue-ram-dashboard",
    "Get a resource summary dashboard for a clinic: total assets by " +
      "status/category, low stock count, maintenance due, expiring items, " +
      "pending orders, and unacknowledged alerts.",
    {
      clinicId: z.string().describe("Clinic ID to summarize"),
    },
    async ({ clinicId }) => {
      try {
        // Also generate any new alerts before dashboard
        store.checkAlerts(clinicId);
        const dashboard = store.getClinicDashboard(clinicId);

        return ok({
          dashboard,
          message: `Dashboard for clinic ${clinicId}: ${dashboard.totalAssets} assets, ${dashboard.totalInventoryItems} inventory items, ${dashboard.lowStockCount} low stock, ${dashboard.maintenanceDueCount} maintenance due.`,
        });
      } catch (e) {
        return err(
          `Dashboard error: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  );
}
