import { z } from "zod";

export type SharedItemId =
  | "grass_block"
  | "dirt"
  | "stone"
  | "wood"
  | "leaves"
  | "sand"
  | "plank"
  | "stick"
  | "pickaxe";

export interface SharedItemStack {
  item: SharedItemId;
  count: number;
}

export interface NetPlayerState {
  id: string;
  nickname: string;
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
  hotbar: (SharedItemStack | null)[];
  lastProcessedSeq?: number;
}

export interface NetMobState {
  id: number;
  x: number;
  y: number;
  z: number;
  health: number;
}

export interface BlockDelta {
  x: number;
  y: number;
  z: number;
  block: number;
}

const Vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number()
});

const ItemStackSchema = z.object({
  item: z.enum(["grass_block", "dirt", "stone", "wood", "leaves", "sand", "plank", "stick", "pickaxe"]),
  count: z.number().int().nonnegative()
});

const PlayerStateSchema = z.object({
  id: z.string(),
  nickname: z.string(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  vx: z.number(),
  vy: z.number(),
  vz: z.number(),
  yaw: z.number(),
  pitch: z.number(),
  health: z.number(),
  selectedSlot: z.number().int(),
  hotbar: z.array(ItemStackSchema.nullable()),
  lastProcessedSeq: z.number().int().optional()
});

const MobStateSchema = z.object({
  id: z.number().int(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  health: z.number()
});

const BlockDeltaSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int(),
  block: z.number().int()
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    nickname: z.string().min(1).max(24),
    roomCode: z.string().min(1).max(32),
    clientVersion: z.number().int()
  }),
  z.object({
    type: z.literal("input"),
    seq: z.number().int().nonnegative(),
    dt: z.number().positive().max(0.2),
    moveX: z.number().min(-1).max(1),
    moveZ: z.number().min(-1).max(1),
    jump: z.boolean(),
    sprint: z.boolean(),
    yaw: z.number(),
    pitch: z.number()
  }),
  z.object({
    type: z.literal("action_mine"),
    target: Vec3Schema
  }),
  z.object({
    type: z.literal("action_place"),
    target: Vec3Schema,
    normal: Vec3Schema,
    selectedSlot: z.number().int()
  }),
  z.object({
    type: z.literal("action_craft"),
    recipeId: z.string()
  }),
  z.object({
    type: z.literal("action_attack"),
    targetEntityId: z.number().int()
  }),
  z.object({
    type: z.literal("hotbar_select"),
    slot: z.number().int()
  }),
  z.object({
    type: z.literal("ping"),
    clientTime: z.number()
  })
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("welcome"),
    playerId: z.string(),
    serverTick: z.number().int().nonnegative(),
    seed: z.number().int(),
    roomCode: z.string(),
    maxPlayers: z.number().int().positive()
  }),
  z.object({
    type: z.literal("snapshot"),
    tick: z.number().int().nonnegative(),
    players: z.array(PlayerStateSchema),
    mobs: z.array(MobStateSchema),
    changedBlocks: z.array(BlockDeltaSchema)
  }),
  z.object({
    type: z.literal("chunk_data"),
    cx: z.number().int(),
    cz: z.number().int(),
    blocksBase64: z.string()
  }),
  z.object({
    type: z.literal("inventory_update"),
    hotbar: z.array(ItemStackSchema.nullable()),
    selectedSlot: z.number().int()
  }),
  z.object({
    type: z.literal("event"),
    kind: z.string(),
    payload: z.unknown()
  }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string()
  }),
  z.object({
    type: z.literal("pong"),
    clientTime: z.number(),
    serverTime: z.number()
  })
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export function parseClientMessage(raw: string): ClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = ClientMessageSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export function parseServerMessage(raw: string): ServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = ServerMessageSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export function serializeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

