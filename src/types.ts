export interface User {
  id: string;
  name: string;
  nameEn: string;
  password: string;
  row: 'right' | 'left'; // right = يمين (masculine), left = شمال (feminine)
  color: string;
  gradient: string;
  nicknames?: string[];
  hebaEnglishOnly?: boolean;
}

export interface Subject {
  id: string;
  name: string;
  nameEn: string;
  color: string;
  glow: string;
  gradFrom: string;
  gradTo: string;
}

export interface Question {
  id: number;
  subjectId: string;
  position?: number;
  question: string;
  answer: string;
}

export interface ContentCard {
  id: string;
  title: string;
  type: 'pdf' | 'image' | 'imageGroup' | 'link';
  url?: string;
  images?: string[];
  fileSizeMB?: number;
}

export type PageName =
  | 'login'
  | 'home'
  | 'subject'
  | 'oneonone'
  | 'solo'
  | 'group'
  | 'stats';

export interface NavProps {
  navigate: (page: PageName, params?: Record<string, string>) => void;
  currentUser: User;
}


