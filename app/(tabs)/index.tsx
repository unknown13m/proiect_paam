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
