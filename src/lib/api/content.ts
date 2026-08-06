import { supabase } from '../supabaseClient';
import type { Database } from '../database.types';
import type { ContentCard } from '../../types';

type ContentCardRow = Database['public']['Tables']['content_cards']['Row'];

function mapContentCardRow(row: ContentCardRow): ContentCard {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    url: row.url ?? undefined,
    images: row.images ?? undefined,
    fileSizeMB: row.file_size_mb ?? undefined,
  };
}

export async function getContentCards(subjectId: string): Promise<ContentCard[]> {
  const { data, error } = await supabase
    .from('content_cards')
    .select('*')
    .eq('subject_id', subjectId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapContentCardRow);
}
