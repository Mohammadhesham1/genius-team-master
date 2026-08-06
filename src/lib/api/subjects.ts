import { supabase } from '../supabaseClient';
import type { Database } from '../database.types';
import type { Subject } from '../../types';

type SubjectRow = Database['public']['Tables']['subjects']['Row'];

function mapSubjectRow(row: SubjectRow): Subject {
  return {
    id: row.id,
    name: row.name,
    nameEn: row.name_en,
    color: row.color,
    glow: row.glow,
    gradFrom: row.grad_from,
    gradTo: row.grad_to,
  };
}

export async function getAllSubjects(): Promise<Subject[]> {
  const { data, error } = await supabase.from('subjects').select('*').order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapSubjectRow);
}

export async function getSubjectById(id: string): Promise<Subject | null> {
  const { data, error } = await supabase.from('subjects').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapSubjectRow(data) : null;
}

/** Subjects a given user is assigned to, in the standard display order. */
export async function getUserSubjects(userId: string): Promise<Subject[]> {
  const { data: links, error: linkErr } = await supabase
    .from('user_subjects')
    .select('subject_id')
    .eq('user_id', userId);
  if (linkErr) throw linkErr;

  const ids = (links ?? []).map((l) => l.subject_id);
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('subjects')
    .select('*')
    .in('id', ids)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapSubjectRow);
}
