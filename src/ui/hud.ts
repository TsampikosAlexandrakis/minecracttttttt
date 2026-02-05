import { Recipe } from "../game/crafting";
import { Inventory } from "../game/inventory";

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly health: HTMLDivElement;
  private readonly debug: HTMLDivElement;
  private readonly hotbarSlots: HTMLDivElement[] = [];
  private readonly crafting: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "hud-root";

    const crosshair = document.createElement("div");
    crosshair.className = "crosshair";
    crosshair.textContent = "+";
    this.root.appendChild(crosshair);

    this.health = document.createElement("div");
    this.health.className = "health";
    this.root.appendChild(this.health);

    this.debug = document.createElement("div");
    this.debug.className = "debug";
    this.root.appendChild(this.debug);

    const hotbar = document.createElement("div");
    hotbar.className = "hotbar";
    for (let i = 0; i < 9; i += 1) {
      const slot = document.createElement("div");
      slot.className = "slot";
      hotbar.appendChild(slot);
      this.hotbarSlots.push(slot);
    }
    this.root.appendChild(hotbar);

    this.crafting = document.createElement("div");
    this.crafting.className = "crafting hidden";
    this.root.appendChild(this.crafting);

    parent.appendChild(this.root);
  }

  updateHealth(value: number): void {
    this.health.textContent = `Health: ${Math.max(0, Math.floor(value))}`;
  }

  updateDebug(lines: string[]): void {
    this.debug.innerHTML = lines.map((line) => `<div>${line}</div>`).join("");
  }

  updateHotbar(inventory: Inventory): void {
    for (let i = 0; i < this.hotbarSlots.length; i += 1) {
      const slot = this.hotbarSlots[i];
      const stack = inventory.hotbar[i];
      slot.classList.toggle("selected", i === inventory.selectedSlot);
      if (stack) {
        slot.textContent = `${stack.item} x${stack.count}`;
      } else {
        slot.textContent = "";
      }
    }
  }

  setCraftingVisible(visible: boolean): void {
    this.crafting.classList.toggle("hidden", !visible);
  }

  updateCrafting(recipes: Recipe[], inventory: Inventory): void {
    const rows: string[] = [];
    rows.push("<div><b>Crafting (press 1-3)</b></div>");
    for (let i = 0; i < recipes.length; i += 1) {
      const recipe = recipes[i];
      const hasAll = recipe.inputs.every((input) => inventory.count(input.item) >= input.count);
      const status = hasAll ? "ready" : "missing";
      const inputs = recipe.inputs.map((input) => `${input.item}x${input.count}`).join(" + ");
      rows.push(
        `<div class="${status}">${i + 1}. ${recipe.name}: ${inputs} -> ${recipe.output.item}x${recipe.output.count}</div>`
      );
    }
    this.crafting.innerHTML = rows.join("");
  }
}
