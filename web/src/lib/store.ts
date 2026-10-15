/**
 * Workouts and settings, kept in this browser (localStorage). Nothing here leaves the device except
 * the measured numbers sent to the coach.
 */
import { useSyncExternalStore } from "react";
import type { SetSummary } from "../engine/summary";
import type { ExerciseId, RepRecord } from "../engine/types";

export type CoachStyle = "calm" | "hype" | "drill" | "science";
export type Goal = "strength" | "endurance" | "technique" | "general";

export interface Settings {
  name: string;
  style: CoachStyle;
  goal: Goal;
  voice: boolean;
  autoEndS: number; // end a set after this many idle seconds
  quality: "lite" | "full";
  mirror: boolean;
}

export interface CoachSet {
  headline: string;
  feedback: string;
  fixes: { issue: string; cue: string }[];
  next_target: number;
  unit: "reps" | "seconds";
  rest_seconds: number;
  focus: string;
}

export interface CoachSession {
  title: string;
  summary: string;
  wins: string[];
  work_on: string[];
  next_session: { when: string; plan: { exercise: ExerciseId; sets: number; target: number }[]; note: string };
}

export interface CoachReply<T> {
  source: "ai" | "offline";
  model?: string;
  reason?: string;
  coach: T;
}

export interface SetRecord {
  id: string;
  exercise: ExerciseId;
  startedAt: number;
  endedAt: number;
  reps: RepRecord[];
  summary: SetSummary;
  target?: number;
  coach?: CoachReply<CoachSet>;
}

export interface Session {
  id: string;
  startedAt: number;
  endedAt?: number;
  sets: SetRecord[];
  debrief?: CoachReply<CoachSession>;
}

const KEYS = { sessions: "replicai.v2.sessions", settings: "replicai.v2.settings" };
export const DEFAULT_SETTINGS: Settings = { name: "", style: "calm", goal: "general", voice: true, autoEndS: 8, quality: "full", mirror: true };

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // private mode or storage full: the app keeps working for this visit
  }
}

let sessions: Session[] = read<Session[]>(KEYS.sessions, []);
let settings: Settings = { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(KEYS.settings, {}) };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export const useSessions = () => useSyncExternalStore(subscribe, () => sessions);
export const useSettings = () => useSyncExternalStore(subscribe, () => settings);
export const getSessions = () => sessions;
export const getSettings = () => settings;

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function saveSession(s: Session) {
  sessions = [s, ...sessions.filter((x) => x.id !== s.id)].sort((a, b) => b.startedAt - a.startedAt);
  write(KEYS.sessions, sessions);
  emit();
}

export function deleteSession(id: string) {
  sessions = sessions.filter((s) => s.id !== id);
  write(KEYS.sessions, sessions);
  emit();
}

export function updateSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  write(KEYS.settings, settings);
  emit();
}

export function exportJson(): string {
  return JSON.stringify({ app: "replicai", version: 2, exportedAt: new Date().toISOString(), settings, sessions }, null, 1);
}

/** Merges an export into this browser's data. Returns how many workouts were added or updated. */
export function importJson(text: string): number {
  const data = JSON.parse(text) as { app?: string; sessions?: Session[] };
  if (data.app !== "replicai" || !Array.isArray(data.sessions)) throw new Error("This is not a ReplicAI export file.");
  const byId = new Map(sessions.map((s) => [s.id, s]));
  let n = 0;
  for (const s of data.sessions) {
    if (s && typeof s.id === "string" && Array.isArray(s.sets) && typeof s.startedAt === "number") {
      byId.set(s.id, s);
      n++;
    }
  }
  sessions = [...byId.values()].sort((a, b) => b.startedAt - a.startedAt);
  write(KEYS.sessions, sessions);
  emit();
  return n;
}

export function clearAll() {
  sessions = [];
  write(KEYS.sessions, sessions);
  emit();
}
