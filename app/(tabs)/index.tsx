import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Vibration,
  ScrollView,
  Switch,
  useWindowDimensions,
  Platform,
  AccessibilityInfo,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Speech from "expo-speech";
import { Audio } from "expo-av";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getCurrentUser, logout as logoutSession } from "../session";

type Mode = "vibrate" | "sound" | "light" | "multi";
type Tab = "Translator" | "Alfabet" | "Progres" | "Quiz" | "Setari";

const MORSE: Record<string, string> = {
  A: ".-",
  B: "-...",
  C: "-.-.",
  D: "-..",
  E: ".",
  F: "..-.",
  G: "--.",
  H: "....",
  I: "..",
  J: ".---",
  K: "-.-",
  L: ".-..",
  M: "--",
  N: "-.",
  O: "---",
  P: ".--.",
  Q: "--.-",
  R: ".-.",
  S: "...",
  T: "-",
  U: "..-",
  V: "...-",
  W: ".--",
  X: "-..-",
  Y: "-.--",
  Z: "--..",
};

const ALPHABET = Object.keys(MORSE).sort();

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function todayKey() {
  // YYYY-MM-DD (local)
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function MorseTabs() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [activeTab, setActiveTab] = useState<Tab>("Translator");

  const [currentUser, setCurrentUserState] = useState<string>("guest");

  const [text, setText] = useState("");
  const [isLive, setIsLive] = useState(true);

  const [translatorMode, setTranslatorMode] = useState<Mode>("vibrate");
  const [alphabetMode, setAlphabetMode] = useState<Mode>("vibrate");
  const [quizMode, setQuizMode] = useState<Mode>("vibrate");

  const [isFlashing, setIsFlashing] = useState(false);

  // Voice guidance intern (pe lângă TalkBack/VoiceOver)
  const [voiceGuidance, setVoiceGuidance] = useState(false);

  // aici am statistici zilnice + all-time  (per user)
  const [daily, setDaily] = useState<{ day: string; practiced: string[] }>({
    day: todayKey(),
    practiced: [],
  });
  const [allTime, setAllTime] = useState<{ practiced: string[] }>({ practiced: [] });

  // Quiz stats per user
  const [quizStats, setQuizStats] = useState<{
    attempts: number;
    correct: number;
    bestStreak: number;
  }>({ attempts: 0, correct: 0, bestStreak: 0 });

  // Quiz runtime
  const [quizRunning, setQuizRunning] = useState(false);
  const [quizPromptLetter, setQuizPromptLetter] = useState<string>("");
  const [quizOptions, setQuizOptions] = useState<string[]>([]);
  const [quizScore, setQuizScore] = useState(0);
  const [quizStreak, setQuizStreak] = useState(0);
  const [quizMessage, setQuizMessage] = useState<string>("");

  // Playback locks
  const playingRef = useRef(false);
  const cancelRef = useRef(false);

  // Beep audio (re-used)
  const soundRef = useRef<Audio.Sound | null>(null);

  // Per-user storage keys
  const DAILY_KEY = useMemo(() => `morse_daily_v1_${currentUser}`, [currentUser]);
  const ALLTIME_KEY = useMemo(() => `morse_alltime_v1_${currentUser}`, [currentUser]);
  const QUIZ_KEY = useMemo(() => `morse_quiz_v1_${currentUser}`, [currentUser]);

  const isScreenReaderRef = useRef(false);

  useEffect(() => {
    // Detect screen reader
    const init = async () => {
      try {
        const enabled = await AccessibilityInfo.isScreenReaderEnabled();
        isScreenReaderRef.current = !!enabled;
      } catch {}
    };
    init();
    const sub = AccessibilityInfo.addEventListener?.("screenReaderChanged", (enabled) => {
      isScreenReaderRef.current = !!enabled;
    });
    return () => {
      // @ts-ignore
      sub?.remove?.();
    };
  }, []);

  // Load current user
  useEffect(() => {
    (async () => {
      const u = await getCurrentUser();
      setCurrentUserState(u || "guest");
    })().catch(() => {});
  }, []);

  // Configure audio mode + cleanup
  useEffect(() => {
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true }).catch(() => {});
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
    };
  }, []);

  // Load stats for user
  useEffect(() => {
    const load = async () => {
      try {
        const today = todayKey();

        // daily
        const savedDaily = await AsyncStorage.getItem(DAILY_KEY);
        if (savedDaily) {
          const parsed = JSON.parse(savedDaily) as { day: string; practiced: string[] };
          if (parsed.day !== today) {
            const fresh = { day: today, practiced: [] as string[] };
            setDaily(fresh);
            await AsyncStorage.setItem(DAILY_KEY, JSON.stringify(fresh));
          } else {
            setDaily({
              day: parsed.day,
              practiced: Array.isArray(parsed.practiced) ? parsed.practiced : [],
            });
          }
        } else {
          const fresh = { day: today, practiced: [] as string[] };
          setDaily(fresh);
          await AsyncStorage.setItem(DAILY_KEY, JSON.stringify(fresh));
        }

        // all-time
        const savedAll = await AsyncStorage.getItem(ALLTIME_KEY);
        if (savedAll) {
          const parsed = JSON.parse(savedAll) as { practiced: string[] };
          setAllTime({ practiced: Array.isArray(parsed.practiced) ? parsed.practiced : [] });
        } else {
          const fresh = { practiced: [] as string[] };
          setAllTime(fresh);
          await AsyncStorage.setItem(ALLTIME_KEY, JSON.stringify(fresh));
        }

        // quiz stats
        const savedQuiz = await AsyncStorage.getItem(QUIZ_KEY);
        if (savedQuiz) {
          const parsed = JSON.parse(savedQuiz) as {
            attempts: number;
            correct: number;
            bestStreak: number;
          };
          setQuizStats({
            attempts: Number(parsed.attempts) || 0,
            correct: Number(parsed.correct) || 0,
            bestStreak: Number(parsed.bestStreak) || 0,
          });
        } else {
          const fresh = { attempts: 0, correct: 0, bestStreak: 0 };
          setQuizStats(fresh);
          await AsyncStorage.setItem(QUIZ_KEY, JSON.stringify(fresh));
        }
      } catch {}
    };

    load();
  }, [DAILY_KEY, ALLTIME_KEY, QUIZ_KEY]);