// ============================================================================
// Supabase database types — hand-written to mirror the SQL schema exactly.
//
// If you ever change the schema, regenerate this properly with:
//   npx supabase gen types typescript --project-id rtfivjmqlpbqlqdxpgzh > src/lib/database.types.ts
// (requires the Supabase CLI logged in). Until then, keep this file in sync
// by hand with any migration you run.
// ============================================================================

export type RowSide = 'right' | 'left';
export type ContentType = 'pdf' | 'image' | 'imageGroup' | 'link';
export type MatchStatus = 'lobby' | 'active' | 'completed' | 'cancelled';
export type InviteStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';
export type MatchPlayerRole = 'player' | 'referee';
export type MatchResult = 'win' | 'loss' | 'draw';
export type GroupSessionStatus = 'active' | 'completed';
export type PointsMode = 'solo' | 'group' | 'oneVone';

/** One judged attempt on a group_progress question — mirrors the reference app's local state shape. */
export interface GroupAttempt {
  n: number;           // attempt number (1 or 2)
  time_s: number;      // seconds elapsed
  player_id: string;   // users.id credited for this attempt
  result: 'correct' | 'wrong';
}

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          name: string;
          name_en: string;
          password: string;
          row_side: RowSide;
          color: string;
          gradient: string;
          nicknames: string[];
          heba_english_only: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          name: string;
          name_en: string;
          password: string;
          row_side: RowSide;
          color: string;
          gradient: string;
          nicknames?: string[];
          heba_english_only?: boolean;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['users']['Insert']>;
      };
      subjects: {
        Row: {
          id: string;
          name: string;
          name_en: string;
          color: string;
          glow: string;
          grad_from: string;
          grad_to: string;
          sort_order: number;
        };
        Insert: {
          id: string;
          name: string;
          name_en: string;
          color: string;
          glow: string;
          grad_from: string;
          grad_to: string;
          sort_order?: number;
        };
        Update: Partial<Database['public']['Tables']['subjects']['Insert']>;
      };
      user_subjects: {
        Row: { user_id: string; subject_id: string };
        Insert: { user_id: string; subject_id: string };
        Update: Partial<Database['public']['Tables']['user_subjects']['Insert']>;
      };
      device_sessions: {
        Row: {
          id: string;
          user_id: string | null;
          device_id: string;
          auth_uid: string | null;
          logged_in_at: string;
          last_seen_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          device_id: string;
          auth_uid?: string | null;
          logged_in_at?: string;
          last_seen_at?: string;
        };
        Update: Partial<Database['public']['Tables']['device_sessions']['Insert']>;
      };
      content_cards: {
        Row: {
          id: string;
          subject_id: string | null;
          title: string;
          type: ContentType;
          url: string | null;
          images: string[] | null;
          file_size_mb: number | null;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          subject_id?: string | null;
          title: string;
          type: ContentType;
          url?: string | null;
          images?: string[] | null;
          file_size_mb?: number | null;
          sort_order?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['content_cards']['Insert']>;
      };
      questions: {
        Row: {
          id: number;
          subject_id: string | null;
          position: number | null;
          question: string;
          answer: string;
        };
        Insert: {
          id?: number;
          subject_id?: string | null;
          position?: number | null;
          question: string;
          answer: string;
        };
        Update: Partial<Database['public']['Tables']['questions']['Insert']>;
      };
      group_round_questions: {
        Row: {
          id: number;
          subject_id: string | null;
          round_no: number;
          position: number | null;
          question: string;
          answer: string;
        };
        Insert: {
          id?: number;
          subject_id?: string | null;
          round_no: number;
          position?: number | null;
          question: string;
          answer: string;
        };
        Update: Partial<Database['public']['Tables']['group_round_questions']['Insert']>;
      };
      group_progress: {
        Row: {
          round_no: number;
          position: number;
          attempts: GroupAttempt[];
          final: 'correct' | 'wrong' | null;
          updated_at: string;
        };
        Insert: {
          round_no: number;
          position: number;
          attempts?: GroupAttempt[];
          final?: 'correct' | 'wrong' | null;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['group_progress']['Insert']>;
      };
      solo_progress: {
        Row: { user_id: string; subject_id: string; next_position: number };
        Insert: { user_id: string; subject_id: string; next_position?: number };
        Update: Partial<Database['public']['Tables']['solo_progress']['Insert']>;
      };
      solo_answers: {
        Row: {
          id: number;
          user_id: string | null;
          subject_id: string | null;
          question_id: number | null;
          first_answer: string | null;
          first_time_ms: number | null;
          second_answer: string | null;
          second_time_ms: number | null;
          is_correct: boolean | null;
          correct_on: number | null;
          is_review: boolean;
          answered_at: string;
        };
        Insert: {
          id?: number;
          user_id?: string | null;
          subject_id?: string | null;
          question_id?: number | null;
          first_answer?: string | null;
          first_time_ms?: number | null;
          second_answer?: string | null;
          second_time_ms?: number | null;
          is_correct?: boolean | null;
          correct_on?: number | null;
          is_review?: boolean;
          answered_at?: string;
        };
        Update: Partial<Database['public']['Tables']['solo_answers']['Insert']>;
      };
      match_bank_cursor: {
        Row: { subject_id: string; last_used_position: number | null };
        Insert: { subject_id: string; last_used_position?: number | null };
        Update: Partial<Database['public']['Tables']['match_bank_cursor']['Insert']>;
      };
      matches: {
        Row: {
          id: string;
          subject_id: string | null;
          creator_id: string | null;
          referee_id: string | null;
          status: MatchStatus;
          current_qidx: number;
          question_started_at: string | null;
          created_at: string;
          started_at: string | null;
          ended_at: string | null;
        };
        Insert: {
          id?: string;
          subject_id?: string | null;
          creator_id?: string | null;
          referee_id?: string | null;
          status?: MatchStatus;
          current_qidx?: number;
          question_started_at?: string | null;
          created_at?: string;
          started_at?: string | null;
          ended_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['matches']['Insert']>;
      };
      match_invites: {
        Row: {
          id: string;
          match_id: string | null;
          to_user_id: string | null;
          is_ref: boolean;
          status: InviteStatus;
          created_at: string;
          responded_at: string | null;
        };
        Insert: {
          id?: string;
          match_id?: string | null;
          to_user_id?: string | null;
          is_ref?: boolean;
          status?: InviteStatus;
          created_at?: string;
          responded_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['match_invites']['Insert']>;
      };
      match_questions: {
        Row: { match_id: string; position: number; question_id: number | null };
        Insert: { match_id: string; position: number; question_id?: number | null };
        Update: Partial<Database['public']['Tables']['match_questions']['Insert']>;
      };
      match_answers: {
        Row: {
          id: number;
          match_id: string | null;
          position: number;
          answering_user_id: string | null;
          attempt_no: number;
          time_ms: number | null;
          answer_text: string | null;
          judged_correct: boolean | null;
          judged_by: string | null;
          judged_at: string | null;
          answered_at: string;
        };
        Insert: {
          id?: number;
          match_id?: string | null;
          position: number;
          answering_user_id?: string | null;
          attempt_no?: number;
          time_ms?: number | null;
          answer_text?: string | null;
          judged_correct?: boolean | null;
          judged_by?: string | null;
          judged_at?: string | null;
          answered_at?: string;
        };
        Update: Partial<Database['public']['Tables']['match_answers']['Insert']>;
      };
      match_players: {
        Row: {
          match_id: string;
          user_id: string;
          role: MatchPlayerRole;
          correct_count: number;
          wrong_count: number;
          result: MatchResult | null;
        };
        Insert: {
          match_id: string;
          user_id: string;
          role: MatchPlayerRole;
          correct_count?: number;
          wrong_count?: number;
          result?: MatchResult | null;
        };
        Update: Partial<Database['public']['Tables']['match_players']['Insert']>;
      };
      group_sessions: {
        Row: {
          id: string;
          subject_id: string | null;
          round_no: number;
          host_user_id: string | null;
          status: GroupSessionStatus;
          current_qidx: number;
          started_at: string;
          ended_at: string | null;
        };
        Insert: {
          id?: string;
          subject_id?: string | null;
          round_no: number;
          host_user_id?: string | null;
          status?: GroupSessionStatus;
          current_qidx?: number;
          started_at?: string;
          ended_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['group_sessions']['Insert']>;
      };
      group_answers: {
        Row: {
          id: number;
          session_id: string | null;
          position: number;
          attempt_no: number;
          time_ms: number;
          is_correct: boolean;
          credited_user_id: string | null;
          answered_at: string;
        };
        Insert: {
          id?: number;
          session_id?: string | null;
          position: number;
          attempt_no?: number;
          time_ms: number;
          is_correct: boolean;
          credited_user_id?: string | null;
          answered_at?: string;
        };
        Update: Partial<Database['public']['Tables']['group_answers']['Insert']>;
      };
      user_points: {
        Row: { user_id: string; total_points: number; updated_at: string };
        Insert: { user_id: string; total_points?: number; updated_at?: string };
        Update: Partial<Database['public']['Tables']['user_points']['Insert']>;
      };
      points_ledger: {
        Row: { id: number; user_id: string | null; mode: PointsMode; points: number; created_at: string };
        Insert: { id?: number; user_id?: string | null; mode: PointsMode; points: number; created_at?: string };
        Update: Partial<Database['public']['Tables']['points_ledger']['Insert']>;
      };
      user_streaks: {
        Row: {
          user_id: string;
          current_multiplier: number;
          last_solo_date: string | null;
          today_solo_count: number;
        };
        Insert: {
          user_id: string;
          current_multiplier?: number;
          last_solo_date?: string | null;
          today_solo_count?: number;
        };
        Update: Partial<Database['public']['Tables']['user_streaks']['Insert']>;
      };
    };
    Views: {
      v_group_radar: {
        Row: { user_id: string | null; subject_id: string | null; correct_count: number | null };
      };
      v_group_speed: {
        Row: {
          user_id: string | null;
          avg_correct_ms: number | null;
          avg_wrong_ms: number | null;
          avg_overall_ms: number | null;
        };
      };
      v_solo_progress: {
        Row: {
          user_id: string | null;
          done_count: number | null;
          correct_count: number | null;
          accuracy_pct: number | null;
        };
      };
      v_solo_leaderboard: {
        Row: { user_id: string | null; questions_done: number | null };
      };
      v_leaderboard: {
        Row: { user_id: string | null; name: string | null; name_en: string | null; total_points: number | null };
      };
      v_rivalries: {
        Row: {
          user_a: string | null;
          user_b: string | null;
          matches_played: number | null;
          points_a: number | null;
          points_b: number | null;
          wins_a: number | null;
          wins_b: number | null;
        };
      };
      v_points_breakdown: {
        Row: {
          user_id: string | null;
          solo_points: number | null;
          group_points: number | null;
          onevone_points: number | null;
          total_points: number | null;
        };
      };
      v_user_detail: {
        Row: {
          user_id: string;
          name: string;
          name_en: string;
          total_points: number;
          solo_points: number;
          group_points: number;
          onevone_points: number;
          leaderboard_rank: number | null;
          solo_answered: number;
          solo_correct: number;
          avg_solo_ms: number | null;
          group_answered: number;
          group_correct: number;
          avg_group_correct_ms: number | null;
          avg_group_wrong_ms: number | null;
          avg_group_overall_ms: number | null;
          onevone_answered: number;
          onevone_correct: number;
          avg_onevone_ms: number | null;
          matches_played: number;
          match_wins: number;
        };
      };
    };
    Functions: {
      fn_start_match_questions: {
        Args: { p_match_id: string; p_subject_id: string };
        Returns: void;
      };
      fn_award_points: {
        Args: { p_user_id: string; p_points: number; p_mode: PointsMode };
        Returns: void;
      };
    };
  };
}
