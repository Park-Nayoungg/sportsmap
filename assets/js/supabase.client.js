// /js/supabase.client.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

export const supabase = createClient(
  'https://eewnltarswnibxpixble.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVld25sdGFyc3duaWJ4cGl4YmxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2NDI2MzAsImV4cCI6MjA3NTIxODYzMH0.GFYF_ZFg1VLPOwbhhwklblj0CuVvGUvl82ob9CcYqVc',
  { auth: { persistSession: true, autoRefreshToken: true } }
);

window.supabase = supabase;