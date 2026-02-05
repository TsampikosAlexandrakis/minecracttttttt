import { SharedItemId } from "../src/shared/protocol";
import { countItem, removeItem, addItem, ServerInventory } from "./inventory";

interface Recipe {
  id: string;
  inputs: Array<{ item: SharedItemId; count: number }>;
  output: { item: SharedItemId; count: number };
}

const RECIPES: Recipe[] = [
  {
    id: "planks",
    inputs: [{ item: "wood", count: 1 }],
    output: { item: "plank", count: 4 }
  },
  {
    id: "sticks",
    inputs: [{ item: "plank", count: 2 }],
    output: { item: "stick", count: 4 }
  },
  {
    id: "pickaxe",
    inputs: [
      { item: "plank", count: 3 },
      { item: "stick", count: 2 }
    ],
    output: { item: "pickaxe", count: 1 }
  }
];

export function craftRecipe(inventory: ServerInventory, recipeId: string): boolean {
  const recipe = RECIPES.find((candidate) => candidate.id === recipeId);
  if (!recipe) {
    return false;
  }
  for (const input of recipe.inputs) {
    if (countItem(inventory, input.item) < input.count) {
      return false;
    }
  }
  for (const input of recipe.inputs) {
    removeItem(inventory, input.item, input.count);
  }
  addItem(inventory, recipe.output.item, recipe.output.count);
  return true;
}
