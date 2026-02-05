import { BlockDefinition, BlockId, ItemId, PlaceableItemId } from "./types";

export const BLOCK_DEFS: Record<BlockId, BlockDefinition> = {
  [BlockId.Air]: {
    id: BlockId.Air,
    name: "Air",
    solid: false,
    hardness: 0,
    color: 0x000000
  },
  [BlockId.Grass]: {
    id: BlockId.Grass,
    name: "Grass",
    solid: true,
    hardness: 1.2,
    color: 0x4a9a3c,
    drop: "grass_block"
  },
  [BlockId.Dirt]: {
    id: BlockId.Dirt,
    name: "Dirt",
    solid: true,
    hardness: 1.0,
    color: 0x8f5f3b,
    drop: "dirt"
  },
  [BlockId.Stone]: {
    id: BlockId.Stone,
    name: "Stone",
    solid: true,
    hardness: 2.2,
    color: 0x7f7f88,
    drop: "stone"
  },
  [BlockId.Wood]: {
    id: BlockId.Wood,
    name: "Wood",
    solid: true,
    hardness: 1.6,
    color: 0x8f6a2f,
    drop: "wood"
  },
  [BlockId.Leaves]: {
    id: BlockId.Leaves,
    name: "Leaves",
    solid: true,
    hardness: 0.4,
    color: 0x2d7b3f,
    drop: "leaves"
  },
  [BlockId.Sand]: {
    id: BlockId.Sand,
    name: "Sand",
    solid: true,
    hardness: 0.9,
    color: 0xd5c387,
    drop: "sand"
  },
  [BlockId.Water]: {
    id: BlockId.Water,
    name: "Water",
    solid: false,
    hardness: 0,
    color: 0x3a72b7
  }
};

const ITEM_TO_BLOCK: Record<PlaceableItemId, BlockId> = {
  grass_block: BlockId.Grass,
  dirt: BlockId.Dirt,
  stone: BlockId.Stone,
  wood: BlockId.Wood,
  leaves: BlockId.Leaves,
  sand: BlockId.Sand
};

export function itemToBlockId(item: ItemId): BlockId | null {
  if (item in ITEM_TO_BLOCK) {
    return ITEM_TO_BLOCK[item as PlaceableItemId];
  }
  return null;
}

export function blockIdToDrop(blockId: BlockId): ItemId | null {
  return BLOCK_DEFS[blockId].drop ?? null;
}

export function isSolidBlock(blockId: BlockId): boolean {
  return BLOCK_DEFS[blockId].solid;
}
