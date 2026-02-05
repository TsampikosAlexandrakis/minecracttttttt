import { HOTBAR_SIZE, MAX_STACK } from "../config";
import { ItemId, ItemStack } from "../types";

export class Inventory {
  readonly hotbar: (ItemStack | null)[];
  selectedSlot = 0;

  constructor(initial?: (ItemStack | null)[]) {
    this.hotbar = new Array(HOTBAR_SIZE).fill(null);
    if (initial) {
      for (let i = 0; i < Math.min(initial.length, HOTBAR_SIZE); i += 1) {
        const stack = initial[i];
        this.hotbar[i] = stack ? { item: stack.item, count: stack.count } : null;
      }
    }
  }

  static createStarterInventory(): Inventory {
    return new Inventory([
      { item: "grass_block", count: 32 },
      { item: "dirt", count: 32 },
      { item: "stone", count: 32 },
      { item: "wood", count: 16 },
      { item: "sand", count: 16 },
      null,
      null,
      null,
      null
    ]);
  }

  setSelected(index: number): void {
    const next = ((index % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    this.selectedSlot = next;
  }

  scrollSelected(step: number): void {
    this.setSelected(this.selectedSlot + step);
  }

  getSelectedStack(): ItemStack | null {
    const stack = this.hotbar[this.selectedSlot];
    return stack ? { item: stack.item, count: stack.count } : null;
  }

  add(item: ItemId, count: number): number {
    let remaining = count;
    for (let i = 0; i < HOTBAR_SIZE; i += 1) {
      const slot = this.hotbar[i];
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
      const slot = this.hotbar[i];
      if (slot) {
        continue;
      }
      const added = Math.min(MAX_STACK, remaining);
      this.hotbar[i] = { item, count: added };
      remaining -= added;
      if (remaining === 0) {
        return 0;
      }
    }

    return remaining;
  }

  remove(item: ItemId, count: number): boolean {
    if (this.count(item) < count) {
      return false;
    }
    let remaining = count;
    for (let i = 0; i < HOTBAR_SIZE; i += 1) {
      const slot = this.hotbar[i];
      if (!slot || slot.item !== item) {
        continue;
      }
      const used = Math.min(slot.count, remaining);
      slot.count -= used;
      remaining -= used;
      if (slot.count === 0) {
        this.hotbar[i] = null;
      }
      if (remaining === 0) {
        return true;
      }
    }
    return true;
  }

  consumeSelected(count = 1): boolean {
    const slot = this.hotbar[this.selectedSlot];
    if (!slot || slot.count < count) {
      return false;
    }
    slot.count -= count;
    if (slot.count <= 0) {
      this.hotbar[this.selectedSlot] = null;
    }
    return true;
  }

  count(item: ItemId): number {
    let total = 0;
    for (const slot of this.hotbar) {
      if (slot?.item === item) {
        total += slot.count;
      }
    }
    return total;
  }

  serialize(): (ItemStack | null)[] {
    return this.hotbar.map((slot) => (slot ? { item: slot.item, count: slot.count } : null));
  }
}
