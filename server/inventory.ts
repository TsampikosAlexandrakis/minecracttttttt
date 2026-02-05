import { HOTBAR_SIZE, MAX_STACK } from "../src/config";
import { SharedItemId, SharedItemStack } from "../src/shared/protocol";

export interface ServerInventory {
  hotbar: (SharedItemStack | null)[];
  selectedSlot: number;
}

export function createStarterInventory(): ServerInventory {
  return {
    selectedSlot: 0,
    hotbar: [
      { item: "grass_block", count: 32 },
      { item: "dirt", count: 32 },
      { item: "stone", count: 32 },
      { item: "wood", count: 16 },
      { item: "sand", count: 16 },
      null,
      null,
      null,
      null
    ]
  };
}

export function countItem(inventory: ServerInventory, item: SharedItemId): number {
  let count = 0;
  for (const slot of inventory.hotbar) {
    if (slot?.item === item) {
      count += slot.count;
    }
  }
  return count;
}

export function addItem(inventory: ServerInventory, item: SharedItemId, count: number): number {
  let remaining = count;
  for (const slot of inventory.hotbar) {
    if (!slot || slot.item !== item || slot.count >= MAX_STACK) {
      continue;
    }
    const canTake = Math.min(MAX_STACK - slot.count, remaining);
    slot.count += canTake;
    remaining -= canTake;
    if (remaining === 0) {
      return 0;
    }
  }

  for (let i = 0; i < HOTBAR_SIZE; i += 1) {
    if (inventory.hotbar[i]) {
      continue;
    }
    const add = Math.min(MAX_STACK, remaining);
    inventory.hotbar[i] = { item, count: add };
    remaining -= add;
    if (remaining === 0) {
      return 0;
    }
  }
  return remaining;
}

export function removeItem(inventory: ServerInventory, item: SharedItemId, count: number): boolean {
  if (countItem(inventory, item) < count) {
    return false;
  }
  let remaining = count;
  for (let i = 0; i < HOTBAR_SIZE; i += 1) {
    const slot = inventory.hotbar[i];
    if (!slot || slot.item !== item) {
      continue;
    }
    const used = Math.min(slot.count, remaining);
    slot.count -= used;
    remaining -= used;
    if (slot.count === 0) {
      inventory.hotbar[i] = null;
    }
    if (remaining === 0) {
      return true;
    }
  }
  return true;
}

export function consumeSelected(inventory: ServerInventory, count = 1): boolean {
  const slot = inventory.hotbar[inventory.selectedSlot];
  if (!slot || slot.count < count) {
    return false;
  }
  slot.count -= count;
  if (slot.count <= 0) {
    inventory.hotbar[inventory.selectedSlot] = null;
  }
  return true;
}

export function serializeInventory(inventory: ServerInventory): {
  hotbar: (SharedItemStack | null)[];
  selectedSlot: number;
} {
  return {
    selectedSlot: inventory.selectedSlot,
    hotbar: inventory.hotbar.map((slot) => (slot ? { item: slot.item, count: slot.count } : null))
  };
}
