/** Spoken cues through the browser's own speech engine (works offline, nothing to install). */
let enabled = true;
let lastAt = 0;
let voice: SpeechSynthesisVoice | null = null;

const synth = () => (typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null);

function pickVoice() {
  const s = synth();
  if (!s) return;
  const vs = s.getVoices().filter((v) => v.lang.startsWith("en"));
  voice = vs.find((v) => /natural|neural|google|samantha|daniel/i.test(v.name)) ?? vs[0] ?? null;
}
if (synth()) {
  pickVoice();
  synth()!.addEventListener?.("voiceschanged", pickVoice);
}

export function setVoiceEnabled(on: boolean) {
  enabled = on;
  if (!on) synth()?.cancel();
}

/**
 * Says something. `urgent` cuts off whatever is being said (rep counts must not lag behind the reps);
 * otherwise it is skipped if something was said in the last `gapMs`.
 */
export function say(text: string, { urgent = false, gapMs = 0 } = {}) {
  const s = synth();
  if (!s || !enabled || !text) return;
  const now = Date.now();
  if (!urgent && now - lastAt < gapMs) return;
  if (urgent) s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.rate = 1.08;
  s.speak(u);
  lastAt = now;
}

export function stopSpeaking() {
  synth()?.cancel();
}
