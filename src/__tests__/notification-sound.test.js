import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetNotificationSoundForTests,
  playNotificationSound,
} from "../utils/notificationSound";

const notification = {
  id: "notification-1",
  user_id: "user-1",
  type: "info",
  title: "Nueva orden",
  message: "La orden está lista.",
  metadata: { event_kind: "order_created" },
};

const installAudioContext = () => {
  const oscillators = [];
  const gains = [];
  window.AudioContext = vi.fn(function AudioContextMock() {
    return {
      state: "running",
      currentTime: 0,
      destination: {},
      createOscillator: () => {
        const oscillator = {
          frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        };
        oscillators.push(oscillator);
        return oscillator;
      },
      createGain: () => {
        const gain = {
          gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
        };
        gains.push(gain);
        return gain;
      },
    };
  });
  return { oscillators, gains };
};

describe("notification sound", () => {
  afterEach(() => {
    __resetNotificationSoundForTests();
    vi.restoreAllMocks();
    delete window.AudioContext;
  });

  it("plays a clearly audible two-voice bell once for the same notification event", () => {
    const { oscillators, gains } = installAudioContext();

    expect(playNotificationSound(notification)).toBe(true);
    expect(playNotificationSound(notification)).toBe(false);
    expect(oscillators).toHaveLength(2);
    expect(oscillators.every((oscillator) => oscillator.start.mock.calls.length === 1)).toBe(true);
    expect(oscillators.every((oscillator) => oscillator.stop.mock.calls.length === 1)).toBe(true);
    expect(gains[0].gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.16, 0.008);
  });

  it("treats the optimistic and realtime copies of one event as a single sound", () => {
    const { oscillators } = installAudioContext();

    expect(playNotificationSound({ ...notification, id: "local-toast-1" })).toBe(true);
    expect(playNotificationSound(notification)).toBe(false);
    expect(oscillators).toHaveLength(2);
  });
});
