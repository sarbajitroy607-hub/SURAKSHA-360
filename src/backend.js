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

export async function loadTrustedContacts() {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.from('trusted_contacts')
    .select('id, owner_id, contact_user_id, contact_email, display_name, status, invitation_code, created_at, expires_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createTrustedContactInvite(email, displayName) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('create_trusted_contact_invite', {
    p_contact_email: email,
    p_display_name: displayName,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function acceptTrustedContactInvite(invitationCode) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('accept_trusted_contact_invite', {
    p_invitation_code: invitationCode,
  });
  if (error) throw error;
  return data;
}

export async function revokeTrustedContact(contactId) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.rpc('revoke_trusted_contact', { p_contact_id: contactId });
  if (error) throw error;
}

export async function startSafetyJourney(journey, contactIds, durationMinutes = 60) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('start_safety_journey', {
    p_owner_label: journey.ownerLabel,
    p_origin_latitude: journey.origin.latitude,
    p_origin_longitude: journey.origin.longitude,
    p_destination_label: journey.destination.label,
    p_destination_latitude: journey.destination.latitude,
    p_destination_longitude: journey.destination.longitude,
    p_distance_meters: journey.distanceMeters,
    p_duration_seconds: journey.durationSeconds,
    p_contact_ids: contactIds,
    p_duration_minutes: durationMinutes,
  });
  if (error) throw error;
  return data;
}

export async function stopSafetyJourney(journeyId) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.rpc('stop_safety_journey', { p_journey_id: journeyId });
  if (error) throw error;
}

export async function stopAllLocationSharing() {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.rpc('stop_all_location_sharing');
  if (error) throw error;
}

export async function cleanupExpiredLocationSharing() {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.rpc('cleanup_expired_location_sharing');
  if (error) throw error;
}

export async function upsertCurrentLocation(location) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.rpc('publish_current_location', {
    p_latitude: location.latitude,
    p_longitude: location.longitude,
    p_accuracy: location.accuracy,
    p_captured_at: location.capturedAt,
  });
  if (error) throw error;
}

export async function loadAuthorizedLiveLocations() {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.from('live_locations')
    .select('user_id, latitude, longitude, accuracy, captured_at, updated_at');
  if (error) throw error;
  return data ?? [];
}

export async function loadLocationShares() {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error('Sign in to load location shares.');
  const { data, error } = await supabase.from('location_shares')
    .select('id, journey_id, owner_id, recipient_user_id, contact_id, owner_label, created_at, expires_at, revoked_at');
  if (error) throw error;
  return data ?? [];
}

export function subscribeToLiveLocations(callback) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const channel = supabase.channel(`safety-live-locations-${crypto.randomUUID()}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'live_locations',
    }, callback)
    .subscribe((status, error) => {
      if (error) callback({ type: 'SUBSCRIPTION_ERROR', error });
      else callback({ type: 'SUBSCRIPTION_STATUS', status });
    });
  return () => { void supabase.removeChannel(channel); };
}

export async function loadOwnLocationShares() {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error('Sign in to load your location shares.');
  const { data, error } = await supabase.from('location_shares')
    .select('id, journey_id, recipient_user_id, contact_id, expires_at, revoked_at')
    .eq('owner_id', user.id)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString());
  if (error) throw error;
  return data ?? [];
}

export async function createSosAlert(location, contactIds) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('create_sos_alert', {
    p_latitude: location?.latitude ?? null,
    p_longitude: location?.longitude ?? null,
    p_accuracy: location?.accuracy ?? null,
    p_contact_ids: contactIds,
  });
  if (error) throw error;
  return data;
}

export async function getSosAlert(alertId) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.from('sos_alerts')
    .select('id, owner_id, latitude, longitude, accuracy, status, created_at, expires_at')
    .eq('id', alertId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadSosAlertDelivery(alertId) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.from('sos_alert_recipients')
    .select('id, contact_id, recipient_user_id, status, created_at, acknowledged_at')
    .eq('alert_id', alertId);
  if (error) throw error;
  return data ?? [];
}

export async function acknowledgeSosAlert(alertId) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.rpc('acknowledge_sos_alert', { p_alert_id: alertId });
  if (error) throw error;
}

export async function cancelSosAlert(alertId) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.rpc('cancel_sos_alert', { p_alert_id: alertId });
  if (error) throw error;
}

export async function loadOwnSosAlerts() {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error('Sign in to load emergency alerts.');
  const { data, error } = await supabase.from('sos_alerts')
    .select('id, owner_id, latitude, longitude, accuracy, status, created_at, expires_at, cancelled_at')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return data ?? [];
}

export async function loadIncomingSosAlerts() {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error('Sign in to load emergency alerts.');
  const { data, error } = await supabase.from('sos_alert_recipients')
    .select('id, alert_id, contact_id, status, created_at')
    .eq('recipient_user_id', user.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return data ?? [];
}

export async function subscribeToSosAlerts({ onIncomingAlert, onDeliveryUpdate, onStatus }) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!user) throw new Error('Sign in to receive emergency alerts.');
  const channel = supabase.channel(`safety-sos-${user.id}-${crypto.randomUUID()}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'sos_alert_recipients',
      filter: `recipient_user_id=eq.${user.id}`,
    }, (payload) => { void onIncomingAlert(payload.new); })
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'sos_alert_recipients',
      filter: `owner_id=eq.${user.id}`,
    }, (payload) => { void onDeliveryUpdate(payload.new); })
    .subscribe((status, error) => onStatus?.({ status, error }));
  return () => { void supabase.removeChannel(channel); };
}
