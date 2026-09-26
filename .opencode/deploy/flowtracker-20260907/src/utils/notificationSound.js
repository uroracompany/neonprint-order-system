const SOUND_COOLDOWN_MS = 700;
const DEDUPE_WINDOW_MS = 2_000;
const MAX_RECENT_EVENTS = 120;

let audioContext = null;
let lastSoundAt = 0;
const recentEvents = new Map();

const getNotificationFingerprint = (notification) => [
  notification?.user_id || "",
  notification?.type || "",
  notification?.order_id || "",
  notification?.title || "",
  notification?.message || "",
  notification?.metadata?.event_kind || "",
].join("|");

const getAudioContext = () => {
  if (typeof window === "undefined") return null;
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) return null;
  if (!audioContext || audioContext.state === "closed") {
    try {
      audioContext = new AudioContextConstructor();
    } catch {
      return null;
    }
  }
  return audioContext;
};

const pruneRecentEvents = (now) => {
  recentEvents.forEach((timestamp, key) => {
    if (now - timestamp > DEDUPE_WINDOW_MS) recentEvents.delete(key);
  });
  while (recentEvents.size > MAX_RECENT_EVENTS) {
    recentEvents.delete(recentEvents.keys().next().value);
  }
};

const playBellVoice = (context, startAt, frequency, peakGain, duration) => {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startAt);
  oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.992, startAt + duration);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peakGain, startAt + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
};

const playBell = (context) => {
  const startAt = context.currentTime;

  // La fundamental y su armónico dan un timbre de campana nítido, audible sin ser estridente.
  playBellVoice(context, startAt, 1318.5, 0.16, 0.42);
  playBellVoice(context, startAt + 0.006, 2093, 0.12, 0.3);
};

export const unlockNotificationSound = () => {
  const context = getAudioContext();
  if (!context || context.state !== "suspended") return;
  context.resume().catch(() => {});
};

// Returns false when a browser blocks autoplay, the event is a duplicate, or audio is unavailable.
export const playNotificationSound = (notification) => {
  const now = Date.now();
  const fingerprint = getNotificationFingerprint(notification);
  const eventKeys = [
    notification?.id ? `id:${notification.id}` : null,
    fingerprint ? `fingerprint:${fingerprint}` : null,
  ].filter(Boolean);
  pruneRecentEvents(now);

  if (eventKeys.length === 0 || eventKeys.some((key) => recentEvents.has(key)) || now - lastSoundAt < SOUND_COOLDOWN_MS) return false;
  eventKeys.forEach((key) => recentEvents.set(key, now));
  lastSoundAt = now;

  const context = getAudioContext();
  if (!context) return false;

  if (context.state === "suspended") {
    context.resume().then(() => playBell(context)).catch(() => {});
    return true;
  }

  try {
    playBell(context);
    return true;
  } catch {
    return false;
  }
};

export const __resetNotificationSoundForTests = () => {
  audioContext = null;
  lastSoundAt = 0;
  recentEvents.clear();
};
