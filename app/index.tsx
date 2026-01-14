import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import { setCurrentUser, getCurrentUser } from "./session";
import * as Speech from "expo-speech";

export default function EntryScreen() {
  const [name, setName] = useState("");
  const [lastUser, setLastUser] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const u = await getCurrentUser();
      // dacă e "guest" nu îl considerăm last user
      if (u && u !== "guest") setLastUser(u);
    })().catch(() => {});
  }, []);

  const continueAsUser = async () => {
    const trimmed = name.trim();
    await setCurrentUser(trimmed || (lastUser ?? "guest"));
    router.replace("/(tabs)");
  };

  const continueAsGuest = async () => {
    await setCurrentUser("guest");
    router.replace("/(tabs)");
  };

  const quickContinueLastUser = async () => {
    if (!lastUser) return;
    await setCurrentUser(lastUser);
    router.replace("/(tabs)");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        MorseAbility Pro
      </Text>

      <Text style={styles.subtitle}>
        Intră ca utilizator (progres salvat) sau ca guest
      </Text>

      {lastUser ? (
        <Pressable
          style={({ pressed }) => [styles.btnSecondary, pressed && { opacity: 0.85 }]}
          onPress={quickContinueLastUser}
          onPressIn={() => Speech.speak(`Continuă ca ${lastUser}`, { language: "ro-RO", rate: 1.05 })}
          accessibilityRole="button"
          accessibilityLabel={`Continuă ca ${lastUser}`}
          accessibilityHint="Intră cu ultimul utilizator salvat"
        >
          <Text style={styles.btnTextSecondary}>CONTINUĂ CA {lastUser.toUpperCase()}</Text>
        </Pressable>
      ) : null}

      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Nume utilizator (ex: Paula)"
        placeholderTextColor="#8a8a8a"
        style={styles.input}
        accessibilityLabel="Câmp nume utilizator"
        accessibilityHint="Scrie un nume ca să îți salvăm progresul"
      />

      <Pressable
        style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
        onPress={continueAsUser}
        onPressIn={() =>
          Speech.speak("Continuă ca utilizator", { language: "ro-RO", rate: 1.05 })
        }
        accessibilityRole="button"
        accessibilityLabel="Continuă ca utilizator"
        accessibilityHint="Intră și salvează progresul pe nume"
      >
        <Text style={styles.btnText}>CONTINUĂ CA USER</Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.btnSecondary, pressed && { opacity: 0.85 }]}
        onPress={continueAsGuest}
        onPressIn={() => Speech.speak("Intră ca guest", { language: "ro-RO", rate: 1.05 })}
        accessibilityRole="button"
        accessibilityLabel="Intră ca guest"
        accessibilityHint="Intră fără cont"
      >
        <Text style={styles.btnTextSecondary}>INTRĂ CA GUEST</Text>
      </Pressable>

      <Text style={styles.note}>
        Pentru citirea automată a butoanelor: activează TalkBack (Android) sau VoiceOver (iOS).
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b1020", padding: 24, justifyContent: "center" },
  title: { color: "#38bdf8", fontSize: 32, fontWeight: "800", textAlign: "center", marginBottom: 10 },
  subtitle: { color: "#cbd5e1", textAlign: "center", marginBottom: 18 },

  input: {
    backgroundColor: "#111827",
    borderColor: "#1f2937",
    borderWidth: 1,
    borderRadius: 12,
    color: "#fff",
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 14,
  },

  btn: { backgroundColor: "#0ea5e9", paddingVertical: 14, borderRadius: 12, alignItems: "center", marginBottom: 10 },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 16, letterSpacing: 0.5 },

  btnSecondary: {
    backgroundColor: "#111827",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 10,
  },
  btnTextSecondary: { color: "#e2e8f0", fontWeight: "800", fontSize: 14, letterSpacing: 0.4 },

  note: { color: "#94a3b8", fontSize: 12, textAlign: "center", marginTop: 10, lineHeight: 16 },
});
