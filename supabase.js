import {
  createClient
} from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";


const SUPABASE_URL =
  "https://atlykkkmeupjdoicqfda.supabase.co";


const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_0ITncyfHOMy44gl9s9evGg_ikqIuxhP";


const supabase =
  createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );


export {
  supabase
};