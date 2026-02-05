export enum BlockId {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Wood = 4,
  Leaves = 5,
  Sand = 6,
  Water = 7
}

export type PlaceableItemId =
  | "grass_block"
  | "dirt"
  | "stone"
  | "wood"
  | "leaves"
  | "sand";

export type ItemId = PlaceableItemId | "plank" | "stick" | "pickaxe";

export interface ItemStack {
  item: ItemId;
  count: number;
}

export interface BlockDefinition {
  id: BlockId;
  name: string;
  solid: boolean;
  hardness: number;
  color: number;
  drop?: ItemId;
}

export interface ChunkCoord {
  cx: number;
  cz: number;
}

export interface PlayerSaveState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  health: number;
  selectedSlot: number;
  hotbar: (ItemStack | null)[];
}

export interface WorldMeta {
  seed: number;
  version: number;
}
