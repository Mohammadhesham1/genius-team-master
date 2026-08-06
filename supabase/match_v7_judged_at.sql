-- ============================================================================
-- 1v1 match room v7 — pause the timer while an attempt is pending judgment
-- ----------------------------------------------------------------------------
-- The client now freezes the countdown the instant someone submits an
-- attempt, and resumes it the instant the referee judges it — computed from
-- (judged_at - answered_at) per attempt, so every device agrees on exactly
-- how much time was "given back". Requires knowing when each attempt was
-- actually judged, not just when it was submitted.
-- ============================================================================

alter table public.match_answers
  add column if not exists judged_at timestamptz;
