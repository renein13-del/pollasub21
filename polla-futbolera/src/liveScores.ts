import { query } from "./db";
import { getFixtureById, isApiFootballConfigured } from "./apiFootball";
import { settleMatch } from "./matchEngine";

// Códigos de estado de API-Football que indican que el partido terminó
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);

function computeResult(homeGoals: number, awayGoals: number): "LOCAL" | "EMPATE" | "VISITA" {
  if (homeGoals > awayGoals) return "LOCAL";
  if (homeGoals < awayGoals) return "VISITA";
  return "EMPATE";
}

/**
 * Revisa todos los partidos SCHEDULED que tengan un fixture de API-Football
 * vinculado: actualiza el marcador en vivo, y si ya terminó (FT/AET/PEN),
 * dispara el Match Engine automáticamente con el resultado real.
 */
export async function syncLiveScores(): Promise<{ checked: number; settled: number }> {
  if (!isApiFootballConfigured()) {
    return { checked: 0, settled: 0 };
  }

  const matches = await query<{ id: number; api_fixture_id: number }>(
    "SELECT id, api_fixture_id FROM matches WHERE api_fixture_id IS NOT NULL AND status = 'SCHEDULED'"
  );

  let settled = 0;

  for (const m of matches) {
    try {
      const fixture = await getFixtureById(m.api_fixture_id);
      if (!fixture) continue;

      await query(
        "UPDATE matches SET live_home_score = $1, live_away_score = $2, live_status = $3 WHERE id = $4",
        [fixture.home_goals, fixture.away_goals, fixture.status_short, m.id]
      );

      const finished =
        FINISHED_STATUSES.has(fixture.status_short) &&
        fixture.home_goals !== null &&
        fixture.away_goals !== null;

      if (finished) {
        const result = computeResult(fixture.home_goals as number, fixture.away_goals as number);
        await settleMatch(m.id, result);
        settled += 1;
      }
    } catch (err) {
      console.error(`Error sincronizando el partido ${m.id} (fixture ${m.api_fixture_id}):`, err);
    }
  }

  return { checked: matches.length, settled };
}
