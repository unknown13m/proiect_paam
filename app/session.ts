import AsyncStorage from "@react-native-async-storage/async-storage";

const USER_KEY = "morse_current_user_v1"; // "guest" sau nume

export async function setCurrentUser(username: string) {
  const u = username.trim() ? username.trim() : "guest";
  await AsyncStorage.setItem(USER_KEY, u);
}

export async function getCurrentUser(): Promise<string> {
  return (await AsyncStorage.getItem(USER_KEY)) ?? "guest";
}

export async function logout() {
  await AsyncStorage.removeItem(USER_KEY);
}
