import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJournalStore, dateSchema, entrySchema } from "./journal";
import { sleepInterval } from "./day-summary";

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
test("sleep interval picks completed main sleep, not a nap or another activity", () => {
  const activity=(type:string,start:string,end:string,status="COMPLETE")=>({type:"ACTIVITY",content:{type,status,during:{lower_endpoint:start,upper_endpoint:end}}});
  const home={pillars:[{items:[
    activity("SLEEP","2026-09-12T02:00:00Z","2026-09-12T11:00:00Z"),
    activity("SLEEP","2026-09-12T17:00:00Z","2026-09-12T18:00:00Z"),
    activity("CARDIO","2026-09-11T00:00:00Z","2026-09-12T20:00:00Z"),
    activity("SLEEP","bad","bad"),
  ]}]};
  expect(sleepInterval(home)).toEqual({sleepStart:"2026-09-12T02:00:00Z",sleepEnd:"2026-09-12T11:00:00Z"});
  expect(sleepInterval({})).toEqual({sleepStart:null,sleepEnd:null});
});
