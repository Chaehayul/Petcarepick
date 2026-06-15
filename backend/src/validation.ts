import { z } from "zod";

export const signupSchema = z.object({
  name: z.string().trim().min(2).max(30),
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(72),
});

export const loginSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(72),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(40),
});

export const petSchema = z.object({
  name: z.string().trim().min(1).max(30),
  type: z.string().trim().min(1).max(30),
  breed: z.string().trim().min(1).max(50),
  age: z.coerce.number().int().min(0).max(100),
  weight: z.coerce.number().positive().max(500),
  gender: z.string().trim().max(20).optional().nullable(),
  neutered: z.string().trim().max(30).optional().nullable(),
  conditions: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  allergies: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  routines: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  reminders: z.record(z.string(), z.boolean()).optional().nullable(),
});

export const petPatchSchema = petSchema.partial();

export const recordSchema = z.object({
  date: z.iso.date(),
  category: z.enum(["meal", "activity", "stool", "behavior", "weight"]),
  value: z.coerce.number().finite(),
  detail: z.string().trim().max(500).optional().nullable(),
});

export const recordPatchSchema = recordSchema.partial();

export const eventSchema = z.object({
  type: z.string().trim().min(1).max(30),
  title: z.string().trim().min(1).max(50),
  date: z.iso.date(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().nullable().or(z.literal("")),
  memo: z.string().trim().max(120).optional().nullable(),
  completed: z.boolean().default(false),
});

export const eventPatchSchema = eventSchema.partial();

export const feedbackSchema = z.object({
  productId: z.string().trim().min(1).max(100),
  value: z.enum(["잘 먹어요", "잘 안 먹어요"]),
});

export const chatSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  pet: z.object({
    id: z.string().optional(),
    name: z.string().min(1),
  }).passthrough(),
  recentRecords: z.array(z.unknown()).max(100).default([]),
  conversation: z.array(z.unknown()).max(20).default([]),
  sessionId: z.string().uuid().optional(),
});
