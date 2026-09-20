"use client";

import { useEffect, useRef, useState } from "react";

function supportedRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
    .find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

export function VoiceInput({ disabled, onTranscript, transcribe }: { disabled?: boolean; onTranscript: (transcript: string) => void; transcribe: (recording: Blob) => Promise<string> }) {
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [voiceConsent, setVoiceConsent] = useState(false);
  const [message, setMessage] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const browserMedia = typeof window === "undefined" ? undefined : (navigator as unknown as { mediaDevices?: { getUserMedia?: unknown } }).mediaDevices;
  const supported = Boolean(browserMedia?.getUserMedia && typeof MediaRecorder !== "undefined" && supportedRecorderMimeType());

  function stopStream() {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }

  useEffect(() => () => { recorder.current?.state === "recording" && recorder.current.stop(); stopStream(); }, []);

  async function startRecording() {
    if (!voiceConsent) return;
    try {
      const capture = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = supportedRecorderMimeType();
      if (!mimeType) { capture.getTracks().forEach((track) => track.stop()); setMessage("Voice recording is unavailable in this browser. You can type your update instead."); return; }
      chunks.current = [];
      stream.current = capture;
      const next = new MediaRecorder(capture, { mimeType });
      next.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      next.onerror = () => { stopStream(); setRecording(false); setMessage("Voice recording was unavailable. You can type your update instead."); };
      next.onstop = async () => {
        stopStream(); setRecording(false);
        const recordingBlob = new Blob(chunks.current, { type: mimeType.split(";", 1)[0] });
        if (!recordingBlob.size) { setMessage("No speech was recorded. Try again or type your update."); return; }
        setTranscribing(true); setMessage("Transcribing your recording…");
        try {
          const transcript = await transcribe(recordingBlob);
          onTranscript(transcript);
          setMessage("Voice text added to your update. You can edit it before sharing.");
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "We could not transcribe that recording. You can type your update instead.");
        } finally { setTranscribing(false); }
      };
      recorder.current = next;
      next.start();
      setRecording(true);
      setMessage("Recording… speak naturally, then stop and review the editable text.");
    } catch {
      setMessage("Microphone permission was not granted. You can type your update instead.");
    }
  }

  function toggleRecording() {
    if (recording) recorder.current?.stop();
    else void startRecording();
  }

  return <div className="mt-4 rounded-xl border border-dashed border-[#a8c3bd] p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold">Voice input (optional)</p><p className="mt-1 text-sm text-[#5d7078]">Voice recognition is provided by your browser or its speech provider. CareVoice does not store audio. Review the resulting text before sharing.</p></div><button type="button" className="btn btn-secondary w-full sm:w-auto" disabled={disabled || transcribing || !supported || (!voiceConsent && !recording)} aria-pressed={recording} onClick={toggleRecording}>{recording ? "Stop recording" : transcribing ? "Transcribing…" : "Start voice input"}</button></div><label className="mt-3 flex gap-3 text-sm"><input className="mt-1 shrink-0" type="checkbox" checked={voiceConsent} onChange={(event) => setVoiceConsent(event.target.checked)} disabled={disabled || recording || transcribing} /><span>I understand how voice recognition is provided and will review the editable text.</span></label>{!supported && <p className="mt-3 text-sm text-[#5d7078]">Voice recording is unavailable in this browser; typed input remains available.</p>}{message && <p className="mt-3 text-sm text-[#49656a]" aria-live="polite">{message}</p>}</div>;
}
