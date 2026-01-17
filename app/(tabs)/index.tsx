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

  

  // voce anunta cand mi se schimba un tab (internal talk)
  useEffect(() => {
    if (!voiceGuidance) return;
    Speech.stop();
    Speech.speak(`Tab ${activeTab}`, { language: "ro-RO", rate: 1.0 });
  }, [activeTab, voiceGuidance]);

  const talk = (phrase: string) => {
    if (!voiceGuidance) return;
    // dacă screen reader e activ gen mi l citește deja
    Speech.stop();
    Speech.speak(phrase, { language: "ro-RO", rate: 1.05, pitch: 1.0 });
  };

  async function ensureBeepLoaded() {
    if (soundRef.current) return;
    const { sound } = await Audio.Sound.createAsync(
      require("../../assets/ui_beep.wav"),
      { shouldPlay: false, volume: 1.0 }
    );
    soundRef.current = sound;
  }

  async function playBeep(durationMs: number) {
    await ensureBeepLoaded();
    const s = soundRef.current!;

    // dot/dash din același wav sa fie looping + stop
    await s.stopAsync().catch(() => {});
    await s.setPositionAsync(0).catch(() => {});
    await s.setIsLoopingAsync(durationMs > 160).catch(() => {});
    await s.playAsync().catch(() => {});
    await sleep(durationMs);
    await s.stopAsync().catch(() => {});
    await s.setIsLoopingAsync(false).catch(() => {});
  }

  function stopPlayback() {
    cancelRef.current = true;
    setIsFlashing(false);
    try {
      Vibration.cancel();
    } catch {}
    try {
      Speech.stop();
    } catch {}
  }

  async function triggerSignal(symbol: "." | "-", mode: Mode) {
    const dot = 130;
    const dash = 390;
    const duration = symbol === "." ? dot : dash;

    const doVibrate = mode === "vibrate" || mode === "multi";
    const doSound = mode === "sound" || mode === "multi";
    const doLight = mode === "light" || mode === "multi";

    if (cancelRef.current) return;

    if (doVibrate) Vibration.vibrate(duration);

    if (doSound) {
      await playBeep(duration);
    }

    if (doLight) {
      setIsFlashing(true);
      await sleep(duration);
      setIsFlashing(false);
    }

    // mi am bagat pauză intre simboluri
    await sleep(180);
  }

  function addPracticed(letter: string) {
    const L = letter.toUpperCase();
    if (!MORSE[L]) return;

    // zilnic
    setDaily((prev) => {
      const today = todayKey();
      const base = prev.day === today ? prev : { day: today, practiced: [] as string[] };
      if (base.practiced.includes(L)) return base;

      const next = { ...base, practiced: [...base.practiced, L].sort() };
      AsyncStorage.setItem(DAILY_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });

    // all-time sa fie per total luat progresul
    setAllTime((prev) => {
      if (prev.practiced.includes(L)) return prev;
      const next = { practiced: [...prev.practiced, L].sort() };
      AsyncStorage.setItem(ALLTIME_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  async function playMorse(input: string, mode: Mode) {
    if (!input) return;
    if (playingRef.current) return;

    playingRef.current = true;
    cancelRef.current = false;

    try {
      for (const raw of input.toUpperCase()) {
        if (cancelRef.current) break;

        const code = MORSE[raw];
        if (!code) continue;

        addPracticed(raw);

        for (const ch of code) {
          if (cancelRef.current) break;
          await triggerSignal(ch as "." | "-", mode);
        }

        // pauză si intre litere
        await sleep(260);
      }
    } finally {
      playingRef.current = false;
    }
  }

  function ModeSelector({
    value,
    onChange,
    label,
  }: {
    value: Mode;
    onChange: (m: Mode) => void;
    label: string;
  }) {
    const options: Mode[] = ["vibrate", "sound", "light", "multi"];
    return (
      <View style={{ marginTop: 12 }}>
        <Text style={styles.smallLabel}>{label}</Text>
        <View style={styles.modeSelector}>
          {options.map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.modeBtn, value === m && styles.activeMode]}
              onPressIn={() => talk(`Mod ${m}`)}
              onPress={() => onChange(m)}
              accessibilityRole="button"
              accessibilityLabel={`Alege modul ${m}`}
            >
              <Text style={styles.modeLabel}>{m.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  //aici imi fac partea de quizz
  function pickRandomLetter(exclude?: string) {
    const pool = exclude ? ALPHABET.filter((x) => x !== exclude) : ALPHABET;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function buildOptions(correct: string) {
    const set = new Set<string>([correct]);
    while (set.size < 4) set.add(pickRandomLetter(correct));
    const arr = Array.from(set);
    // shuffle
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  async function startQuizRound() {
    setQuizMessage("");
    const letter = pickRandomLetter();
    const options = buildOptions(letter);

    setQuizPromptLetter(letter);
    setQuizOptions(options);

    // imi reda morse pentru litera din întrebare
    await playMorse(letter, quizMode);
  }

  const beginQuiz = async () => {
    talk("Începe quiz");
    stopPlayback();
    setQuizRunning(true);
    setQuizScore(0);
    setQuizStreak(0);
    await startQuizRound();
  };

  const answerQuiz = async (answer: string) => {
    if (!quizRunning) return;

    const correct = answer === quizPromptLetter;

    // update parcurs
    setQuizStats((prev) => {
      const nextAttempts = prev.attempts + 1;
      const nextCorrect = prev.correct + (correct ? 1 : 0);
      const nextBest = Math.max(prev.bestStreak, correct ? quizStreak + 1 : 0);
      const next = { attempts: nextAttempts, correct: nextCorrect, bestStreak: nextBest };
      AsyncStorage.setItem(QUIZ_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });

    if (correct) {
      setQuizScore((s) => s + 1);
      setQuizStreak((s) => s + 1);
      setQuizMessage("Corect ✅");
      talk("Corect");
      Vibration.vibrate(80);
    } else {
      setQuizStreak(0);
      setQuizMessage(`Greșit ❌ Era: ${quizPromptLetter}`);
      talk(`Greșit. Era ${quizPromptLetter}`);
      Vibration.vibrate(350);
    }

    await sleep(500);
    await startQuizRound();
  };

  const endQuiz = () => {
    talk("Quiz oprit");
    stopPlayback();
    setQuizRunning(false);
    setQuizPromptLetter("");
    setQuizOptions([]);
    setQuizMessage("");
  };

  // aici numar literele
  const dailyCount = daily.practiced.length;
  const allTimeCount = allTime.practiced.length;

  //
  return (
    <View style={[styles.container, isFlashing && { backgroundColor: "#FFFFFF" }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 160 + insets.bottom }, // mi am pus spatiu pentru tabbar ridicat ca mi era prea sus
        ]}
      >
        <Text style={[styles.title, isFlashing && { color: "#000" }]} accessibilityRole="header">
          MorseAbility Pro
        </Text>

        <Text style={styles.userLine}>
          Utilizator: <Text style={styles.userName}>{currentUser}</Text>
        </Text>

        {/* TRANSLATOR */}
        {activeTab === "Translator" && (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.cardText}>Translator</Text>

              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text style={styles.smallMuted}>{isLive ? "LIVE" : "MANUAL"}</Text>
                <Switch
                  value={isLive}
                  onValueChange={(v) => {
                    setIsLive(v);
                    talk(v ? "Mod live" : "Mod manual");
                  }}
                  accessibilityLabel="Comută modul Live"
                />
              </View>
            </View>

            <TextInput
              value={text}
              onChangeText={(v) => {
                setText(v);
                if (isLive) {
                  const last = v.slice(-1);
                  playMorse(last, translatorMode);
                }
              }}
              style={styles.input}
              placeholder="Scrie aici..."
              placeholderTextColor="#9aa0a6"
              accessibilityLabel="Câmp de text"
              accessibilityHint="Scrie litere și aplicația redă Morse"
            />

            {!isLive && (
              <View style={{ gap: 10 }}>
                <TouchableOpacity
                  style={styles.mainBtn}
                  onPressIn={() => talk("Buton play mesaj")}
                  onPress={() => playMorse(text, translatorMode)}
                  accessibilityRole="button"
                  accessibilityLabel="Play mesaj"
                >
                  <Text style={styles.btnText}>PLAY MESAJ</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPressIn={() => talk("Buton stop")}
                  onPress={stopPlayback}
                  accessibilityRole="button"
                  accessibilityLabel="Stop"
                >
                  <Text style={styles.secondaryBtnText}>STOP</Text>
                </TouchableOpacity>
              </View>
            )}

            <ModeSelector value={translatorMode} onChange={setTranslatorMode} label="Mod pentru Translator" />
          </View>
        )}

        {/* ALFABET */}
        {activeTab === "Alfabet" && (
          <View style={styles.card}>
            <Text style={styles.cardText}>Alfabet complet (A–Z)</Text>
            <ModeSelector value={alphabetMode} onChange={setAlphabetMode} label="Mod pentru Alfabet" />

            <View style={{ marginTop: 14 }}>
              {ALPHABET.map((letter) => (
                <TouchableOpacity
                  key={letter}
                  style={styles.letterRow}
                  onPressIn={() => talk(`Literă ${letter}`)}
                  onPress={() => playMorse(letter, alphabetMode)}
                  accessibilityRole="button"
                  accessibilityLabel={`Literă ${letter}`}
                  accessibilityHint={`Cod Morse ${MORSE[letter]}`}
                >
                  <Text style={styles.letterText}>{letter}</Text>
                  <Text style={styles.codeText}>{MORSE[letter]}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* PROGRES */}
        {activeTab === "Progres" && (
          <View style={styles.card}>
            <Text style={styles.cardText}>Progres</Text>

            <View style={styles.statsCard}>
              <Text style={styles.statsNum}>{dailyCount}</Text>
              <Text style={styles.statsDesc}>Litere unice exersate azi</Text>
              <Text style={styles.smallMuted}>
                Azi: {daily.practiced.length ? daily.practiced.join(", ") : "—"}
              </Text>
            </View>

            <View style={[styles.statsCard, { marginTop: 12 }]}>
              <Text style={styles.statsNum}>{allTimeCount}</Text>
              <Text style={styles.statsDesc}>Litere unice exersate all-time</Text>
              <Text style={styles.smallMuted}>
                All-time: {allTime.practiced.length ? allTime.practiced.join(", ") : "—"}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.secondaryBtn, { marginTop: 14 }]}
              onPressIn={() => talk("Reset progres azi")}
              onPress={async () => {
                const fresh = { day: todayKey(), practiced: [] as string[] };
                setDaily(fresh);
                await AsyncStorage.setItem(DAILY_KEY, JSON.stringify(fresh));
              }}
              accessibilityRole="button"
              accessibilityLabel="Resetează progresul de azi"
            >
              <Text style={styles.secondaryBtnText}>RESETEAZĂ AZI</Text>
            </TouchableOpacity>
          </View>
        )}
        