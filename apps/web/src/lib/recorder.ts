"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice recorder built on MediaRecorder + Web Audio AnalyserNode.
 * The waveform/ring visuals read REAL signal levels from `levelRef`/`barsRef`
 * (updated in a rAF loop without React re-renders). Nothing is simulated: if
 * the analyser is unavailable the visuals stay flat.
 */

export type RecorderStatus = "idle" | "requesting" | "recording" | "paused" | "recorded" | "error";
export type RecorderError = "denied" | "no-device" | "unsupported" | "failed" | "too-short";

export const MAX_RECORDING_MS = 5 * 60_000;
const MIN_RECORDING_MS = 1500;
export const BAR_COUNT = 56;

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm", "audio/aac"];

export interface RecordingResult {
  blob: Blob;
  url: string;
  durationMs: number;
  mime: string;
}

export function isRecorderSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof window.MediaRecorder !== "undefined"
  );
}

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return MIME_CANDIDATES.find((m) => {
    try {
      return MediaRecorder.isTypeSupported(m);
    } catch {
      return false;
    }
  });
}

function errorFromException(e: unknown): Exclude<RecorderError, "too-short"> {
  const name = (e as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return "no-device";
  return "failed";
}

type AudioContextCtor = typeof AudioContext;

export interface RecorderCallbacks {
  maxMs?: number;
  onAutoStop?: () => void;
  onTooShort?: () => void;
  onRecorded?: (r: RecordingResult) => void;
  onError?: (e: Exclude<RecorderError, "too-short">) => void;
}

export function useRecorder(opts: RecorderCallbacks = {}) {
  const maxMs = opts.maxMs ?? MAX_RECORDING_MS;
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [error, setError] = useState<RecorderError | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<RecordingResult | null>(null);

  const levelRef = useRef(0);
  const barsRef = useRef<number[]>(new Array(BAR_COUNT).fill(0));

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const resumedAtRef = useRef(0);
  const accumulatedRef = useRef(0);
  const cancelledRef = useRef(false);
  const mimeRef = useRef<string | undefined>(undefined);
  const resultUrlRef = useRef<string | null>(null);
  const callbacksRef = useRef<RecorderCallbacks>(opts);
  useEffect(() => {
    callbacksRef.current = opts;
  });

  const canPause = typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined" && typeof MediaRecorder.prototype.pause === "function";

  const fail = useCallback((e: Exclude<RecorderError, "too-short">) => {
    setError(e);
    setStatus("error");
    callbacksRef.current.onError?.(e);
  }, []);

  const currentElapsed = useCallback(() => {
    const rec = recorderRef.current;
    const running = rec?.state === "recording";
    return accumulatedRef.current + (running ? performance.now() - resumedAtRef.current : 0);
  }, []);

  const stopLoops = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  }, []);

  const releaseDevices = useCallback(() => {
    stopLoops();
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    analyserRef.current = null;
    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx && ctx.state !== "closed") ctx.close().catch(() => undefined);
    levelRef.current = 0;
  }, [stopLoops]);

  const revokeResult = useCallback(() => {
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = null;
  }, []);

  useEffect(
    () => () => {
      cancelledRef.current = true;
      try {
        if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      } catch {
        /* ignore */
      }
      releaseDevices();
      revokeResult();
    },
    [releaseDevices, revokeResult],
  );

  const startLevelLoop = useCallback(() => {
    const analyser = analyserRef.current;
    const data = analyser ? new Uint8Array(analyser.fftSize) : null;
    let lastBarAt = 0;
    const loop = (now: number) => {
      const rec = recorderRef.current;
      const paused = rec?.state === "paused";
      let level = 0;
      if (analyser && data) {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i]! - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        // Speech RMS is roughly 0.02–0.3; map to 0–1 with a soft knee.
        level = Math.min(1, Math.pow(rms * 4, 0.8));
      }
      const target = paused ? 0 : level;
      levelRef.current = levelRef.current * 0.72 + target * 0.28;
      if (now - lastBarAt >= 55) {
        lastBarAt = now;
        const bars = barsRef.current;
        bars.shift();
        bars.push(paused ? 0 : level);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const finalize = useCallback(
    (rec: MediaRecorder, durationMs: number) => {
      releaseDevices();
      if (cancelledRef.current) {
        chunksRef.current = [];
        return;
      }
      const type = rec.mimeType || mimeRef.current || chunksRef.current[0]?.type || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      if (durationMs < MIN_RECORDING_MS || blob.size < 1500) {
        setError(null);
        setElapsedMs(0);
        setStatus("idle");
        callbacksRef.current.onTooShort?.();
        return;
      }
      revokeResult();
      const url = URL.createObjectURL(blob);
      resultUrlRef.current = url;
      const recording: RecordingResult = { blob, url, durationMs, mime: type };
      setResult(recording);
      setElapsedMs(durationMs);
      setStatus("recorded");
      callbacksRef.current.onRecorded?.(recording);
    },
    [releaseDevices, revokeResult],
  );

  const stop = useCallback(
    (auto = false) => {
      const rec = recorderRef.current;
      if (!rec || rec.state === "inactive") return;
      const durationMs = Math.min(currentElapsed(), maxMs);
      accumulatedRef.current = durationMs;
      rec.onstop = () => finalize(rec, durationMs);
      try {
        rec.requestData?.();
      } catch {
        /* optional */
      }
      rec.stop();
      stopLoops();
      if (auto) callbacksRef.current.onAutoStop?.();
    },
    [currentElapsed, finalize, maxMs, stopLoops],
  );

  const start = useCallback(async (): Promise<boolean> => {
    if (!isRecorderSupported()) {
      fail("unsupported");
      return false;
    }
    revokeResult();
    setResult(null);
    setError(null);
    setElapsedMs(0);
    barsRef.current = new Array(BAR_COUNT).fill(0);
    cancelledRef.current = false;
    chunksRef.current = [];
    accumulatedRef.current = 0;
    setStatus("requesting");

    // Create the AudioContext synchronously inside the user gesture (iOS requirement).
    try {
      const Ctor: AudioContextCtor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
      ctxRef.current = Ctor ? new Ctor() : null;
    } catch {
      ctxRef.current = null;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (e) {
      releaseDevices();
      fail(errorFromException(e));
      return false;
    }
    if (cancelledRef.current) {
      stream.getTracks().forEach((tr) => tr.stop());
      return false;
    }
    streamRef.current = stream;

    const ctx = ctxRef.current;
    if (ctx) {
      try {
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.5;
        source.connect(analyser); // not connected to destination — no echo
        analyserRef.current = analyser;
        if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
      } catch {
        analyserRef.current = null;
      }
    }

    const mime = pickMime();
    mimeRef.current = mime;
    let rec: MediaRecorder;
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64_000 }) : new MediaRecorder(stream);
    } catch {
      try {
        rec = new MediaRecorder(stream);
        mimeRef.current = undefined;
      } catch (e) {
        releaseDevices();
        fail(errorFromException(e) === "denied" ? "denied" : "unsupported");
        return false;
      }
    }
    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    rec.onerror = () => {
      releaseDevices();
      fail("failed");
    };
    // The browser/OS may stop the microphone by itself (permission revoked, headset unplugged,
    // app sent to background on iOS) — MediaRecorder then stops on its own. Keep what was
    // recorded instead of hanging in "recording". stop()/cancel() replace this handler.
    rec.onstop = () => {
      if (cancelledRef.current) return;
      const durationMs = Math.min(currentElapsed(), maxMs);
      accumulatedRef.current = durationMs;
      stopLoops();
      finalize(rec, durationMs);
    };
    stream.getAudioTracks().forEach((track) => {
      track.addEventListener("ended", () => {
        const r = recorderRef.current;
        if (r === rec && r.state !== "inactive") stop(false);
      });
    });
    recorderRef.current = rec;
    try {
      rec.start(1000);
    } catch (e) {
      releaseDevices();
      fail(errorFromException(e));
      return false;
    }
    resumedAtRef.current = performance.now();
    setStatus("recording");
    startLevelLoop();
    tickRef.current = setInterval(() => {
      const ms = currentElapsed();
      setElapsedMs(ms);
      if (ms >= maxMs) stop(true);
    }, 200);
    return true;
  }, [currentElapsed, fail, finalize, maxMs, releaseDevices, revokeResult, startLevelLoop, stop, stopLoops]);

  const pause = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec || rec.state !== "recording" || !canPause) return;
    try {
      rec.pause();
      accumulatedRef.current += performance.now() - resumedAtRef.current;
      setStatus("paused");
    } catch {
      /* some WebViews expose pause() but throw */
    }
  }, [canPause]);

  const resume = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec || rec.state !== "paused") return;
    try {
      rec.resume();
      resumedAtRef.current = performance.now();
      setStatus("recording");
    } catch {
      /* ignore */
    }
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.onstop = () => {
        chunksRef.current = [];
      };
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    releaseDevices();
    revokeResult();
    setResult(null);
    setError(null);
    setElapsedMs(0);
    setStatus("idle");
  }, [releaseDevices, revokeResult]);

  const reset = useCallback(() => {
    revokeResult();
    setResult(null);
    setError(null);
    setElapsedMs(0);
    barsRef.current = new Array(BAR_COUNT).fill(0);
    setStatus("idle");
  }, [revokeResult]);

  return { status, error, elapsedMs, result, levelRef, barsRef, canPause, maxMs, start, stop: () => stop(false), pause, resume, cancel, reset };
}

export type Recorder = ReturnType<typeof useRecorder>;
