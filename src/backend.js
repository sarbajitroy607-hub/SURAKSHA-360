import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const backendConfigured = Boolean(supabaseUrl && supabaseKey);
let supabase = null;

export async function initializeBackend() {
  if (!backendConfigured) return { configured: false, user: null };
  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error && error.name !== 'AuthSessionMissingError') throw error;
  return { configured: true, user: user ?? null };
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return { user: data.user, session: data.session };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    const user = session?.user ?? null;
    setTimeout(() => callback(user), 0);
  });
}

export async function loadUserData() {
  if (!supabase) return null;
  const { data, error } = await supabase.from('user_data').select('data').maybeSingle();
  if (error) throw error;
  return data?.data ?? null;
}

export async function saveUserData(data) {
  if (!supabase) return;
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error('Sign in to sync your data.');
  const { error } = await supabase.from('user_data').upsert({
    user_id: user.id,
    data,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw error;
}
