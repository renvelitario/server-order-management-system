import type { User } from '@supabase/supabase-js';

export interface LocalUser {
  user_id: number;
  email: string;
  username: string;
  name: string;
  acc_type: 'Admin' | 'User' | string;
  status: 'Active' | 'Disabled' | 'Suspended' | string;
  inactivity_timeout_minutes: number;
  session_timeout_enabled: boolean;
  supabase_id: string;
}

export type AuthUser = User;
