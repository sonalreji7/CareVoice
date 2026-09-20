import { randomBytes } from "node:crypto";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: new URL("../.env.local", import.meta.url).pathname });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env.local.");

const password = process.env.CAREVOICE_DEMO_PASSWORD || `CareVoiceDemo-${randomBytes(12).toString("base64url")}`;
const resetPassword = process.argv.includes("--reset-password");
const client = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
let passwordApplied = false;

const accounts = [
  { email: "demo.patient@carevoice.test", displayName: "Fictional Maya Patient", role: "patient" },
  { email: "demo.caregiver@carevoice.test", displayName: "Fictional Arun Caregiver", role: "caregiver" },
  { email: "demo.clinician@carevoice.test", displayName: "Fictional Dr. Lee", role: "clinician" },
  { email: "demo.admin@carevoice.test", displayName: "Fictional Demo Administrator", role: "admin" },
];

async function existingUser(email) {
  let page = 1;
  while (true) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find((candidate) => candidate.email === email);
    if (user) return user;
    if (data.users.length < 1000) return null;
    page += 1;
  }
}

async function ensureUser(account) {
  let user = await existingUser(account.email);
  if (!user) {
    const { data, error } = await client.auth.admin.createUser({
      email: account.email,
      password,
      email_confirm: true,
      user_metadata: { display_name: account.displayName },
    });
    if (error || !data.user) throw error || new Error(`Could not create ${account.email}`);
    user = data.user;
    passwordApplied = true;
  } else if (resetPassword) {
    const { data, error } = await client.auth.admin.updateUserById(user.id, { password, email_confirm: true });
    if (error || !data.user) throw error || new Error(`Could not reset ${account.email}`);
    user = data.user;
    passwordApplied = true;
  }

  const { error: profileError } = await client.from("profiles").upsert({ id: user.id, display_name: account.displayName, role: account.role });
  if (profileError) throw profileError;
  return user;
}

const users = new Map();
for (const account of accounts) users.set(account.email, await ensureUser(account));

const patientUser = users.get("demo.patient@carevoice.test");
let { data: patient, error: patientError } = await client.from("patients").select("id").eq("profile_id", patientUser.id).maybeSingle();
if (patientError) throw patientError;
if (!patient) {
  const { data, error } = await client.from("patients").insert({ profile_id: patientUser.id }).select("id").single();
  if (error || !data) throw error || new Error("Could not create fictional patient record.");
  patient = data;
}

for (const [table, personEmail, personColumn] of [
  ["caregiver_patient_assignments", "demo.caregiver@carevoice.test", "caregiver_id"],
  ["clinician_patient_assignments", "demo.clinician@carevoice.test", "clinician_id"],
]) {
  const { error } = await client.from(table).upsert({ [personColumn]: users.get(personEmail).id, patient_id: patient.id });
  if (error) throw error;
}

console.log("Fictional CareVoice demo accounts are ready:");
for (const account of accounts) console.log(`- ${account.role}: ${account.email}`);
if (passwordApplied) console.log(`Password: ${password}`);
else console.log("Existing demo accounts were preserved; their password was not changed.");
console.log("These accounts are demo-only. Do not commit the password or use them with real health information.");
