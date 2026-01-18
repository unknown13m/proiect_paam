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


        

        {/* QUIZ */}
        {activeTab === "Quiz" && (
          <View style={styles.card}>
            <Text style={styles.cardText}>Quiz / Testare</Text>

            <ModeSelector value={quizMode} onChange={setQuizMode} label="Mod pentru Quiz" />

            {!quizRunning ? (
              <TouchableOpacity
                style={[styles.mainBtn, { marginTop: 14 }]}
                onPressIn={() => talk("Start quiz")}
                onPress={beginQuiz}
                accessibilityRole="button"
                accessibilityLabel="Start quiz"
                accessibilityHint="Pornește un test cu întrebări"
              >
                <Text style={styles.btnText}>START QUIZ</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ marginTop: 14 }}>
                <Text style={styles.quizTitle}>Identifică litera:</Text>
                <Text style={styles.quizHint}>
                  (Apasă „Repetă” ca să redea din nou Morse)
                </Text>

                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPressIn={() => talk("Repetă")}
                  onPress={() => playMorse(quizPromptLetter, quizMode)}
                  accessibilityRole="button"
                  accessibilityLabel="Repetă"
                >
                  <Text style={styles.secondaryBtnText}>REPETĂ</Text>
                </TouchableOpacity>

                <View style={{ marginTop: 10 }}>
                  {quizOptions.map((opt) => (
                    <TouchableOpacity
                      key={opt}
                      style={styles.optionBtn}
                      onPressIn={() => talk(`Opțiunea ${opt}`)}
                      onPress={() => answerQuiz(opt)}
                      accessibilityRole="button"
                      accessibilityLabel={`Răspuns ${opt}`}
                    >
                      <Text style={styles.optionText}>{opt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {!!quizMessage && <Text style={styles.quizMessage}>{quizMessage}</Text>}

                <View style={{ marginTop: 10 }}>
                  <Text style={styles.smallMuted}>Scor: {quizScore} | Streak: {quizStreak}</Text>
                  <Text style={styles.smallMuted}>
                    All-time: {quizStats.correct}/{quizStats.attempts} corecte | Best streak: {quizStats.bestStreak}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.secondaryBtn, { marginTop: 12 }]}
                  onPressIn={() => talk("Stop quiz")}
                  onPress={endQuiz}
                  accessibilityRole="button"
                  accessibilityLabel="Stop quiz"
                >
                  <Text style={styles.secondaryBtnText}>STOP QUIZ</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* SETARI */}
        {activeTab === "Setari" && (
          <View style={styles.card}>
            <Text style={styles.cardText}>Setări</Text>

            <View style={styles.row}>
              <Text style={styles.smallMuted}>Ghidare vocală (spune butoanele)</Text>
              <Switch
                value={voiceGuidance}
                onValueChange={(v) => {
                  setVoiceGuidance(v);
                  if (v) talk("Ghidare vocală activată");
                }}
                accessibilityLabel="Ghidare vocală"
              />
            </View>

            <Text style={styles.helpText}>
              Pentru citirea automată a interfeței:
              {"\n"}• Android: Settings → Accessibility → TalkBack
              {"\n"}• iOS: Settings → Accessibility → VoiceOver
              {"\n\n"}Ghidarea vocală din aplicație e suplimentară și spune numele butoanelor când le atingi.
            </Text>

            <TouchableOpacity
              style={[styles.secondaryBtn, { marginTop: 10 }]}
              onPressIn={() => talk("Logout")}
              onPress={async () => {
                // imi opreste orice redare
                stopPlayback();
                await logoutSession();
                router.replace("/");
              }}
              accessibilityRole="button"
              accessibilityLabel="Logout"
              accessibilityHint="Revii la ecranul de intrare"
            >
              <Text style={styles.secondaryBtnText}>LOGOUT</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* TAB BAR ridicat */}
      <View
        style={[
          styles.tabBar,
          {
            width,
            bottom: insets.bottom + 16,
          },
        ]}
      >
        {(["Translator", "Alfabet", "Progres", "Quiz", "Setari"] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={styles.tabItem}
            onPressIn={() => talk(`Tab ${t}`)}
            onPress={() => setActiveTab(t)}
            accessibilityRole="tab"
            accessibilityLabel={`Tab ${t}`}
            accessibilityState={{ selected: activeTab === t }}
          >
            <Text style={[styles.tabLabel, activeTab === t && { color: "#0ea5e9" }]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b1020" },
  content: { padding: 20, paddingTop: 48 },

  title: { color: "#38bdf8", fontSize: 28, fontWeight: "800", textAlign: "center", marginBottom: 8 },
  userLine: { color: "#94a3b8", textAlign: "center", marginBottom: 16 },
  userName: { color: "#e2e8f0", fontWeight: "800" },

  card: {
    backgroundColor: "#0f172a",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1f2937",
    marginBottom: 16,
  },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  cardText: { color: "#e2e8f0", fontSize: 16, fontWeight: "700" },

  smallLabel: { color: "#94a3b8", fontSize: 12, marginBottom: 6 },
  smallMuted: { color: "#cbd5e1", fontSize: 12 },

  input: {
    backgroundColor: "#111827",
    borderColor: "#1f2937",
    borderWidth: 1,
    borderRadius: 12,
    color: "#fff",
    paddingHorizontal: 14,
    paddingVertical: Platform.select({ ios: 14, android: 12 }),
    fontSize: 16,
    marginBottom: 12,
  },

  mainBtn: { backgroundColor: "#0ea5e9", paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "800" },

  secondaryBtn: {
    backgroundColor: "#111827",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
  },
  secondaryBtnText: { color: "#e2e8f0", fontWeight: "800" },

  modeSelector: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: "#111827",
    borderRadius: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  activeMode: { backgroundColor: "#0ea5e9", borderColor: "#0ea5e9" },
  modeLabel: { color: "#fff", fontSize: 10, fontWeight: "800" },

  letterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: "#111827",
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  letterText: { color: "#38bdf8", fontSize: 18, fontWeight: "900" },
  codeText: { color: "#fff", fontSize: 18, letterSpacing: 3 },

  statsCard: {
    backgroundColor: "#111827",
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  statsNum: { color: "#38bdf8", fontSize: 52, fontWeight: "900" },
  statsDesc: { color: "#cbd5e1", marginTop: 6 },

  helpText: { color: "#cbd5e1", marginTop: 10, lineHeight: 18 },

  // Quiz
  quizTitle: { color: "#e2e8f0", fontWeight: "800", marginTop: 8 },
  quizHint: { color: "#94a3b8", fontSize: 12, marginBottom: 10 },
  optionBtn: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1f2937",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 8,
  },
  optionText: { color: "#fff", fontWeight: "900", fontSize: 16 },
  quizMessage: { color: "#e2e8f0", marginTop: 8, fontWeight: "800", textAlign: "center" },

  // tab bar ridicat
  tabBar: {
    position: "absolute",
    height: 64,
    backgroundColor: "#050814",
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#1f2937",
    borderRadius: 14,
    marginHorizontal: 12,
    left: 0,
    right: 0,
    overflow: "hidden",
  },
  tabItem: { flex: 1, justifyContent: "center", alignItems: "center" },
  tabLabel: { color: "#94a3b8", fontSize: 12, fontWeight: "800" },
});


