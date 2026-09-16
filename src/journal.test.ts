import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJournalStore, dateSchema, entrySchema } from "./journal";

test("calendar dates reject normalized invalid dates", () => {
  expect(dateSchema.safeParse("2026-02-30").success).toBe(false);
  expect(dateSchema.safeParse("2026-09-12").success).toBe(true);
});
test("concurrent session saves survive reload and edits retain other entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "whoop-journal-test-"));
  try {
    const path = join(dir, "journal.json"), store = createJournalStore(path);
    const a = { id: crypto.randomUUID(), kind: "training", date: "2026-09-12", type: "Pista", status: "Planificado", minutes: null, rpe: null, notes: "" };
    const b = { ...a, id: crypto.randomUUID(), type: "Fuerza" };
    await Promise.all([store.upsert(a), store.upsert(b)]);
    await store.upsert({ ...a, status: "Realizado", minutes: 60, rpe: 8 });
    const saved = await createJournalStore(path).read();
    expect(saved.entries).toHaveLength(2);
    expect(saved.entries.find(e=>e.id===a.id)).toMatchObject({ status:"Realizado", minutes:60 });
  } finally { await rm(dir, { recursive:true, force:true }); }
});
test("wind zero, unknown wind and null attempts remain distinct", () => {
  const result=entrySchema.parse({id:crypto.randomUUID(),kind:"competition",date:"2026-08-22",discipline:"Largo",title:"Meet",notes:"",bestOnly:false,attempts:[{distance:6.43,wind:0},{distance:null,wind:null}]});
  expect(result.kind === "competition" && result.attempts).toEqual([{distance:6.43,wind:0},{distance:null,wind:null}]);
});
