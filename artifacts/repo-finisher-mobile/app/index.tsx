import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ScrollView, StyleSheet, Text, View, Pressable } from "react-native";

import { useColors } from "@/hooks/useColors";

const FEATURES: { icon: keyof typeof Feather.glyphMap; title: string; desc: string; color: "ship" | "combine" | "repurpose" }[] = [
  {
    icon: "play-circle",
    title: "Finish",
    desc: "The repos that are 80% done. We list exactly what's missing to ship.",
    color: "ship",
  },
  {
    icon: "git-merge",
    title: "Combine",
    desc: "Repos that individually go nowhere — but together become a product.",
    color: "combine",
  },
  {
    icon: "zap",
    title: "Repurpose",
    desc: "Repositioning old code as a marketable tool, library, or SaaS.",
    color: "repurpose",
  },
];

export default function Landing() {
  const colors = useColors();
  const router = useRouter();

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
    >
      <View style={styles.header}>
        <View style={styles.brand}>
          <View style={[styles.dot, { backgroundColor: colors.primary }]} />
          <Text style={[styles.brandText, { color: colors.foreground }]}>repo_finisher</Text>
        </View>
        <Pressable
          style={[styles.signInBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
          onPress={() => router.push("/auth")}
        >
          <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
            Sign in
          </Text>
        </Pressable>
      </View>

      <View style={styles.hero}>
        <View style={[styles.pill, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Feather name="zap" size={12} color={colors.primary} />
          <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: "Inter_500Medium" }}>
            AI audit of your GitHub graveyard
          </Text>
        </View>
        <Text style={[styles.h1, { color: colors.foreground }]}>Ship the repos you already{"\n"}
          <Text style={{ color: colors.primary, fontFamily: "Inter_700Bold" }}>started.</Text>
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Connect your GitHub. We deep-sample every repo, then tell you exactly which ones to
          finish, which to combine, and how to market what you already built.
        </Text>

        <Pressable
          style={[styles.ctaBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.push("/auth")}
        >
          <Feather name="github" size={16} color={colors.primaryForeground} />
          <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
            Get started
          </Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={[styles.h2, { color: colors.foreground }]}>What you get</Text>
        <View style={{ gap: 12, marginTop: 16 }}>
          {FEATURES.map((f) => (
            <View
              key={f.title}
              style={[styles.featureCard, { borderColor: colors.border, backgroundColor: colors.card }]}
            >
              <Feather name={f.icon} size={20} color={colors[f.color]} />
              <Text style={[styles.featureTitle, { color: colors.foreground }]}>{f.title}</Text>
              <Text style={[styles.featureDesc, { color: colors.mutedForeground }]}>{f.desc}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.h2, { color: colors.foreground }]}>How it works</Text>
        <View style={{ gap: 16, marginTop: 16 }}>
          {[
            { step: "01", title: "Sign in", desc: "Create an account with email/password" },
            { step: "02", title: "Connect GitHub", desc: "One-tap OAuth — we read your repos" },
            { step: "03", title: "Run analysis", desc: "We deep-sample up to 25 repos in ~60s" },
            { step: "04", title: "Ship it", desc: "Follow the action plan and launch" },
          ].map((s) => (
            <View key={s.step} style={styles.stepRow}>
              <Text style={{ color: colors.primary, opacity: 0.4, fontSize: 24, fontFamily: "Inter_700Bold", width: 40 }}>
                {s.step}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                  {s.title}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 13, marginTop: 2 }}>{s.desc}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View
        style={[styles.finalCta, { borderColor: colors.border, backgroundColor: colors.card }]}
      >
        <Text style={[styles.h2, { color: colors.foreground, textAlign: "center" }]}>
          Stop letting good code rot
        </Text>
        <Text style={{ color: colors.mutedForeground, textAlign: "center", marginTop: 8, fontSize: 13 }}>
          Your next product is already 80% written. Let's find it.
        </Text>
        <Pressable
          style={[styles.ctaBtn, { backgroundColor: colors.primary, marginTop: 16, alignSelf: "center" }]}
          onPress={() => router.push("/auth")}
        >
          <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
            Get your audit
          </Text>
          <Feather name="arrow-right" size={16} color={colors.primaryForeground} />
        </Pressable>
      </View>

      <Text style={{ color: colors.mutedForeground, fontSize: 11, textAlign: "center", marginTop: 24 }}>
        repo_finisher — ship what you started
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 40 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  brandText: { fontFamily: "Inter_700Bold", fontSize: 14 },
  signInBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  hero: { marginTop: 40, alignItems: "flex-start" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  h1: { fontSize: 32, fontFamily: "Inter_700Bold", marginTop: 16, lineHeight: 38 },
  subtitle: { fontSize: 15, marginTop: 16, lineHeight: 22 },
  ctaBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
    marginTop: 24,
  },
  section: { marginTop: 48 },
  h2: { fontSize: 22, fontFamily: "Inter_700Bold" },
  featureCard: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 6 },
  featureTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15, marginTop: 4 },
  featureDesc: { fontSize: 13, lineHeight: 18 },
  stepRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  finalCta: { marginTop: 48, borderWidth: 1, borderRadius: 16, padding: 28 },
});
