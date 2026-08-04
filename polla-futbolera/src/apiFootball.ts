const BASE_URL = "https://v3.football.api-sports.io";

function getConfig() {
  return {
    apiKey: process.env.API_FOOTBALL_KEY || "",
    leagueId: process.env.API_FOOTBALL_LEAGUE_ID || "",
    season: process.env.API_FOOTBALL_SEASON || "",
  };
}

export function isApiFootballConfigured(): boolean {
  const { apiKey, leagueId, season } = getConfig();
  return Boolean(apiKey && leagueId && season);
}

interface ApiFootballResponse {
  response: any[];
}

async function apiFootballGet(path: string, params: Record<string, string>): Promise<ApiFootballResponse> {
  const { apiKey } = getConfig();
  if (!apiKey) {
    throw new Error("Falta API_FOOTBALL_KEY en las variables de entorno");
  }

  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: { "x-apisports-key": apiKey },
  });

  if (!res.ok) {
    throw new Error(`API-Football respondió ${res.status}`);
  }
  return (await res.json()) as ApiFootballResponse;
}

export interface FixtureSummary {
  fixture_id: number;
  date: string;
  status_short: string;
  home_team: string;
  away_team: string;
  home_goals: number | null;
  away_goals: number | null;
}

function mapFixture(f: any): FixtureSummary {
  return {
    fixture_id: f.fixture.id,
    date: f.fixture.date,
    status_short: f.fixture.status.short,
    home_team: f.teams.home.name,
    away_team: f.teams.away.name,
    home_goals: f.goals.home,
    away_goals: f.goals.away,
  };
}

/**
 * Busca los partidos de la liga/temporada configurada en una fecha puntual
 * (YYYY-MM-DD), para que el administrador elija el fixture_id correcto sin
 * tener que adivinarlo.
 */
export async function searchFixturesByDate(date: string): Promise<FixtureSummary[]> {
  const { leagueId, season } = getConfig();
  if (!leagueId || !season) {
    throw new Error("Falta API_FOOTBALL_LEAGUE_ID o API_FOOTBALL_SEASON en las variables de entorno");
  }
  const data = await apiFootballGet("/fixtures", { league: leagueId, season, date });
  return (data.response || []).map(mapFixture);
}

/** Trae el estado actual (en vivo o finalizado) de un fixture ya vinculado. */
export async function getFixtureById(fixtureId: number): Promise<FixtureSummary | null> {
  const data = await apiFootballGet("/fixtures", { id: String(fixtureId) });
  const f = (data.response || [])[0];
  return f ? mapFixture(f) : null;
}
