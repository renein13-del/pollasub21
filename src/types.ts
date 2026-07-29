export type Pick1X2 = "LOCAL" | "EMPATE" | "VISITA";
export type MatchStatus = "SCHEDULED" | "FINISHED";

export interface User {
  id: number;
  first_name: string;
  last_name: string;
  nickname: string;
  total_points: number;
  created_at: string;
}

export interface Match {
  id: number;
  local_team: string;
  away_team: string;
  matchday: number | null;
  kickoff_at: string | null;
  status: MatchStatus;
  result: Pick1X2 | null;
  created_at: string;
}

export interface Prediction {
  id: number;
  user_id: number;
  match_id: number;
  user_pick: Pick1X2;
  points_earned: number | null;
  created_at: string;
}

export interface LeaderboardRow {
  user_id: number;
  first_name: string;
  last_name: string;
  nickname: string;
  total_points: number;
  aciertos: number;
  pronosticos_totales: number;
}
