"use client";

import { useEffect, useRef, useState } from "react";

type RecognitionEvent = { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> };
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};
type RecognitionConstructor = new () => Recognition;

function getRecognitionConstructor(): RecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  const browserWindow = window as typeof window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition;
}

export function VoiceInput({ disabled, onTranscript }: { disabled?: boolean; onTranscript: (transcript: string) => void }) {
  const recognition = useRef<Recognition | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceConsent, setVoiceConsent] = useState(false);
  const [message, setMessage] = useState("");
  const supported = Boolean(getRecognitionConstructor());

  useEffect(() => () => recognition.current?.stop(), []);

  function toggleListening() {
    if (listening) { recognition.current?.stop(); return; }
    const Constructor = getRecognitionConstructor();
    if (!Constructor) { setMessage("Voice input is not supported in this browser. You can type your update instead."); return; }

    const next = new Constructor();
    next.continuous = true;
    next.interimResults = false;
    next.lang = navigator.language || "en-IN";
    next.onresult = (event) => {
      const transcript = Array.from(event.results).slice(event.resultIndex).flatMap((result) => Array.from(result)).map((result) => result.transcript).join(" ").trim();
      if (transcript) onTranscript(transcript);
      setMessage(transcript ? "Voice text added to your update. You can edit it before sharing." : "No speech was detected. Try again or type your update.");
    };
    next.onerror = (event) => {
      setMessage(event.error === "not-allowed" ? "Microphone permission was not granted. You can type your update instead." : "Voice input was unavailable. You can type your update instead.");
    };
    next.onend = () => setListening(false);
    recognition.current = next;
    setMessage("Listening… speak naturally, then review the text before sharing.");
    setListening(true);
    next.start();
  }

  return <div className="mt-4 rounded-xl border border-dashed border-[#a8c3bd] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-bold">Voice input (optional)</p><p className="mt-1 text-sm text-[#5d7078]">Voice recognition is provided by your browser or its speech provider. CareVoice does not store audio. Review the resulting text before sharing.</p></div><button type="button" className="btn btn-secondary" disabled={disabled || !supported || (!voiceConsent && !listening)} aria-pressed={listening} onClick={toggleListening}>{listening ? "Stop voice input" : "Start voice input"}</button></div><label className="mt-3 flex gap-3 text-sm"><input type="checkbox" checked={voiceConsent} onChange={(event) => setVoiceConsent(event.target.checked)} disabled={disabled || listening} /><span>I understand how voice recognition is provided and will review the editable text.</span></label>{!supported && <p className="mt-3 text-sm text-[#5d7078]">Voice input is unavailable in this browser; typed input remains available.</p>}{message && <p className="mt-3 text-sm text-[#49656a]" aria-live="polite">{message}</p>}</div>;
}
