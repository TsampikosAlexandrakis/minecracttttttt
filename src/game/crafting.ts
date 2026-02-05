import { ItemId } from "../types";
import { Inventory } from "./inventory";

interface RecipeInput {
  item: ItemId;
  count: number;
}

interface RecipeOutput {
  item: ItemId;
  count: number;
}

export interface Recipe {
  id: string;
  name: string;
  inputs: RecipeInput[];
  output: RecipeOutput;
}

export const RECIPES: Recipe[] = [
  {
    id: "planks",
    name: "Planks",
    inputs: [{ item: "wood", count: 1 }],
    output: { item: "plank", count: 4 }
  },
  {
    id: "sticks",
    name: "Sticks",
    inputs: [{ item: "plank", count: 2 }],
    output: { item: "stick", count: 4 }
  },
  {
    id: "pickaxe",
    name: "Pickaxe",
    inputs: [
      { item: "plank", count: 3 },
      { item: "stick", count: 2 }
    ],
    output: { item: "pickaxe", count: 1 }
  }
];

export function canCraft(inventory: Inventory, recipe: Recipe): boolean {
  return recipe.inputs.every((input) => inventory.count(input.item) >= input.count);
}

export function craft(inventory: Inventory, recipe: Recipe): boolean {
  if (!canCraft(inventory, recipe)) {
    return false;
  }
  for (const input of recipe.inputs) {
    inventory.remove(input.item, input.count);
  }
  inventory.add(recipe.output.item, recipe.output.count);
  return true;
}
