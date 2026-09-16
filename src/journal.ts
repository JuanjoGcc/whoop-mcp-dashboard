import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(v + "T12:00:00Z");
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === v;
});
const attempt = z.object({ distance: z.number().positive().max(25).nullable(), wind: z.number().min(-20).max(20).nullable() });
export const entrySchema = z.discriminatedUnion("kind", [
  z.object({ id: z.string().uuid(), kind: z.literal("competition"), date: dateSchema,
    discipline: z.enum(["Largo", "Triple"]), title: z.string().trim().min(1).max(120),
    attempts: z.array(attempt).min(1).max(6), bestOnly: z.boolean(), notes: z.string().max(3000) }),
  z.object({ id: z.string().uuid(), kind: z.literal("training"), date: dateSchema,
    type: z.enum(["Pista", "Fuerza", "Técnica", "Movilidad", "Descanso"]),
    status: z.enum(["Planificado", "Realizado"]), minutes: z.number().int().min(0).max(600).nullable(),
    rpe: z.number().int().min(1).max(10).nullable(), notes: z.string().max(3000) }),
]);
export const journalSchema = z.object({ entries: z.array(entrySchema).max(10000) });
export type Journal = z.infer<typeof journalSchema>;

// Personal records live outside git; concurrent tabs must not clobber each other.
export function createJournalStore(path = "data/journal.json") {
  let queue: Promise<unknown> = Promise.resolve();
  async function read(): Promise<Journal> {
    try { return journalSchema.parse(JSON.parse(await readFile(path, "utf8"))); }
    catch (error: any) { if (error.code === "ENOENT") return { entries: [] }; throw error; }
  }
  function upsert(input: unknown) {
    const entry = entrySchema.parse(input);
    const operation = queue.then(async () => {
      const journal = await read();
      const index = journal.entries.findIndex(e => e.id === entry.id);
      if (index < 0) journal.entries.push(entry); else journal.entries[index] = entry;
      journalSchema.parse(journal);
      await mkdir(dirname(path), { recursive: true });
      const tmp = path + ".tmp";
      await writeFile(tmp, JSON.stringify(journal, null, 2), { mode: 0o600 });
      await rename(tmp, path);
      return journal;
    });
    queue = operation.catch(() => {});
    return operation;
  }
  return { read, upsert };
}
