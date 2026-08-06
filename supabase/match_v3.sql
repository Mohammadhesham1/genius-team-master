-- ============================================================================
-- 1v1 match room v3 — written answers
-- ----------------------------------------------------------------------------
-- Run this on the live project after match_v2.sql. Does NOT drop/recreate
-- tables — safe to re-run.
--
-- What this does:
-- Adds match_answers.answer_text so a player's typed answer is stored and
-- shown to the referee (and the other player) alongside their attempt,
-- instead of just a bare "answered" timestamp.
-- ============================================================================

alter table public.match_answers
  add column if not exists answer_text text;
