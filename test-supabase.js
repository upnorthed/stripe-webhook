const { createClient } = require('@supabase/supabase-js');
const s = createClient('https://pbtdskaidiwfgvquxbla.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY);
s.from('customers').insert({sender_name:'test',status:'onboarding'}).then(r => console.log(JSON.stringify(r)));
