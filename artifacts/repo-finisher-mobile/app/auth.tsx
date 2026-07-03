import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { KeyboardAwareScrollViewCompat as KeyboardAwareScrollView } from "@/components/KeyboardAwareScrollViewCompat";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { PrimaryButton } from "@/components/UI";

export default function AuthScreen() {
  const colors = useColors();
  const router = useRouter();
  const { session } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (session) router.replace("/dashboard");
  }, [session, router]);

  async function submit() {
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        setMessage("Account created. Check your inbox to confirm your email if required, then sign in.");
        setMode("signin");
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        router.replace("/dashboard");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAwareScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.wrap}
    >
      <View style={styles.brand}>
        <View style={[styles.dot, { backgroundColor: colors.primary }]} />
        <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 14 }}>
          repo_finisher
        </Text>
      </View>

      <Text style={[styles.title, { color: colors.foreground }]}>
        {mode === "signin" ? "Sign in" : "Create account"}
      </Text>
      <Text style={{ color: colors.mutedForeground, marginTop: 4, fontSize: 14 }}>
        {mode === "signin"
          ? "Welcome back. Let's audit that GitHub."
          : "Start finding what you can ship."}
      </Text>

      <View style={{ marginTop: 24, gap: 14 }}>
        <View>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Email</Text>
          <TextInputField
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>
        <View>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Password</Text>
          <TextInputField value={password} onChangeText={setPassword} secureTextEntry />
        </View>

        {error && <Text style={{ color: colors.destructive, fontSize: 13 }}>{error}</Text>}
        {message && <Text style={{ color: colors.primary, fontSize: 13 }}>{message}</Text>}

        <PrimaryButton
          label={mode === "signin" ? "Sign in" : "Create account"}
          onPress={submit}
          loading={loading}
          disabled={!email || password.length < 6}
        />
      </View>

      <Text
        onPress={() => setMode(mode === "signin" ? "signup" : "signin")}
        style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 20 }}
      >
        {mode === "signin" ? "No account? Create one →" : "Already have an account? Sign in →"}
      </Text>
    </KeyboardAwareScrollView>
  );
}

function TextInputField(props: TextInputProps) {
  const colors = useColors();
  return (
    <TextInput
      {...props}
      placeholderTextColor={colors.mutedForeground}
      style={[
        styles.input,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          color: colors.foreground,
          borderRadius: colors.radius,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, paddingVertical: 60 },
  brand: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 24 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold" },
  label: { fontSize: 12, marginBottom: 6, fontFamily: "Inter_500Medium" },
  input: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
});
