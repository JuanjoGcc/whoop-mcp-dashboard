import type { WhoopClient } from "./whoop-client";

export interface DaySummary {
  date: string;
  recovery: number | null;
  hrv: number | null;
  hrvBaseline: number | null;
  rhr: number | null;
  rhrBaseline: number | null;
  respRate: number | null;
  sleepPerformance: number | null;
  sleepConsistency: number | null;
  sleepEfficiency: number | null;
  sleepHours: number | null;
  strain: number | null;
  strainPct: number | null;
  calories: number | null;
}

const CACHE_PATH = ".cache/day-summaries.json";

function num(s: unknown): number | null {
  if (typeof s !== "string" && typeof s !== "number") return null;
  const n = parseFloat(String(s).replace(/[%,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function findTile(data: any, type: string): any {
  const section = data?.sections?.find((s: any) =>
    s.items?.some((i: any) => i.type === type)
  );
  return section?.items.find((i: any) => i.type === type)?.content;
}

function contributor(tile: any, id: string): any {
  return tile?.metrics?.find((m: any) => m.id === id);
}

async function fetchDay(client: WhoopClient, date: string): Promise<DaySummary> {
  const summary: DaySummary = {
    date,
    recovery: null,
    hrv: null,
    hrvBaseline: null,
    rhr: null,
    rhrBaseline: null,
    respRate: null,
    sleepPerformance: null,
    sleepConsistency: null,
    sleepEfficiency: null,
    sleepHours: null,
    strain: null,
    strainPct: null,
    calories: null,
  };

  // Each source fails independently — a day without data just keeps nulls
  const [recovery, sleep, strain, home] = await Promise.allSettled([
    client.getRecoveryDeepDive(date),
    client.getSleepDeepDive(date),
    client.getStrainDeepDive(date),
    client.getHomeData(date),
  ]);

  if (recovery.status === "fulfilled") {
    const gauge = findTile(recovery.value, "SCORE_GAUGE");
    summary.recovery = num(gauge?.score_display);
    const tile = findTile(recovery.value, "CONTRIBUTORS_TILE");
    summary.hrv = num(contributor(tile, "CONTRIBUTORS_TILE_HRV")?.status);
    summary.hrvBaseline = num(contributor(tile, "CONTRIBUTORS_TILE_HRV")?.status_subtitle);
    summary.rhr = num(contributor(tile, "CONTRIBUTORS_TILE_RHR")?.status);
    summary.rhrBaseline = num(contributor(tile, "CONTRIBUTORS_TILE_RHR")?.status_subtitle);
    summary.respRate = num(contributor(tile, "CONTRIBUTORS_TILE_RESPIRATORY_RATE")?.status);
  }

  if (sleep.status === "fulfilled") {
    const gauge = findTile(sleep.value, "SCORE_GAUGE");
    if (gauge?.gauge_fill_percentage != null) {
      summary.sleepPerformance = Math.round(gauge.gauge_fill_percentage * 100);
    }
    const tile = findTile(sleep.value, "CONTRIBUTORS_TILE");
    summary.sleepConsistency = num(contributor(tile, "CONTRIBUTORS_TILE_SLEEP_CONSISTENCY")?.status);
    summary.sleepEfficiency = num(contributor(tile, "CONTRIBUTORS_TILE_IN_SLEEP_EFFICIENCY")?.status);
  }

  if (strain.status === "fulfilled") {
    const gauge = findTile(strain.value, "SCORE_GAUGE");
    summary.strain = num(gauge?.score_display);
    if (gauge?.gauge_fill_percentage != null) {
      summary.strainPct = Math.round(gauge.gauge_fill_percentage * 100);
    }
  }

  if (home.status === "fulfilled") {
    const live = home.value?.metadata?.whoop_live_metadata;
    if (live?.ms_of_sleep) summary.sleepHours = +(live.ms_of_sleep / 3_600_000).toFixed(2);
    if (live?.calories) summary.calories = Math.round(live.calories);
  }

  return summary;
}

/**
 * Fetch summaries for a list of dates, reading/writing a disk cache.
 * Past days are immutable so they cache forever; today is always refetched.
 */
export async function getDaySummaries(
  client: WhoopClient,
  dates: string[]
): Promise<DaySummary[]> {
  const cacheFile = Bun.file(CACHE_PATH);
  let cache: Record<string, DaySummary> = {};
  if (await cacheFile.exists()) {
    try {
      cache = await cacheFile.json();
    } catch {
      cache = {};
    }
  }

  const today = new Date().toLocaleDateString("en-CA");
  const missing = dates.filter((d) => !(d in cache) || d === today);

  // ponytail: fixed pool of 5, enough to stay under Whoop's radar
  const POOL = 5;
  for (let i = 0; i < missing.length; i += POOL) {
    const batch = missing.slice(i, i + POOL);
    const results = await Promise.all(batch.map((d) => fetchDay(client, d)));
    for (const r of results) cache[r.date] = r;
  }

  if (missing.length > 0) {
    await Bun.write(CACHE_PATH, JSON.stringify(cache));
  }

  return dates.map((d) => cache[d]).filter((d): d is DaySummary => Boolean(d));
}

function hasData(d: DaySummary): boolean {
  return d.recovery != null || d.sleepHours != null || d.strain != null;
}

/**
 * All-time: walk backwards in 30-day chunks until a whole chunk has no data,
 * then trim leading empty days. Empty days stay cached so this probes once.
 */
export async function getAllTimeSummaries(client: WhoopClient): Promise<DaySummary[]> {
  const CHUNK = 30;
  const all: DaySummary[] = [];
  for (let offset = 0; offset < 3650; offset += CHUNK) {
    const dates: string[] = [];
    for (let i = 0; i < CHUNK; i++) {
      const d = new Date();
      d.setDate(d.getDate() - offset - i);
      dates.unshift(d.toLocaleDateString("en-CA"));
    }
    const chunk = await getDaySummaries(client, dates);
    all.unshift(...chunk);
    if (!chunk.some(hasData)) break;
  }
  const first = all.findIndex(hasData);
  return first === -1 ? [] : all.slice(first);
}
