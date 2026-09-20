/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import type { CareUpdateExtraction, ClarificationField, Extraction, HandoverTag, HandoverV2Extraction } from "@carevoice/core-engine/contracts";
import { apiUrl } from "@/lib/api";
import { supabase } from "@/lib/supabase/client";
import { VoiceInput } from "./voice-input";

type Role = "patient" | "caregiver" | "clinician" | "admin";
type Profile = { id: string; display_name: string; role: Role; created_at?: string };
type Engine = "openai-agents-sdk" | "unavailable" | null;
type CareUpdate = {
  id: string;
  patient_id: string;
  author_id?: string;
  original_message: string;
  agent_summary: unknown;
  status: string;
  priority_reasons: string[];
  created_at: string;
  patients?: { profile_id?: string; quick_summary?: string | null; profiles?: { display_name?: string | null } | null } | null;
};
type PatientRecord = { id: string; profile_id: string; quick_summary?: string | null };
type Assignment = { caregiver_id: string; patient_id: string; created_at: string };
type ClinicianAssignment = { clinician_id: string; patient_id: string; created_at: string };
type LinkedPatient = { id: string; name: string; quickSummary: string };
type PatientExperienceSummary = { recent_change: string | null; impact_or_context: string | null; help_or_report: string | null };
type PatientCareSnapshot = { summary: PatientExperienceSummary; summaryMode: "agent" | "unavailable"; updateCount: number };

const caregiverPriorityReason = "Caregiver explicitly requested a priority callback.";

const roleLabels: Record<Role, string> = {
  patient: "Patient",
  caregiver: "Caregiver",
  clinician: "Clinician",
  admin: "Administrator",
};

function statusClass(status: string) {
  if (status === "priority_review_requested") return "status-priority";
  if (status === "acknowledged") return "status-ack";
  if (status === "closed") return "status-closed";
  return "status-new";
}

function DemoModeNotice({ engine }: { engine: Engine }) {
  if (engine !== "unavailable") return null;
  return <p className="notice demo-notice mt-5" role="status"><strong>Demo mode:</strong> the local safe fallback saves original words but does not create a structured handover. Add the server-only OpenAI key to enable the evidence-backed handover agent.</p>;
}

function SecureWritesNotice({ configured }: { configured: boolean | null }) {
  if (configured !== false) return null;
  return <p className="notice mt-5" role="status"><strong>Local setup incomplete:</strong> secure submissions and clinician actions are held until the backend receives its server-only Supabase service role key. This value must never be added to browser environment variables.</p>;
}

export function AuthScreen() {
  const router = useRouter();
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const result = signup
        ? await supabase().auth.signUp({ email, password, options: { data: { display_name: name } } })
        : await supabase().auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (signup && !result.data.session) setNotice("Check your email to confirm your account, then sign in.");
      else router.push("/portal");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "We could not complete that request.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="shell py-12 md:py-20"><div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[1.1fr_.9fr] lg:items-center">
    <section>
      <p className="eyebrow">Secure care updates</p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-6xl">Speak in your own words. Keep care connected.</h1>
      <p className="mt-5 max-w-xl text-lg leading-8 text-[#5d7078]">CareVoice Relay gives patients, caregivers, clinicians, and administrators a focused workspace with only the information they need.</p>
    </section>
    <form className="card p-6 md:p-8" onSubmit={submit}>
      <p className="eyebrow">{signup ? "Create an account" : "Welcome back"}</p>
      <h2 className="mt-2 text-2xl font-bold">{signup ? "Set up your private space" : "Sign in securely"}</h2>
      {signup && <><label className="mt-5 block"><span className="label">Your name</span><input className="field" required value={name} onChange={(event) => setName(event.target.value)} /></label><p className="mt-4 text-sm leading-6 text-[#5d7078]">Caregiver, clinician, and administrator access is provisioned by an administrator.</p></>}
      <label className="mt-5 block"><span className="label">Email address</span><input className="field" required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className="mt-4 block"><span className="label">Password</span><input className="field" required minLength={8} type="password" autoComplete={signup ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {notice && <p className="mt-4 rounded-lg bg-[#fff4e7] p-3 text-sm text-[#704414]" role="alert">{notice}</p>}
      <button className="btn btn-primary mt-6 w-full" disabled={busy}>{busy ? "Please wait…" : signup ? "Create account" : "Sign in"}</button>
      <button type="button" className="btn btn-quiet mt-4 w-full" onClick={() => { setSignup(!signup); setNotice(""); }}>{signup ? "Already have an account? Sign in" : "Need an account? Create one"}</button>
    </form>
  </div></div>;
}

export function CarePortal() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [updates, setUpdates] = useState<CareUpdate[]>([]);
  const [patientId, setPatientId] = useState("");
  const [linkedName, setLinkedName] = useState("");
  const [quickSummary, setQuickSummary] = useState("");
  const [linkedPatients, setLinkedPatients] = useState<LinkedPatient[]>([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [engine, setEngine] = useState<Engine>(null);
  const [secureWritesConfigured, setSecureWritesConfigured] = useState<boolean | null>(null);
  const [workspaceVersion, setWorkspaceVersion] = useState(0);

  useEffect(() => {
    let live = true;
    let client;
    try {
      client = supabase();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Configuration is required.");
      setLoading(false);
      return;
    }
    void client.auth.getSession().then(({ data }) => live && setSession(data.session)).finally(() => live && setLoading(false));
    const listener = client.auth.onAuthStateChange((_, next) => live && setSession(next));
    return () => { live = false; listener.data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    let live = true;
    void fetch(apiUrl("/health"))
      .then(async (response) => response.ok ? response.json() as Promise<{ extractionEngine?: Engine; secureWritesConfigured?: boolean }> : null)
      .then((health) => { if (live && health?.extractionEngine) { setEngine(health.extractionEngine); setSecureWritesConfigured(Boolean(health.secureWritesConfigured)); } })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!session) return;
    const userId = session.user.id;
    let live = true;
    async function loadWorkspace() {
      setLoading(true);
      setNotice("");
      try {
        const client = supabase();
        const { data, error } = await client.from("profiles").select("id, display_name, role, created_at").eq("id", userId).single();
        if (error) throw error;
        const next = data as Profile;
        if (!live) return;
        setProfile(next);
        setUpdates([]);
        setPatientId("");
        setLinkedName("");
        setQuickSummary("");
        setLinkedPatients([]);

        if (next.role === "patient") {
          const { data: patient, error: patientError } = await client.from("patients").select("id, quick_summary").eq("profile_id", next.id).single();
          if (patientError) throw patientError;
          const { data: rows, error: rowsError } = await client.from("care_updates").select("*").eq("patient_id", patient.id).order("created_at", { ascending: false });
          if (rowsError) throw rowsError;
          if (!live) return;
          setPatientId(patient.id);
          setQuickSummary(patient.quick_summary || "");
          setUpdates(rows as CareUpdate[]);
        } else if (next.role === "caregiver") {
          const { data: links, error: linkError } = await client.from("caregiver_patient_assignments").select("patient_id, patients(quick_summary, profiles!patients_profile_id_fkey(display_name))").order("created_at", { ascending: true });
          if (linkError) throw linkError;
          if (!links?.length) { setNotice("Your account has not yet been linked to a person in your care."); return; }
          const contexts = links.map((link) => {
            const patient = link.patients as { quick_summary?: string; profiles?: { display_name?: string } } | null;
            return { id: link.patient_id, name: patient?.profiles?.display_name || "Person in your care", quickSummary: patient?.quick_summary || "" };
          });
          const { data: rows, error: rowsError } = await client.from("care_updates").select("*").in("patient_id", contexts.map((patient) => patient.id)).order("created_at", { ascending: false });
          if (rowsError) throw rowsError;
          if (!live) return;
          setPatientId(contexts[0].id);
          setLinkedName(contexts[0].name);
          setQuickSummary(contexts[0].quickSummary);
          setLinkedPatients(contexts);
          setUpdates(rows as CareUpdate[]);
        } else if (next.role === "clinician") {
          const { data: rows, error: rowsError } = await client.from("care_updates").select("*, patients(profile_id, quick_summary, profiles!patients_profile_id_fkey(display_name))").order("created_at", { ascending: false });
          if (rowsError) throw rowsError;
          if (live) setUpdates(rows as CareUpdate[]);
        }
      } catch (error) {
        if (live) setNotice(error instanceof Error ? error.message : "We could not load your workspace.");
      } finally {
        if (live) setLoading(false);
      }
    }
    void loadWorkspace();
    return () => { live = false; };
  }, [session, workspaceVersion]);

  if (!session) return <AuthScreen />;
  if (loading) return <div className="shell py-20 text-center text-[#5d7078]">Loading your private workspace…</div>;
  if (!profile) return <div className="shell py-20 text-center"><p>{notice || "Your account is not ready yet."}</p></div>;

  const heading = profile.role === "admin" ? "User and access management" : profile.role === "clinician" ? "Executive review of authorised updates" : "Your private care updates";
  return <div className="shell py-9 md:py-12">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">{roleLabels[profile.role]} workspace</p><h1 className="mt-2 text-4xl font-bold">Hello, {profile.display_name}</h1><p className="mt-2 text-lg text-[#5d7078]">{heading}</p></div><div className="flex flex-wrap gap-3"><button className="btn btn-secondary" onClick={() => setWorkspaceVersion((current) => current + 1)}>Refresh updates</button><button className="btn btn-secondary" onClick={() => void supabase().auth.signOut()}>Sign out</button></div></div>
    {notice && <p className="notice mt-5" role="status">{notice}</p>}
    {profile.role !== "admin" && <DemoModeNotice engine={engine} />}
    {profile.role !== "admin" && <SecureWritesNotice configured={secureWritesConfigured} />}
    {profile.role === "admin" ? <AdminPanel currentUserId={profile.id} /> : profile.role === "clinician" ? <ClinicianUpdates updates={updates} session={session} setUpdates={setUpdates} /> : <PrivateUpdates role={profile.role} patientId={patientId} linkedName={linkedName} quickSummary={quickSummary} linkedPatients={linkedPatients} updates={updates} session={session} profile={profile} engine={engine} setEngine={setEngine} setUpdates={setUpdates} setNotice={setNotice} />}
  </div>;
}

type Clarification = { field: ClarificationField; question: string };
type Draft = {
  draftId: string;
  originalMessage: string;
  extraction: CareUpdateExtraction;
  clarification: Clarification | null;
  priorityReasons: string[];
  mode: Exclude<Engine, null>;
};

function asAvailableExtraction(summary: unknown): Extraction | HandoverV2Extraction | null {
  if (!summary || typeof summary !== "object" || (summary as { handover_available?: unknown }).handover_available !== true) return null;
  if ((summary as { handover_version?: unknown }).handover_version === 2) {
    const v2 = summary as Partial<HandoverV2Extraction>;
    if (!Array.isArray(v2.sentences) || !v2.sentences.every((sentence) => sentence && typeof sentence.id === "string" && typeof sentence.text === "string" && Array.isArray(sentence.tags))) return null;
    return v2 as HandoverV2Extraction;
  }
  return summary as Extraction;
}

function latestReportedChange(item?: CareUpdate) {
  const handover = item && asAvailableExtraction(item.agent_summary);
  if (!handover) return "";
  if ("handover_version" in handover) return handover.sentences.find((sentence) => sentence.tags.includes("change"))?.text ?? handover.sentences[0]?.text ?? "";
  return handover.change ?? "";
}

function HandoverPreview({ summary }: { summary: unknown }) {
  const handover = asAvailableExtraction(summary);
  if (!handover) return <p className="mt-3 rounded-lg bg-[#f5faf9] p-3 text-sm text-[#52696e]">Structured handover unavailable — review the original message.</p>;
  if ("handover_version" in handover) return <div className="mt-4 rounded-xl bg-[#f5faf9] p-4"><p className="label">AI-assisted organisation of your words. Not clinical advice.</p><ol className="mt-3 space-y-3 text-sm">{handover.sentences.map((sentence, index) => <li key={sentence.id} className="rounded-lg border border-[#dcebe7] bg-white p-3"><p className="font-bold text-[#24444a]">Sentence {index + 1}</p><div className="mt-2 flex flex-wrap gap-2">{sentence.tags.map((tag: HandoverTag) => <span key={tag} className="badge status-new">{tag.replaceAll("_", " ")}</span>)}</div><p className="mt-2 whitespace-pre-wrap text-[#52696e]">{sentence.text}</p></li>)}</ol></div>;
  const quoteList = (quotes: string[]) => quotes.length ? quotes.join(" ") : "not stated";
  return <div className="mt-4 rounded-xl bg-[#f5faf9] p-4"><p className="label">AI-assisted organisation of your words — reviewed against the original message. Not clinical advice.</p><dl className="mt-3 grid gap-3 text-sm"><div><dt className="font-bold">Reported change</dt><dd>{handover.change || "not stated"}</dd></div><div><dt className="font-bold">Timing</dt><dd>{handover.timing}</dd></div><div><dt className="font-bold">Comfort or daily impact</dt><dd>{quoteList(handover.comfort_or_daily_impact)}</dd></div><div><dt className="font-bold">Help requested</dt><dd>{quoteList(handover.help_requested)}</dd></div><div><dt className="font-bold">Medication or care question</dt><dd>{quoteList(handover.medication_or_care_question)}</dd></div></dl></div>;
}

function PriorityExplanation({ reasons }: { reasons: string[] }) {
  if (!reasons.length) return null;
  return <p className="mt-4 rounded-lg bg-[#fff4d6] p-3 text-sm"><strong>Priority review request:</strong> {reasons.join(" ")}</p>;
}

function PatientTitleCard({ patientId, session, quickSummary, updates }: { patientId: string; session: Session; quickSummary: string; updates: CareUpdate[] }) {
  const [snapshot, setSnapshot] = useState<PatientCareSnapshot | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const lines = [
    { label: "Recent change", value: snapshot?.summary.recent_change },
    { label: "Impact or context", value: snapshot?.summary.impact_or_context },
    { label: "Help or report detail", value: snapshot?.summary.help_or_report },
  ];

  async function createSnapshot() {
    if (!patientId) return;
    setCreating(true);
    setNotice("");
    try {
      const response = await fetch(apiUrl(`/api/patients/${patientId}/care-snapshot`), { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } });
      const body = await response.json() as PatientCareSnapshot & { error?: string };
      if (!response.ok) throw new Error(body.error || "We could not create your care snapshot.");
      setSnapshot(body);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "We could not create your care snapshot.");
    } finally { setCreating(false); }
  }

  return <div className="card p-6"><div><p className="eyebrow">Your care snapshot</p><h2 className="mt-2 text-xl font-bold">What you have reported</h2></div><p className="mt-3 text-sm leading-6 text-[#5d7078]">Create a snapshot when you choose. It organises up to 10 of your most recent care updates using only your recorded words. It does not diagnose, prescribe, or replace clinical review.</p><button type="button" className="btn btn-secondary mt-5" disabled={!patientId || creating} onClick={() => void createSnapshot()}>{creating ? "Creating snapshot…" : "Create care snapshot"}</button>{snapshot && <><p className="mt-4 text-sm text-[#5d7078]">This snapshot used your {snapshot.updateCount} most recent care update{snapshot.updateCount === 1 ? "" : "s"}.</p><div className="mt-3 space-y-3">{lines.map((line) => <div key={line.label} className="rounded-lg bg-[#f5faf9] p-3 text-sm"><p className="font-bold">{line.label}</p><p className="mt-1 text-[#52696e]">{line.value || "No user-provided detail is available."}</p></div>)}</div></>}{snapshot?.summaryMode === "unavailable" && <p className="mt-3 text-sm text-[#5d7078]">The structured snapshot is unavailable right now; your original updates remain available below.</p>}{!snapshot && <p className="mt-4 text-sm text-[#5d7078]">{quickSummary || latestReportedChange(updates[0]) || "No care summary has been provided yet."}</p>}{notice && <p className="notice mt-4" role="status">{notice}</p>}</div>;
}

function PrivateUpdates({ role, patientId, linkedName, quickSummary, linkedPatients, updates, session, engine, setEngine, setUpdates, setNotice }: { role: "patient" | "caregiver"; patientId: string; linkedName: string; quickSummary: string; linkedPatients: LinkedPatient[]; updates: CareUpdate[]; session: Session; profile: Profile; engine: Engine; setEngine: (engine: Engine) => void; setUpdates: (value: CareUpdate[] | ((current: CareUpdate[]) => CareUpdate[])) => void; setNotice: (value: string) => void }) {
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState(false);
  const [consent, setConsent] = useState(false);
  const [stage, setStage] = useState<"compose" | "clarification" | "review">("compose");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [clarificationAnswer, setClarificationAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [rebuildingId, setRebuildingId] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState(patientId);
  const activePatientId = role === "caregiver" ? selectedPatientId : patientId;
  const activeLinkedPatient = role === "caregiver" ? linkedPatients.find((patient) => patient.id === activePatientId) : null;
  const activeName = activeLinkedPatient?.name || linkedName;
  const activeQuickSummary = activeLinkedPatient?.quickSummary || quickSummary;
  const canContinue = Boolean(activePatientId && message.trim() && consent);

  async function prepareDraft(answers: Partial<Record<ClarificationField, string>> = {}) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(apiUrl("/api/care-update-drafts"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ patientId: activePatientId, originalMessage: message, caregiverCallbackRequested: role === "caregiver" && priority, clarificationAnswers: answers }),
      });
      const body = await response.json() as Partial<Draft> & { error?: string };
      if (!response.ok || !body.draftId || !body.extraction || !body.originalMessage) throw new Error(body.error || "We could not prepare the structured handover.");
      const next = body as Draft;
      setDraft(next);
      setEngine(next.mode);
      setClarificationAnswer("");
      setStage(next.clarification ? "clarification" : "review");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "We could not prepare the structured handover.");
    } finally {
      setBusy(false);
    }
  }

  async function share(activeDraft: Draft) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(apiUrl("/api/care-updates"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ draftId: activeDraft.draftId, patientId: activePatientId, originalMessage: activeDraft.originalMessage, caregiverCallbackRequested: role === "caregiver" && priority, clarificationAnswers: {} }),
      });
      const body = await response.json() as { update?: CareUpdate; error?: string };
      if (!response.ok || !body.update) throw new Error(body.error || "We could not share the update.");
      setUpdates((current) => [body.update as CareUpdate, ...current]);
      // Re-read through the browser's RLS-scoped SELECT after the trusted save.
      // This keeps the visible history aligned with the persisted record rather
      // than relying only on an optimistic client-side append.
      const { data: persistedUpdates, error: refreshError } = await supabase()
        .from("care_updates")
        .select("*")
        .eq("patient_id", activePatientId)
        .order("created_at", { ascending: false });
      if (!refreshError && persistedUpdates) {
        const refreshed = persistedUpdates as CareUpdate[];
        setUpdates((current) => role === "caregiver"
          ? [...current.filter((item) => item.patient_id !== activePatientId), ...refreshed].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
          : refreshed);
      }
      setMessage(""); setConsent(false); setPriority(false); setDraft(null); setStage("compose");
      setNotice(body.update.priority_reasons?.length ? "Your update was shared and includes a deterministic priority review request." : "Your update has been shared with the care team.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "We could not share the update.");
    } finally {
      setBusy(false);
    }
  }

  function returnToCompose() {
    setStage("compose");
    setDraft(null);
    setClarificationAnswer("");
    setNotice("");
  }

  function beginDraft(event: FormEvent) {
    event.preventDefault();
    if (canContinue) void prepareDraft();
  }

  async function transcribe(recording: Blob) {
    const response = await fetch(apiUrl("/api/transcribe"), {
      method: "POST",
      headers: { "Content-Type": recording.type, Authorization: `Bearer ${session.access_token}` },
      body: recording,
    });
    const body = await response.json() as { transcript?: string; error?: string };
    if (!response.ok || !body.transcript) throw new Error(body.error || "We could not transcribe that recording. You can type your update instead.");
    return body.transcript;
  }

  async function rebuildHandover(updateId: string) {
    setRebuildingId(updateId);
    setNotice("");
    try {
      const response = await fetch(apiUrl(`/api/care-updates/${updateId}/rebuild-handover`), {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = await response.json() as { update?: CareUpdate; mode?: Exclude<Engine, null>; error?: string };
      if (!response.ok || !body.update) throw new Error(body.error || "We could not rebuild the structured handover.");
      setEngine(body.mode || engine || "unavailable");
      setUpdates((current) => current.map((item) => item.id === updateId ? body.update as CareUpdate : item));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "We could not rebuild the structured handover.");
    } finally { setRebuildingId(""); }
  }

  return <div className="mt-8 grid gap-6 lg:grid-cols-[.9fr_1.1fr]">
    <section className="space-y-5">{role === "patient" ? <PatientTitleCard patientId={patientId} session={session} quickSummary={quickSummary} updates={updates} /> : <div className="card p-6"><p className="eyebrow">Person in your care</p><h2 className="mt-2 text-xl font-bold">{activeName}</h2>{linkedPatients.length > 1 && <label className="mt-4 block"><span className="label">Choose a person</span><select className="field" value={activePatientId} onChange={(event) => setSelectedPatientId(event.target.value)}>{linkedPatients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name}</option>)}</select></label>}<p className="mt-3 leading-6 text-[#5d7078]">{activeQuickSummary || latestReportedChange(updates.find((item) => item.patient_id === activePatientId)) || "No care summary has been provided yet."}</p></div>}</section>
    <section className="card p-6">
      {stage === "compose" && <form onSubmit={beginDraft}><p className="eyebrow">Share an update</p><h2 className="mt-2 text-2xl font-bold">What has changed today?</h2><p className="mt-2 text-[#5d7078]">Your words will be organised for your review before anything is shared.</p><label className="mt-5 block"><span className="label">Care update</span><textarea className="field min-h-36" required maxLength={10000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Describe what has changed in your own words." /><span className="mt-2 block text-right text-xs text-[#5d7078]" aria-live="polite">{message.length.toLocaleString()} / 10,000 characters</span></label><VoiceInput disabled={busy} transcribe={transcribe} onTranscript={(transcript) => setMessage((current) => [current.trim(), transcript.trim()].filter(Boolean).join(current.trim() ? " " : "").slice(0, 10000))} />{role === "caregiver" && <Check value={priority} setValue={setPriority} label="Request a priority callback" />}<Check value={consent} setValue={setConsent} label="I consent to share this update with the care team" /><button type="submit" className="btn btn-primary mt-6" disabled={!canContinue || busy}>{busy ? "Preparing…" : "Prepare review"}</button></form>}
      {stage === "clarification" && draft && <ClarificationStep clarification={draft.clarification} busy={busy} answer={clarificationAnswer} setAnswer={setClarificationAnswer} onSkip={() => setStage("review")} onContinue={() => draft.clarification && void prepareDraft({ [draft.clarification.field]: clarificationAnswer })} />}
      {stage === "review" && draft && <ReviewStep draft={draft} busy={busy} onBack={returnToCompose} onConfirm={() => void share(draft)} />}
    </section>
    {role === "caregiver" ? <CaregiverUpdates updates={updates} patients={linkedPatients} session={session} setUpdates={setUpdates} setNotice={setNotice} onRebuild={rebuildHandover} rebuildingId={rebuildingId} /> : <section className="card p-6 lg:col-span-2"><h2 className="text-xl font-bold">Your updates</h2><div className="mt-4 space-y-4">{updates.length ? updates.map((item) => <UpdateCard key={item.id} item={item} onRebuild={() => void rebuildHandover(item.id)} rebuilding={rebuildingId === item.id} />) : <p className="text-[#5d7078]">No updates have been shared yet.</p>}</div></section>}
  </div>;
}

function ClarificationStep({ clarification, answer, setAnswer, busy, onSkip, onContinue }: { clarification: Clarification | null; answer: string; setAnswer: (value: string) => void; busy: boolean; onSkip: () => void; onContinue: () => void }) {
  if (!clarification) return null;
  return <div><p className="eyebrow">Optional clarification</p><h2 className="mt-2 text-2xl font-bold">One detail could make this handover clearer</h2><p className="mt-3 text-[#5d7078]">{clarification.question}</p><label className="mt-5 block"><span className="label">Your answer</span><textarea className="field min-h-28" maxLength={1000} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Add only what you want the care team to know." /></label><div className="mt-6 flex flex-wrap gap-3"><button type="button" className="btn btn-secondary" disabled={busy} onClick={onSkip}>Skip and continue to review</button><button type="button" className="btn btn-primary" disabled={busy || !answer.trim()} onClick={onContinue}>{busy ? "Preparing…" : "Continue to review"}</button></div></div>;
}

function ReviewStep({ draft, busy, onBack, onConfirm }: { draft: Draft; busy: boolean; onBack: () => void; onConfirm: () => void }) {
  return <div><p className="eyebrow">Review before sharing</p><h2 className="mt-2 text-2xl font-bold">Confirm this care update</h2><p className="mt-3 text-[#5d7078]">Review your submitted words and their AI-assisted organisation. Nothing has been shared yet.</p><div className="mt-5 rounded-xl border border-[#cfe2dd] p-4"><p className="label">Your submitted words</p><p className="mt-2 whitespace-pre-wrap text-[#52696e]">{draft.originalMessage}</p></div><HandoverPreview summary={draft.extraction} /><PriorityExplanation reasons={draft.priorityReasons} /><p className="mt-4 text-sm text-[#5d7078]">AI-assisted organisation of your words. Not clinical advice.</p><div className="mt-6 flex flex-wrap gap-3"><button type="button" className="btn btn-secondary" disabled={busy} onClick={onBack}>Back to edit</button><button type="button" className="btn btn-primary" disabled={busy} onClick={onConfirm}>{busy ? "Sharing…" : "Confirm and share"}</button></div></div>;
}

function UpdateCard({ item, onRebuild, rebuilding }: { item: CareUpdate; onRebuild?: () => void; rebuilding?: boolean }) {
  const unavailable = !asAvailableExtraction(item.agent_summary);
  return <article className="rounded-xl border border-[#cfe2dd] p-4"><span className={`badge ${statusClass(item.status)}`}>{item.status.replaceAll("_", " ")}</span><PriorityExplanation reasons={item.priority_reasons || []} /><HandoverPreview summary={item.agent_summary} />{unavailable && onRebuild && <button type="button" className="btn btn-secondary mt-3" disabled={rebuilding} onClick={onRebuild}>{rebuilding ? "Building handover…" : "Create structured handover"}</button>}<details className="mt-3"><summary className="cursor-pointer font-bold text-[#0d766e]">See original words</summary><p className="mt-2 whitespace-pre-wrap text-[#52696e]">{item.original_message}</p></details></article>;
}

type PatientUpdateGroup = { patientId: string; name: string; quickSummary: string; updates: CareUpdate[]; priorityCount: number; firstRank: number };

function reviewRank(item: CareUpdate) {
  if (item.status !== "closed" && item.priority_reasons?.length) return 0;
  if (item.status === "new") return 1;
  if (item.status === "acknowledged") return 2;
  return 3;
}

function orderedUpdateGroups(updates: CareUpdate[], patients: LinkedPatient[] = [], fallbackName = "Patient", chronologicalTimeline = false) {
  const contexts = new Map(patients.map((patient) => [patient.id, patient]));
  const groups = new Map<string, PatientUpdateGroup>();
  for (const patient of patients) groups.set(patient.id, { patientId: patient.id, name: patient.name, quickSummary: patient.quickSummary, updates: [], priorityCount: 0, firstRank: 4 });
  for (const item of [...updates].sort((left, right) => reviewRank(left) - reviewRank(right) || Date.parse(right.created_at) - Date.parse(left.created_at))) {
    const context = contexts.get(item.patient_id);
    const existing = groups.get(item.patient_id) || {
      patientId: item.patient_id,
      name: item.patients?.profiles?.display_name || fallbackName,
      quickSummary: item.patients?.quick_summary || "",
      updates: [],
      priorityCount: 0,
      firstRank: reviewRank(item),
    };
    existing.updates.push(item);
    existing.priorityCount += item.status !== "closed" && item.priority_reasons?.length ? 1 : 0;
    existing.firstRank = Math.min(existing.firstRank, reviewRank(item));
    groups.set(item.patient_id, existing);
  }
  const ordered = [...groups.values()].sort((left, right) => left.firstRank - right.firstRank || Date.parse(right.updates[0]?.created_at || "0") - Date.parse(left.updates[0]?.created_at || "0"));
  if (chronologicalTimeline) for (const group of ordered) group.updates.sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
  return ordered;
}

function CaregiverUpdates({ updates, patients, session, setUpdates, setNotice, onRebuild, rebuildingId }: { updates: CareUpdate[]; patients: LinkedPatient[]; session: Session; setUpdates: (value: CareUpdate[] | ((current: CareUpdate[]) => CareUpdate[])) => void; setNotice: (value: string) => void; onRebuild: (updateId: string) => Promise<void>; rebuildingId: string }) {
  const [busyId, setBusyId] = useState("");
  const groups = useMemo(() => orderedUpdateGroups(updates, patients, "Person in your care"), [updates, patients]);

  async function requestPriorityReview(id: string) {
    setBusyId(id);
    setNotice("");
    try {
      const response = await fetch(apiUrl(`/api/care-updates/${id}/escalate`), { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } });
      const body = await response.json() as { update?: CareUpdate; error?: string };
      if (!response.ok || !body.update) throw new Error(body.error || "We could not request a priority review.");
      setUpdates((current) => current.map((item) => item.id === id ? body.update as CareUpdate : item));
      setNotice("Priority review requested for the care team.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "We could not request a priority review.");
    } finally { setBusyId(""); }
  }

  return <section className="card p-6 lg:col-span-2"><p className="eyebrow">Care updates by person</p><h2 className="mt-2 text-xl font-bold">Updates in your care</h2><p className="mt-2 text-[#5d7078]">Open a person to review their updates and explicitly request a priority review when needed.</p><div className="mt-5 space-y-3">{groups.length ? groups.map((group) => <details key={group.patientId} className="rounded-xl border border-[#cfe2dd] bg-white p-4"><summary className="cursor-pointer list-none"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-bold">{group.name}</h3><p className="mt-1 text-sm text-[#5d7078]">{group.updates.length} update{group.updates.length === 1 ? "" : "s"}{group.priorityCount ? ` · ${group.priorityCount} priority` : ""}</p></div><span className="text-sm font-bold text-[#0d766e]">Open updates</span></div></summary>{group.quickSummary && <p className="mt-4 rounded-lg bg-[#f5faf9] p-3 text-sm text-[#52696e]">{group.quickSummary}</p>}<div className="mt-4 space-y-4">{group.updates.length ? group.updates.map((item) => { const alreadyRequested = item.priority_reasons?.includes(caregiverPriorityReason); const isClosed = item.status === "closed"; return <div key={item.id}><UpdateCard item={item} onRebuild={() => void onRebuild(item.id)} rebuilding={rebuildingId === item.id} /><div className="mt-3 flex flex-wrap items-center gap-3">{isClosed ? <span className="text-sm text-[#5d7078]">This closed update cannot be escalated.</span> : <button type="button" className="btn btn-secondary" disabled={busyId === item.id || alreadyRequested} onClick={() => void requestPriorityReview(item.id)}>{alreadyRequested ? "Priority review requested" : busyId === item.id ? "Requesting…" : "Request priority review"}</button>} {!isClosed && !alreadyRequested && <span className="text-sm text-[#5d7078]">This sends an explicit request to the clinician queue.</span>}</div></div>; }) : <p className="text-[#5d7078]">No updates have been shared for this person yet.</p>}</div></details>) : <p className="text-[#5d7078]">No people are linked to this account yet.</p>}</div></section>;
}

type FeedbackOutcome = "useful_as_is" | "needed_original_words" | "missing_relevant_detail" | "incorrect_tagging" | "other";

const feedbackLabels: Record<FeedbackOutcome, string> = {
  useful_as_is: "Useful as is",
  needed_original_words: "Needed original words",
  missing_relevant_detail: "Missing relevant detail",
  incorrect_tagging: "Incorrect tagging",
  other: "Other",
};

function HandoverFeedback({ updateId, session }: { updateId: string; session: Session }) {
  const [outcome, setOutcome] = useState<FeedbackOutcome>("useful_as_is");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setNotice("");
    try {
      const response = await fetch(apiUrl(`/api/care-updates/${updateId}/handover-feedback`), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ outcome, note }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "We could not record the feedback.");
      setNote(""); setNotice("Handover feedback recorded. The care update was not changed.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "We could not record the feedback.");
    } finally { setBusy(false); }
  }
  return <details className="mt-4 rounded-lg border border-[#dcebe7] p-3"><summary className="cursor-pointer font-bold text-[#0d766e]">Record handover quality feedback</summary><form className="mt-3 space-y-3" onSubmit={submit}><label className="block"><span className="label">Outcome</span><select className="field" value={outcome} onChange={(event) => setOutcome(event.target.value as FeedbackOutcome)}>{(Object.keys(feedbackLabels) as FeedbackOutcome[]).map((value) => <option key={value} value={value}>{feedbackLabels[value]}</option>)}</select></label><label className="block"><span className="label">Note (optional)</span><textarea className="field min-h-20" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Describe the handover quality only." /></label><button className="btn btn-secondary" disabled={busy}>{busy ? "Recording…" : "Record feedback"}</button>{notice && <p className="mt-2 text-sm text-[#5d7078]" role="status">{notice}</p>}</form></details>;
}

function ClinicianUpdates({ updates, session, setUpdates }: { updates: CareUpdate[]; session: Session; setUpdates: (value: CareUpdate[] | ((current: CareUpdate[]) => CareUpdate[])) => void }) {
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const groups = useMemo(() => orderedUpdateGroups(updates, [], "Patient", true), [updates]);
  async function updateStatus(id: string, status: "acknowledged" | "closed") {
    setBusyId(id); setNotice("");
    try {
      const response = await fetch(apiUrl(`/api/care-updates/${id}/status`), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ status }) });
      const body = await response.json() as { update?: CareUpdate; error?: string };
      if (!response.ok || !body.update) throw new Error(body.error || "We could not update the review status.");
      setUpdates((current) => current.map((item) => item.id === id ? body.update as CareUpdate : item));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "We could not update the review status.");
    } finally { setBusyId(""); }
  }
  const authorRole = (item: CareUpdate) => item.author_id && item.patients?.profile_id ? item.author_id === item.patients.profile_id ? "Patient" : "Caregiver" : "Author role unavailable";
  return <section className="card mt-8 p-6"><p className="eyebrow">Executive summary</p><h2 className="mt-2 text-2xl font-bold">Care updates for review</h2><p className="mt-2 text-[#5d7078]">People with active priority requests appear first. Within each person, updates appear in chronological order.</p>{notice && <p className="notice mt-4" role="alert">{notice}</p>}<div className="mt-6 space-y-3">{groups.length ? groups.map((group) => <details key={group.patientId} open={group.firstRank === 0} className="rounded-xl border border-[#cfe2dd] bg-white p-5"><summary className="cursor-pointer list-none"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-bold">{group.name}</h3><p className="mt-1 text-sm text-[#5d7078]">{group.updates.length} update{group.updates.length === 1 ? "" : "s"}{group.priorityCount ? ` · ${group.priorityCount} priority` : ""}</p></div>{group.priorityCount ? <span className="badge status-priority">priority</span> : <span className="text-sm font-bold text-[#0d766e]">Open review</span>}</div></summary>{group.quickSummary && <p className="mt-4 rounded-lg bg-[#f5faf9] p-3 text-sm text-[#52696e]">{group.quickSummary}</p>}<div className="mt-5 space-y-4 border-l-2 border-[#cfe2dd] pl-4">{group.updates.map((item) => <article key={item.id} className="rounded-xl border border-[#e3efec] p-4"><div className="flex flex-wrap justify-between gap-3"><div className="text-sm text-[#5d7078]"><p>{new Date(item.created_at).toLocaleString()}</p><p className="mt-1">{authorRole(item)} · {asAvailableExtraction(item.agent_summary) ? "Handover ready" : "Original words only"}</p></div><span className={`badge ${statusClass(item.status)}`}>{item.status.replaceAll("_", " ")}</span></div><PriorityExplanation reasons={item.priority_reasons || []} /><HandoverPreview summary={item.agent_summary} /><div className="mt-4 flex flex-wrap gap-2">{item.status === "new" && <button className="btn btn-secondary" disabled={busyId === item.id} onClick={() => void updateStatus(item.id, "acknowledged")}>Acknowledge</button>}{item.status === "acknowledged" && <button className="btn btn-primary" disabled={busyId === item.id} onClick={() => void updateStatus(item.id, "closed")}>Close</button>}</div><HandoverFeedback updateId={item.id} session={session} /><details className="mt-4 rounded-lg bg-[#f5faf9] p-4"><summary className="cursor-pointer font-bold">Additional information</summary><p className="mt-3 text-sm font-bold">Original words</p><p className="mt-1 whitespace-pre-wrap text-[#52696e]">{item.original_message}</p></details></article>)}</div></details>) : <p className="text-[#5d7078]">No care updates are currently available to you.</p>}</div></section>;
}

function AdminPanel({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<Profile[]>([]);
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [clinicianAssignments, setClinicianAssignments] = useState<ClinicianAssignment[]>([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedCaregiver, setSelectedCaregiver] = useState("");
  const [selectedPatient, setSelectedPatient] = useState("");
  const [selectedClinician, setSelectedClinician] = useState("");
  const [selectedClinicianPatient, setSelectedClinicianPatient] = useState("");

  async function loadDirectory() {
    setLoading(true);
    try {
      const client = supabase();
      const [profilesResult, patientsResult, assignmentsResult, clinicianAssignmentsResult] = await Promise.all([
        client.from("profiles").select("id, display_name, role, created_at").order("created_at", { ascending: true }),
        client.from("patients").select("id, profile_id, quick_summary"),
        client.from("caregiver_patient_assignments").select("caregiver_id, patient_id, created_at").order("created_at", { ascending: false }),
        client.from("clinician_patient_assignments").select("clinician_id, patient_id, created_at").order("created_at", { ascending: false }),
      ]);
      if (profilesResult.error) throw profilesResult.error;
      if (patientsResult.error) throw patientsResult.error;
      if (assignmentsResult.error) throw assignmentsResult.error;
      setUsers(profilesResult.data as Profile[]);
      setPatients(patientsResult.data as PatientRecord[]);
      setAssignments(assignmentsResult.data as Assignment[]);
      // The assignment table is introduced by the secure-write migration. Keep
      // existing demo administration usable until that migration is applied.
      if (clinicianAssignmentsResult.error && clinicianAssignmentsResult.error.code !== "42P01") throw clinicianAssignmentsResult.error;
      setClinicianAssignments((clinicianAssignmentsResult.data || []) as ClinicianAssignment[]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "We could not load user management.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadDirectory(); }, []);
  const caregivers = useMemo(() => users.filter((user) => user.role === "caregiver"), [users]);
  const clinicians = useMemo(() => users.filter((user) => user.role === "clinician"), [users]);
  const patientOptions = useMemo(() => patients.map((patient) => ({ ...patient, profile: users.find((user) => user.id === patient.profile_id) })).filter((patient) => patient.profile?.role === "patient"), [patients, users]);
  const peopleById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const patientById = useMemo(() => new Map(patients.map((patient) => [patient.id, patient])), [patients]);

  async function changeRole(id: string, role: Exclude<Role, "admin">) {
    setNotice("");
    const { error } = await supabase().from("profiles").update({ role }).eq("id", id);
    if (error) setNotice(error.message);
    else void loadDirectory();
  }

  async function addAssignment() {
    if (!selectedCaregiver || !selectedPatient) return;
    setNotice("");
    const { error } = await supabase().from("caregiver_patient_assignments").insert({ caregiver_id: selectedCaregiver, patient_id: selectedPatient });
    if (error) setNotice(error.message);
    else { setSelectedCaregiver(""); setSelectedPatient(""); void loadDirectory(); }
  }

  async function removeAssignment(assignment: Assignment) {
    const { error } = await supabase().from("caregiver_patient_assignments").delete().eq("caregiver_id", assignment.caregiver_id).eq("patient_id", assignment.patient_id);
    if (error) setNotice(error.message);
    else void loadDirectory();
  }

  async function addClinicianAssignment() {
    if (!selectedClinician || !selectedClinicianPatient) return;
    setNotice("");
    const { error } = await supabase().from("clinician_patient_assignments").insert({ clinician_id: selectedClinician, patient_id: selectedClinicianPatient });
    if (error) setNotice(error.message);
    else { setSelectedClinician(""); setSelectedClinicianPatient(""); void loadDirectory(); }
  }

  async function removeClinicianAssignment(assignment: ClinicianAssignment) {
    const { error } = await supabase().from("clinician_patient_assignments").delete().eq("clinician_id", assignment.clinician_id).eq("patient_id", assignment.patient_id);
    if (error) setNotice(error.message);
    else void loadDirectory();
  }

  return <section className="mt-8 space-y-6"><div className="card p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">Administrator controls</p><h2 className="mt-2 text-2xl font-bold">User roles and caregiver links</h2><p className="mt-2 max-w-3xl text-[#5d7078]">Grant patient, caregiver, or clinician access and link caregivers to patients. Administrators cannot grant themselves or others administrator access from this pane.</p></div><button className="btn btn-secondary" disabled={loading} onClick={() => void loadDirectory()}>Refresh</button></div>{notice && <p className="notice mt-5" role="alert">{notice}</p>}</div>
    <div className="card overflow-hidden"><div className="border-b border-[#cfe2dd] p-6"><h2 className="text-xl font-bold">User directory</h2><p className="mt-1 text-sm text-[#5d7078]">Role updates are enforced again by database policies.</p></div><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-[#f5faf9] text-[#49656a]"><tr><th className="px-6 py-3 font-bold">Name</th><th className="px-6 py-3 font-bold">Current access</th><th className="px-6 py-3 font-bold">Change access</th></tr></thead><tbody>{users.map((user) => <tr key={user.id} className="border-t border-[#e3efec]"><td className="px-6 py-4"><p className="font-bold">{user.display_name}</p><p className="mt-1 font-mono text-xs text-[#697c82]">{user.id}</p></td><td className="px-6 py-4">{roleLabels[user.role]}</td><td className="px-6 py-4">{user.id === currentUserId || user.role === "admin" ? <span className="text-[#5d7078]">Protected administrator account</span> : <label><span className="sr-only">Change access for {user.display_name}</span><select className="field min-w-40" value={user.role} onChange={(event) => void changeRole(user.id, event.target.value as Exclude<Role, "admin">)}><option value="patient">Patient</option><option value="caregiver">Caregiver</option><option value="clinician">Clinician</option></select></label>}</td></tr>)}</tbody></table></div>{!loading && !users.length && <p className="p-6 text-[#5d7078]">No profiles are available.</p>}</div>
    <div className="card p-6"><p className="eyebrow">Caregiver links</p><h2 className="mt-2 text-xl font-bold">Assign a caregiver to a patient</h2><div className="mt-5 grid gap-4 md:grid-cols-3"><label><span className="label">Caregiver</span><select className="field" value={selectedCaregiver} onChange={(event) => setSelectedCaregiver(event.target.value)}><option value="">Choose caregiver</option>{caregivers.map((caregiver) => <option key={caregiver.id} value={caregiver.id}>{caregiver.display_name}</option>)}</select></label><label><span className="label">Patient</span><select className="field" value={selectedPatient} onChange={(event) => setSelectedPatient(event.target.value)}><option value="">Choose patient</option>{patientOptions.map((patient) => <option key={patient.id} value={patient.id}>{patient.profile?.display_name}</option>)}</select></label><div className="flex items-end"><button className="btn btn-primary w-full" disabled={!selectedCaregiver || !selectedPatient} onClick={() => void addAssignment()}>Create link</button></div></div><div className="mt-6 space-y-3">{assignments.length ? assignments.map((assignment) => { const caregiver = peopleById.get(assignment.caregiver_id); const patient = patientById.get(assignment.patient_id); const patientProfile = patient ? peopleById.get(patient.profile_id) : undefined; return <div key={`${assignment.caregiver_id}-${assignment.patient_id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#cfe2dd] p-4"><p><strong>{caregiver?.display_name || "Caregiver"}</strong> is linked to <strong>{patientProfile?.display_name || "Patient"}</strong></p><button className="btn btn-quiet" onClick={() => void removeAssignment(assignment)}>Remove link</button></div>; }) : <p className="text-[#5d7078]">No caregiver links have been created yet.</p>}</div></div>
    <div className="card p-6"><p className="eyebrow">Clinician access</p><h2 className="mt-2 text-xl font-bold">Assign a clinician to a patient</h2><p className="mt-2 text-sm text-[#5d7078]">Clinicians can only see updates for people explicitly assigned here.</p><div className="mt-5 grid gap-4 md:grid-cols-3"><label><span className="label">Clinician</span><select className="field" value={selectedClinician} onChange={(event) => setSelectedClinician(event.target.value)}><option value="">Choose clinician</option>{clinicians.map((clinician) => <option key={clinician.id} value={clinician.id}>{clinician.display_name}</option>)}</select></label><label><span className="label">Patient</span><select className="field" value={selectedClinicianPatient} onChange={(event) => setSelectedClinicianPatient(event.target.value)}><option value="">Choose patient</option>{patientOptions.map((patient) => <option key={patient.id} value={patient.id}>{patient.profile?.display_name}</option>)}</select></label><div className="flex items-end"><button className="btn btn-primary w-full" disabled={!selectedClinician || !selectedClinicianPatient} onClick={() => void addClinicianAssignment()}>Create link</button></div></div><div className="mt-6 space-y-3">{clinicianAssignments.length ? clinicianAssignments.map((assignment) => { const clinician = peopleById.get(assignment.clinician_id); const patient = patientById.get(assignment.patient_id); const patientProfile = patient ? peopleById.get(patient.profile_id) : undefined; return <div key={`${assignment.clinician_id}-${assignment.patient_id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#cfe2dd] p-4"><p><strong>{clinician?.display_name || "Clinician"}</strong> is assigned to <strong>{patientProfile?.display_name || "Patient"}</strong></p><button className="btn btn-quiet" onClick={() => void removeClinicianAssignment(assignment)}>Remove link</button></div>; }) : <p className="text-[#5d7078]">No clinician links have been created yet.</p>}</div></div>
    <div className="notice" role="note"><strong>Demo journey:</strong> assign the seeded clinician to the seeded patient, sign in as the caregiver and request a priority callback, then sign in as the clinician and select <em>Acknowledge</em>. The administrator pane is only for access and links; it cannot read care updates.</div>
  </section>;
}

function Check({ value, setValue, label }: { value: boolean; setValue: (value: boolean) => void; label: string }) {
  return <label className="mt-4 flex gap-3"><input type="checkbox" checked={value} onChange={(event) => setValue(event.target.checked)} /><span>{label}</span></label>;
}
