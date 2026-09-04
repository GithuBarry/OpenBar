import path from "node:path";
import { z } from "zod";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

export const workspaceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(SAFE_ID, "must start with a letter or number and contain only letters, numbers, dots, underscores, and hyphens");

const absolutePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((value) => path.isAbsolute(value), "must be an absolute path")
  .refine((value) => !CONTROL_CHARACTER.test(value), "must not contain control characters");

const timestampSchema = z.string().datetime({ offset: true });
const credentialProfileIdSchema = workspaceIdSchema.optional();
const optionalTextSchema = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !CONTROL_CHARACTER.test(value), "must not contain control characters");

export const registeredProjectSchema = z
  .object({
    id: workspaceIdSchema,
    checkoutPath: absolutePathSchema,
    credentialProfileId: credentialProfileIdSchema,
    addedAt: timestampSchema,
    lastOpenedAt: timestampSchema.optional(),
  })
  .strict();

export type RegisteredProject = z.infer<typeof registeredProjectSchema>;

export const linkedSkillPackSchema = z
  .object({
    id: workspaceIdSchema,
    checkoutPath: absolutePathSchema,
    credentialProfileId: credentialProfileIdSchema,
    remote: optionalTextSchema(2048).optional(),
    revision: optionalTextSchema(256).optional(),
    addedAt: timestampSchema,
  })
  .strict();

export type LinkedSkillPack = z.infer<typeof linkedSkillPackSchema>;

export const workspaceRegistrySchema = z
  .object({
    schemaVersion: z.literal(1),
    projects: z.array(registeredProjectSchema),
    skillPacks: z.array(linkedSkillPackSchema),
  })
  .strict();

export type WorkspaceRegistryV1 = z.infer<typeof workspaceRegistrySchema>;
